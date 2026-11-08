export {}

declare global {
  interface Window {
    mnemo: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      platform: string
      pathForFile: (file: File) => string
      onEvent: (cb: (e: { type: string; payload?: unknown }) => void) => () => void
    }
  }
}
