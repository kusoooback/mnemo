import { Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Sur Mac, la barre de menus est obligatoire : sans elle, ⌘C / ⌘V / ⌘Z ne fonctionnent pas dans les champs de saisie et
 * ⌘Q / ⌘W n'existent pas. Les rôles standard sont traduits automatiquement par le système.
 */
export function macMenuTemplate(appName: string, dev: boolean): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
    },
    { role: 'editMenu' },
    {
      label: 'Affichage',
      submenu: [{ role: 'togglefullscreen' }, ...(dev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])]
    },
    { role: 'windowMenu' }
  ]
}

export function installMenu(platform: NodeJS.Platform, appName: string, dev: boolean): void {
  Menu.setApplicationMenu(platform === 'darwin' ? Menu.buildFromTemplate(macMenuTemplate(appName, dev)) : null)
}
