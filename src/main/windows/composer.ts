import { app, BrowserWindow, screen, type Display, type Tray } from 'electron';
import { resetHold, isHeld } from './hold';
import { loadPage, manageGlass, manageWindow, materialOptions, secureWebPreferences } from './common';
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
/** Shown by a reminder without focus (T8), until it is focused or hidden. */
let shownInactive = false;
const hiddenListeners = new Set<() => void>();
const focusedListeners = new Set<() => void>();

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
  manageGlass(win);

  win.on('blur', () => {
    if (!win || !win.isVisible()) return;
    if (isHeld(win.webContents)) return;
    if (!app.isPackaged && win.webContents.isDevToolsOpened()) return;
    lastBlurHideAt = Date.now();
    win.hide();
  });
  win.on('hide', () => {
    shownInactive = false;
    if (win) resetHold(win.webContents);
    for (const fn of hiddenListeners) fn();
  });
  win.on('focus', () => {
    shownInactive = false;
    for (const fn of focusedListeners) fn();
  });
  win.webContents.on('did-start-loading', () => win && resetHold(win.webContents));

  void loadPage(win, 'composer');
  return win;
}

/** The tray the composer is positioned under (set once the tray exists). */
export function attachTray(t: Tray): void {
  tray = t;
}

/** The display the composer opens on: the one under the tray icon (or the cursor). */
export function composerDisplay(): Display {
  const trayBounds = tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
  return screen.getDisplayNearestPoint(anchorPoint(trayBounds, screen.getCursorScreenPoint()));
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

/**
 * T8's automatic open: placed like `showComposer()`, shown without taking
 * focus (a non-activating panel on macOS), so the frontmost app keeps the
 * keyboard. Returns false when there is no window yet.
 */
export function showComposerInactive(): boolean {
  if (!win) return false;
  place();
  win.showInactive();
  shownInactive = true;
  return true;
}

export function hideComposer(): void {
  win?.hide();
}

export function isComposerVisible(): boolean {
  return win?.isVisible() ?? false;
}

/** Runs `fn` whenever the composer hides; returns the unsubscribe function. */
export function onComposerHidden(fn: () => void): () => void {
  hiddenListeners.add(fn);
  return () => hiddenListeners.delete(fn);
}

/** Runs `fn` whenever the composer takes focus; returns the unsubscribe function. */
export function onComposerFocused(fn: () => void): () => void {
  focusedListeners.add(fn);
  return () => focusedListeners.delete(fn);
}

export function toggleComposer(): void {
  if (!win) return;
  if (win.isVisible()) {
    // A reminder opened it without focus: a click on the icon (or the shortcut) means "write", not "close".
    if (shownInactive) showComposer();
    else win.hide();
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
