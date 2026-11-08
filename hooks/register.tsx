import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { QrRow } from '../types'
import { encodeQr, qrHalfBlocks, qrSvg } from './qr'

const PLUGIN = 'phone-open-qr'
const COMMAND = 'phone-open-qr'
const TOOL_NAME = 'show_qr'
const TOOL = `mcp__${PLUGIN}__${TOOL_NAME}`
const KEEP = 20
const PANE = 'phone-open-qr'
const PANE_TITLE = '폰에서 바로 여는 QR'

const rows = atom({ plugin: 'phone-open-qr', key: 'rows' } as const, {} as Record<string, QrRow>, {
  shape: 'rows-1',
})
const last = atom({ plugin: 'phone-open-qr', key: 'last' } as const, null as string | null, {
  shape: 'last-1',
})

const CAPTION = '이동하려면 휴대전화 카메라로 아래 QR을 찍으세요.'

const GUIDE = [
  'Phone handoff: whenever you ask the user to open, test or look at a URL on their phone',
  '(a staging site, a deployed page, a local dev server, a mobile-only banner), write the URL',
  `in your reply, then call the tool ${TOOL} with that URL. A QR code row then appears in the`,
  'conversation right there, captioned in Korean "이동하려면 휴대전화 카메라로 아래 QR을 찍으세요."',
  'The user points their phone camera at the screen and taps the banner. For a localhost URL the',
  'tool shows the Wi-Fi address variant the phone can reach when one is found. Do not describe',
  'the QR yourself beyond one short line; the row carries the instructions.',
].join(' ')

const USAGE = '사용법: /phone-open-qr <주소>   예) /phone-open-qr https://example.com/ko/'

type Engine = EngineInterface

function normalizeUrl(raw: string): string | null {
  let s = raw.trim().replace(/^[<"'`\s]+/, '').replace(/[>"'`.,;:)\]\s]+$/, '')
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  const m = s.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([/?#].*)?$/i)
  if (!m) return null
  const host = m[2] ?? ''
  if (!/^[\w.\-\[\]:%@]+$/.test(host)) return null
  return s
}

function hostOf(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/?#:]+)/i)
  return m?.[1]?.toLowerCase() ?? ''
}

function isLocalHost(url: string): boolean {
  const host = hostOf(url)
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]' || host.endsWith('.localhost')
}

function replaceHost(url: string, host: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)(?:[^@/?#]*@)?(\[[^\]]*\]|[^/?#:]+)/i, `$1${host}`)
}

const PRIVATE_IPV4 =
  /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/

function privateIpIn(stdout: string): string | null {
  const m = stdout.match(PRIVATE_IPV4)
  return m?.[1] ?? null
}

/**
 * Finds this computer's private Wi-Fi/LAN address so a localhost URL can be
 * opened from a phone. It runs, in order, exactly these three commands, each
 * written out in full, and stops at the first that prints a private address.
 * Nothing is sent anywhere; only one address is read from the output.
 */
async function lanAddress($: Engine): Promise<string | null> {
  try {
    // Windows
    const r = await $.process.run(['ipconfig'], { timeoutMs: 5000 })
    if (r.exitCode === 0) {
      const ip = privateIpIn(r.stdout)
      if (ip) return ip
    }
  } catch {
    // not available on this platform; try the next
  }
  try {
    // macOS
    const r = await $.process.run(['ipconfig', 'getifaddr', 'en0'], { timeoutMs: 5000 })
    if (r.exitCode === 0) {
      const ip = privateIpIn(r.stdout)
      if (ip) return ip
    }
  } catch {
    // not available on this platform; try the next
  }
  try {
    // Linux
    const r = await $.process.run(['hostname', '-I'], { timeoutMs: 5000 })
    if (r.exitCode === 0) {
      const ip = privateIpIn(r.stdout)
      if (ip) return ip
    }
  } catch {
    // not available on this platform
  }
  return null
}

/** Builds the row, stores it and places it in the conversation. */
async function show($: Engine, raw: string, note?: string): Promise<QrRow | { error: string }> {
  const url = normalizeUrl(raw)
  if (!url) return { error: `주소로 읽을 수 없습니다: ${raw.trim() || '(비어 있음)'}` }
  let lanUrl: string | undefined
  if (isLocalHost(url)) {
    const ip = await lanAddress($)
    if (ip) lanUrl = replaceHost(url, ip)
  }
  const at = await $.clock.now()
  const row: QrRow = { url, lanUrl, note: note?.trim() || undefined, at }
  const id = `qr-${at.toString(36)}`
  await update($, rows, (all) => {
    const next = { ...all, [id]: row }
    const ids = Object.keys(next).sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0))
    for (const old of ids.slice(0, Math.max(0, ids.length - KEEP))) delete next[old]
    return next
  })
  await update($, last, () => id)
  const placed = await $.ui.place({ id })
  if (!placed.isPlaced) {
    const shown: QrRow = { ...row, notPlaced: placed.reason }
    await update($, rows, (all) => ({ ...all, [id]: shown }))
    // Fallback where the surface draws no transcript rows: a pane beside the chat.
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return shown
  }
  return row
}

function describe(row: QrRow): string {
  const target = row.lanUrl ?? row.url
  const lines = [`폰에서 열기: ${target}`]
  if (row.lanUrl) {
    lines.push(`(${row.url} 은 폰에서 열 수 없어 이 컴퓨터의 Wi-Fi 주소로 바꿨습니다. 폰이 같은 Wi-Fi에 있어야 합니다.)`)
  } else if (isLocalHost(row.url)) {
    lines.push('(localhost 주소는 폰에서 열 수 없습니다. 이 컴퓨터의 Wi-Fi 주소를 찾지 못했습니다.)')
  }
  lines.push(CAPTION)
  if (row.notPlaced) lines.push('QR은 오른쪽 창에 띄웠습니다.')
  return lines.join('\n')
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '주소를 QR 코드로 대화창에 띄워 폰 카메라로 바로 열기 (Show a URL as a QR code to open on your phone)',
      argumentHint: '<url>',
    })
    await $.tool.register({
      name: TOOL_NAME,
      description:
        'Show a URL as a QR code right in the conversation so the user can open it on their phone by ' +
        'pointing the phone camera at the screen. Call it whenever you ask the user to open or check a ' +
        "URL on their phone. A localhost URL is also offered on this computer's Wi-Fi address when found.",
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open on the phone.' },
          note: { type: 'string', description: 'Optional: one short line on what to check there.' },
        },
        required: ['url'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'phone-open-qr:guide', text: GUIDE, scope: 'session' as const }] }
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const raw = e.args.trim()
    if (!raw) {
      const lastId = await read($, last)
      const all = await read($, rows)
      const prev = lastId ? all[lastId] : undefined
      if (!prev) return { text: USAGE }
      const shown = await show($, prev.lanUrl ?? prev.url, prev.note)
      return { text: 'error' in shown ? shown.error : describe(shown) }
    }
    const shown = await show($, raw)
    return { text: 'error' in shown ? `${shown.error}\n${USAGE}` : describe(shown) }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The tool's arguments ride on `e` beside `tool` and `tool_use_id`.
    const args = e as unknown as { url?: unknown; note?: unknown }
    const raw = typeof args.url === 'string' ? args.url : ''
    const note = typeof args.note === 'string' ? args.note : undefined
    const shown = await show($, raw, note)
    if ('error' in shown) return { deny: shown.error }
    // A registered tool answers with plain text (or an array of content blocks),
    // not an MCP `{ content, isError }` envelope: the engine refuses that shape.
    return { result: describe(shown) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const lastId = await read($, last)
    const all = await read($, rows)
    const row = lastId ? all[lastId] : undefined
    if (!row) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>{USAGE}</Text>
        </Box>
      )
    }
    return draw($, e, row)
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN) return next(e)
    const all = await read($, rows)
    const row = all[e.props.id]
    if (!row) return next(e)
    return draw($, e, row)
  })
}

function draw($: Engine, e: RenderInput<'Pane' | 'Placed'>, row: QrRow) {
  {
    const target = row.lanUrl ?? row.url

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const lines = qrHalfBlocks(encodeQr(target), 2)
      const width = lines[0]?.length ?? 0
      const fits = width <= (e.viewport?.columns ?? 80)
      return (
        <Box flexDirection="column" gap={1} paddingLeft={2} paddingY={1}>
          <Text>{CAPTION}</Text>
          {fits ? (
            <Box flexDirection="column">
              {lines.map((line, i) => (
                <Text key={`r${i}`} color="black" backgroundColor="white">
                  {line}
                </Text>
              ))}
            </Box>
          ) : (
            <Text color="yellow">창이 좁아 QR을 그릴 수 없습니다. 창을 {width}칸 이상으로 넓혀 주세요.</Text>
          )}
          <Text dimColor>{target}</Text>
          {row.lanUrl && <Text dimColor>원래 주소 {row.url} · 폰이 같은 Wi-Fi에 있어야 합니다</Text>}
          {row.note && <Text>{row.note}</Text>}
        </Box>
      )
    }

    const { Box, Text, Svg, Link } = $.ui.resolve(e)
    const svg = qrSvg(encodeQr(target), 4)
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Text>{CAPTION}</Text>
        <Svg source={svg} alt={`QR code for ${target}`} width={220} height={220} />
        <Link href={target} />
        {row.lanUrl && (
          <Text dimColor size="footnote">
            원래 주소 {row.url} 은 폰에서 열 수 없어 이 컴퓨터의 Wi-Fi 주소로 바꿨습니다. 폰이 같은 Wi-Fi에 있어야 합니다.
          </Text>
        )}
        {row.note && <Text size="footnote">{row.note}</Text>}
      </Box>
    )
  }
}
