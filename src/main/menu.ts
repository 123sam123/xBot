import { app, Menu, type MenuItemConstructorOptions } from 'electron';

// The application menu is invisible for a menu-bar app, but its key
// equivalents still apply: Edit roles make Cmd+C/V/X/A/Z work, Close makes
// Cmd+W hide the focused window. Never set it to null — that removes those
// shortcuts. Reload and DevTools exist only in unpackaged builds.
export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] });
  }
  template.push({ role: 'editMenu' }, { label: 'Window', submenu: [{ role: 'close' }] });
  if (!app.isPackaged) {
    template.push({ label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
