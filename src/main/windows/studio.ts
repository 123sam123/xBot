import { BrowserWindow, screen } from 'electron';
import { appEvents } from '../events';
import { applyGlass, loadPage, manageGlass, manageWindow, materialOptions, secureWebPreferences } from './common';

// Media Studio: a separate resizable window, centred on the display under the
// cursor the first time it opens; afterwards it keeps wherever the user put it.
// It is the size of a video editor, and never larger than the display.

const WIDTH = 1280;
const HEIGHT = 820;
const MIN_WIDTH = 980;
const MIN_HEIGHT = 660;

let win: BrowserWindow | null = null;
let placed = false;

export function createStudioWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    resizable: true,
    fullscreenable: true,
    hasShadow: true,
    title: 'xBot — Media Studio',
    ...materialOptions(),
    webPreferences: secureWebPreferences(),
  });
  manageWindow(win, 'studio');
  manageGlass(win);
  // Every way of hiding the Studio (Back to post, Add to post, Escape, close) leaves full screen.
  win.on('hide', () => setStudioFullscreen(false));
  void loadPage(win, 'studio');
  return win;
}

function isFullscreen(): boolean {
  if (!win) return false;
  return process.platform === 'darwin' ? win.isSimpleFullScreen() : win.isFullScreen();
}

/** Simple full screen on macOS (no new Space for a menu-bar app), the window manager's elsewhere. */
export function setStudioFullscreen(on: boolean): void {
  if (!win || isFullscreen() === on) return;
  if (process.platform === 'darwin') win.setSimpleFullScreen(on);
  else win.setFullScreen(on);
  // Square glass corners in full screen, the panel's 40 px out of it.
  applyGlass(win);
  appEvents.emit('studio:fullscreen', { on });
}

export function toggleStudioFullscreen(): boolean {
  const on = !isFullscreen();
  setStudioFullscreen(on);
  return on;
}

export function openStudio(): void {
  if (!win) return;
  if (!placed) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [wanted, tall] = win.getSize() as [number, number];
    const width = Math.min(wanted, workArea.width - 40);
    const height = Math.min(tall, workArea.height - 40);
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
