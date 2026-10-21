import { app, BrowserWindow, screen, type Tray } from 'electron';
import { resetHold, isHeld } from './hold';
import { loadPage, manageWindow, materialOptions, secureWebPreferences } from './common';
import { anchorPoint, computeComposerBounds } from './position';

// The Write Post composer: a 420 px frameless panel under the tray icon. Its
// height follows the renderer's content (`windows:resize-composer`).

const WIDTH = 420;
const INITIAL_HEIGHT = 635;
/** A tray click this soon after a blur-hide is the click that caused the blur. */
const REOPEN_GUARD_MS = 250;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let contentHeight = INITIAL_HEIGHT;
let lastBlurHideAt = 0;

export function createComposerWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: INITIAL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    title: 'xBot — Write Post',
    ...(process.platform === 'darwin' ? { type: 'panel', hiddenInMissionControl: true } : {}),
    ...materialOptions(),
    webPreferences: secureWebPreferences(),
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  manageWindow(win, 'composer');

  win.on('blur', () => {
    if (!win || !win.isVisible()) return;
    if (isHeld(win.webContents)) return;
    if (!app.isPackaged && win.webContents.isDevToolsOpened()) return;
    lastBlurHideAt = Date.now();
    win.hide();
  });
  win.on('hide', () => win && resetHold(win.webContents));
  win.webContents.on('did-start-loading', () => win && resetHold(win.webContents));

  void loadPage(win, 'composer');
  return win;
}

/** The tray the composer is positioned under (set once the tray exists). */
export function attachTray(t: Tray): void {
  tray = t;
}

function place(): void {
  if (!win) return;
  const trayBounds = tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(anchorPoint(trayBounds, cursor));
  win.setBounds(
    computeComposerBounds({ trayBounds, cursor, size: { width: WIDTH, height: contentHeight }, workArea: display.workArea }),
  );
}

export function showComposer(): void {
  if (!win) return;
  place();
  win.show();
  win.focus();
}

export function hideComposer(): void {
  win?.hide();
}

export function toggleComposer(): void {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    return;
  }
  if (Date.now() - lastBlurHideAt < REOPEN_GUARD_MS) return;
  showComposer();
}

/** Fits the window to the renderer's content height, re-clamped to the display. */
export function resizeComposer(height: number): void {
  contentHeight = height;
  if (win?.isVisible()) place();
}

export function composerWindow(): BrowserWindow | null {
  return win;
}
