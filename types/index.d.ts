/** One QR row drawn in the conversation. */
export type QrRow = {
  /** The URL as given, normalized (scheme added when missing). */
  url: string
  /** For a localhost URL: the same URL on this computer's Wi-Fi address, when it could be found. */
  lanUrl?: string
  /** A short note Claude attached, e.g. what to check on the phone. */
  note?: string
  /** When it was shown, ms since epoch. */
  at: number
  /** Why the surface did not draw the row, when it did not. */
  notPlaced?: string
}

declare module 'claude-code' {
  interface PluginState {
    'phone-open-qr': {
      /** Rows by their placed id, the most recent 20 kept. */
      rows: Shaped<Record<string, QrRow>>
      /** The id of the most recent row, so `/phone-open-qr` with no URL can repeat it. */
      last: Shaped<string | null>
    }
  }
}
