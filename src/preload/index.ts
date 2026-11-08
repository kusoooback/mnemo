import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('mnemo', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  // MNEMO_FAKE_PLATFORM sert aux contrôles de mise en page d'une autre plateforme (jamais en usage normal).
  platform: process.env.MNEMO_FAKE_PLATFORM || process.platform,
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onEvent: (cb: (e: { type: string; payload?: unknown }) => void): (() => void) => {
    const handler = (_: unknown, e: { type: string; payload?: unknown }): void => cb(e)
    ipcRenderer.on('mnemo:event', handler)
    return () => ipcRenderer.removeListener('mnemo:event', handler)
  }
})
