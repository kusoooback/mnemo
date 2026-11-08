import { describe, expect, it, vi } from 'vitest'
import { hasMod, shortcut } from '../src/renderer/src/lib/platform'

const setApplicationMenu = vi.fn()
vi.mock('electron', () => ({ Menu: { setApplicationMenu: (m: unknown) => setApplicationMenu(m), buildFromTemplate: (t: unknown) => ({ template: t }) } }))

describe('Raccourcis selon la plateforme', () => {
  it('Windows : les libellés restent tels quels', () => {
    expect(shortcut('Ctrl+B', false)).toBe('Ctrl+B')
    expect(shortcut('Ctrl K', false)).toBe('Ctrl K')
  })

  it('Mac : Ctrl devient ⌘, Maj ⇧, Alt ⌥', () => {
    expect(shortcut('Ctrl+B', true)).toBe('⌘B')
    expect(shortcut('Ctrl K', true)).toBe('⌘K')
    expect(shortcut('Ctrl ↵', true)).toBe('⌘↵')
    expect(shortcut('Trou (Ctrl+Maj+C)', true)).toBe('Trou (⌘⇧C)')
    expect(shortcut('select text then Ctrl+Shift+C.', true)).toBe('select text then ⌘⇧C.')
    expect(shortcut('Ctrl+Alt+Shift+C', true)).toBe('⌘⌥⇧C')
  })

  it('la touche de commande est ⌘ sur Mac et Ctrl ailleurs', () => {
    expect(hasMod({ ctrlKey: true, metaKey: false }, false)).toBe(true)
    expect(hasMod({ ctrlKey: false, metaKey: true }, false)).toBe(false)
    expect(hasMod({ ctrlKey: false, metaKey: true }, true)).toBe(true)
    expect(hasMod({ ctrlKey: true, metaKey: false }, true)).toBe(false)
  })
})

describe('Barre de menus Mac', () => {
  it('contient quitter, copier-coller (menu Édition) et plein écran, sans outils de développement en production', async () => {
    const { macMenuTemplate, installMenu } = await import('../src/main/menu')
    const t = macMenuTemplate('Mnémo', false)
    const flat = JSON.stringify(t)
    expect(t[0].label).toBe('Mnémo')
    expect(flat).toContain('"role":"quit"')
    expect(flat).toContain('"role":"editMenu"')
    expect(flat).toContain('"role":"togglefullscreen"')
    expect(flat).not.toContain('toggleDevTools')
    expect(JSON.stringify(macMenuTemplate('Mnémo', true))).toContain('toggleDevTools')

    installMenu('win32', 'Mnémo', false)
    expect(setApplicationMenu).toHaveBeenLastCalledWith(null)
    installMenu('darwin', 'Mnémo', false)
    expect(setApplicationMenu.mock.lastCall?.[0]).toBeTruthy()
  })
})
