import { join } from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import { appEvents } from './events';
import { settings } from './services/settings';
import { attachTray, showComposer, toggleComposer } from './windows/composer';
import { openStudio } from './windows/studio';

// Kept at module level: a Tray that is garbage-collected disappears.
let tray: Tray | null = null;

function iconPath(): string {
  const dir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(dir, 'trayTemplate.png');
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Write Post', click: () => showComposer() },
    { label: 'Open Media Studio', click: () => openStudio() },
    { type: 'separator' },
    {
      label: 'Pause reminders',
      type: 'checkbox',
      checked: settings().get('reminders.paused'),
      click: (item) => settings().set('reminders.paused', item.checked),
    },
    {
      label: 'Settings…',
      click: () => {
        showComposer();
        appEvents.emit('ui:open-settings', {});
      },
    },
    { type: 'separator' },
    { label: 'Quit xBot', role: 'quit' },
  ]);
}

export function createTray(): Tray {
  const image = nativeImage.createFromPath(iconPath());
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('xBot');
  tray.setIgnoreDoubleClickEvents(true);
  attachTray(tray);

  tray.on('click', () => toggleComposer());
  if (process.platform === 'darwin') {
    // popUpContextMenu (not setContextMenu) so left-click stays a toggle; the
    // menu is rebuilt each time so "Pause reminders" is current.
    tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()));
  } else {
    // Linux trays only show a menu set up front.
    tray.setContextMenu(buildMenu());
    appEvents.on('settings:changed', () => tray?.setContextMenu(buildMenu()));
  }
  return tray;
}
