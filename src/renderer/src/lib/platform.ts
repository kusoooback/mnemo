/** Différences Windows / macOS visibles dans l'interface : touche de commande et libellés des raccourcis. */

export const isMac = (): boolean => typeof window !== 'undefined' && window.mnemo?.platform === 'darwin'

/** Touche de commande de la plateforme : ⌘ sur Mac, Ctrl ailleurs. */
export const hasMod = (e: { ctrlKey: boolean; metaKey: boolean }, mac = isMac()): boolean => (mac ? e.metaKey : e.ctrlKey)

/** « Ctrl+Maj+C » s'écrit « ⌘⇧C » sur Mac ; inchangé ailleurs. */
export function shortcut(text: string, mac = isMac()): string {
  if (!mac) return text
  return text
    .replace(/Ctrl\s*\+?\s*/g, '⌘')
    .replace(/(?:Maj|Shift)\s*\+?\s*/g, '⇧')
    .replace(/Alt\s*\+?\s*/g, '⌥')
    .replace(/⌘\s+/g, '⌘')
}
