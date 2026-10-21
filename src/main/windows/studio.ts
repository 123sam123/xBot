import { BrowserWindow, screen } from 'electron';
import { loadPage, manageWindow, materialOptions, secureWebPreferences } from './common';

// Media Studio: a separate resizable window, centred on the display under the
// cursor the first time it opens; afterwards it keeps wherever the user put it.

const WIDTH = 790;
const HEIGHT = 635;

let win: BrowserWindow | null = null;
let placed = false;

export function createStudioWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 720,
    minHeight: 560,
    show: false,
    frame: false,
    resizable: true,
    fullscreenable: false,
    hasShadow: true,
    title: 'xBot — Media Studio',
    ...materialOptions(),
    webPreferences: secureWebPreferences(),
  });
  manageWindow(win, 'studio');
  void loadPage(win, 'studio');
  return win;
}

export function openStudio(): void {
  if (!win) return;
  if (!placed) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [width, height] = win.getSize() as [number, number];
    win.setBounds({
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      width,
      height,
    });
    placed = true;
  }
  win.show();
  win.focus();
}

export function studioWindow(): BrowserWindow | null {
  return win;
}
