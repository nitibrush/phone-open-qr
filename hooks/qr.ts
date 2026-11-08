// A small, dependency-free QR code encoder: byte mode, error correction level M,
// versions 1 to 40, automatic mask selection. Returns a square boolean matrix
// (true = dark module). Also renders that matrix as SVG markup or as
// half-block text lines for a terminal.

export type Matrix = boolean[][]

// Error-correction codewords per block and number of blocks, level M, indexed by version.
const ECC_PER_BLOCK = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
]
const NUM_BLOCKS = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20,
  21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]
const FORMAT_BITS_M = 0 // L=1, M=0, Q=3, H=2

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function numDataCodewords(ver: number): number {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver]! * NUM_BLOCKS[ver]!
}

function utf8Bytes(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return out
}

// Galois field GF(2^8) with the QR polynomial 0x11D.
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root)
      if (j + 1 < degree) result[j]! ^= result[j + 1]!
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i]! ^= gfMul(coef, factor)
    })
  }
  return result
}

function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS[ver]!
  const blockEccLen = ECC_PER_BLOCK[ver]!
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const blocks: number[][] = []
  const divisor = rsDivisor(blockEccLen)
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const result: number[] = []
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!)
    })
  }
  return result
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const size = ver * 4 + 17
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** Encodes `text` (UTF-8, byte mode, EC level M) and returns the module matrix. */
export function encodeQr(text: string): Matrix {
  const bytes = utf8Bytes(text)
  let ver = 1
  for (;;) {
    const need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8
    if (need <= numDataCodewords(ver) * 8) break
    if (ver === 40) throw new Error('Text too long for a QR code')
    ver++
  }
  const capacityBits = numDataCodewords(ver) * 8
  const bits: number[] = []
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  pushBits(4, 4)
  pushBits(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) pushBits(b, 8)
  pushBits(0, Math.min(4, capacityBits - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) pushBits(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!
    data.push(b)
  }
  const codewords = addEccAndInterleave(data, ver)

  const size = ver * 4 + 17
  const modules: Matrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark
    isFunction[y]![x] = true
  }

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0)
    setFunction(i, 6, i % 2 === 0)
  }
  // Finder patterns with separators.
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  drawFinder(3, 3)
  drawFinder(size - 4, 3)
  drawFinder(3, size - 4)
  // Alignment patterns.
  const align = alignmentPositions(ver)
  const n = align.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }
  const drawFormatBits = (mask: number) => {
    const data = (FORMAT_BITS_M << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bitsOut = ((data << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((bitsOut >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i))
    setFunction(8, 7, bit(6))
    setFunction(8, 8, bit(7))
    setFunction(7, 8, bit(8))
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i))
    setFunction(8, size - 8, true)
  }
  drawFormatBits(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bitsOut = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = ((bitsOut >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunction(a, b, bit)
      setFunction(b, a, bit)
    }
  }

  // Data codewords in the zigzag order.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0
          i++
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    const fn = MASKS[mask]!
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunction[y]![x] && fn(x, y)) modules[y]![x] = !modules[y]![x]
      }
    }
  }
  const penalty = (): number => {
    let result = 0
    const N1 = 3
    const N2 = 3
    const N3 = 40
    const N4 = 10
    const addHistory = (runLength: number, history: number[]) => {
      if (history[0] === 0) runLength += size
      history.pop()
      history.unshift(runLength)
    }
    const countPatterns = (h: number[]): number => {
      const k = h[1]!
      const core = k > 0 && h[2] === k && h[3] === k * 3 && h[4] === k && h[5] === k
      return (core && h[0]! >= k * 4 && h[6]! >= k ? 1 : 0) + (core && h[6]! >= k * 4 && h[0]! >= k ? 1 : 0)
    }
    const terminateAndCount = (color: boolean, runLength: number, history: number[]): number => {
      if (color) {
        addHistory(runLength, history)
        runLength = 0
      }
      runLength += size
      addHistory(runLength, history)
      return countPatterns(history)
    }
    for (let y = 0; y < size; y++) {
      let runColor = false
      let runX = 0
      const history = [0, 0, 0, 0, 0, 0, 0]
      for (let x = 0; x < size; x++) {
        if (modules[y]![x] === runColor) {
          runX++
          if (runX === 5) result += N1
          else if (runX > 5) result++
        } else {
          addHistory(runX, history)
          if (!runColor) result += countPatterns(history) * N3
          runColor = modules[y]![x]!
          runX = 1
        }
      }
      result += terminateAndCount(runColor, runX, history) * N3
    }
    for (let x = 0; x < size; x++) {
      let runColor = false
      let runY = 0
      const history = [0, 0, 0, 0, 0, 0, 0]
      for (let y = 0; y < size; y++) {
        if (modules[y]![x] === runColor) {
          runY++
          if (runY === 5) result += N1
          else if (runY > 5) result++
        } else {
          addHistory(runY, history)
          if (!runColor) result += countPatterns(history) * N3
          runColor = modules[y]![x]!
          runY = 1
        }
      }
      result += terminateAndCount(runColor, runY, history) * N3
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y]![x]
        if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) result += N2
      }
    }
    let dark = 0
    for (const row of modules) for (const m of row) if (m) dark++
    const total = size * size
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
    result += k * N4
    return result
  }

  let bestMask = 0
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormatBits(mask)
    const p = penalty()
    if (p < bestPenalty) {
      bestPenalty = p
      bestMask = mask
    }
    applyMask(mask)
  }
  applyMask(bestMask)
  drawFormatBits(bestMask)
  return modules
}

/** The matrix as an SVG document: black modules on white, with a quiet zone. */
export function qrSvg(matrix: Matrix, quiet = 4): string {
  const size = matrix.length
  const total = size + quiet * 2
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y]![x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${parts.join('')}" fill="#000000"/>` +
    `</svg>`
  )
}

/**
 * The matrix as text lines for a terminal, two module rows per line using
 * half-block characters: dark modules are the drawn (foreground) part, so draw
 * the lines black on a white background.
 */
export function qrHalfBlocks(matrix: Matrix, quiet = 2): string[] {
  const size = matrix.length
  const total = size + quiet * 2
  const at = (x: number, y: number): boolean => {
    const mx = x - quiet
    const my = y - quiet
    if (mx < 0 || my < 0 || mx >= size || my >= size) return false
    return matrix[my]![mx]!
  }
  const lines: string[] = []
  for (let y = 0; y < total; y += 2) {
    let line = ''
    for (let x = 0; x < total; x++) {
      const top = at(x, y)
      const bottom = y + 1 < total ? at(x, y + 1) : false
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push(line)
  }
  return lines
}
