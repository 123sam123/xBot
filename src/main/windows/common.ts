import { join } from 'node:path';
import { app, nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import type { RendererMaterial } from '../../shared/contracts/windows';
import { log } from '../log';

// Shared window plumbing: secure webPreferences, the page loader, the native
// material switch, the registry of xBot's own webContents and close → hide.

export type Page = 'composer' | 'studio';

/** The Vite dev-server URL while `pnpm dev` runs; null for built files (including e2e). */
export function devServerUrl(): string | null {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
}

export function rendererDir(): string {
  return join(app.getAppPath(), 'out', 'renderer');
}

export function secureWebPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: join(app.getAppPath(), 'out', 'preload', 'index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  };
}

export function loadPage(win: BrowserWindow, page: Page): Promise<void> {
  const query = { material: rendererMaterial() };
  const dev = devServerUrl();
  return dev
    ? win.loadURL(`${dev}/${page}/index.html?${new URLSearchParams(query)}`)
    : win.loadFile(join(rendererDir(), page, 'index.html'), { query });
}

const VIBRANCY = ['popover', 'hud', 'under-window', 'fullscreen-ui'] as const;
type Vibrancy = (typeof VIBRANCY)[number];

/**
 * Native material for both windows (see ARCHITECTURE.md → "Native material").
 * macOS reads `XBOT_VIBRANCY` = popover | hud | under-window | fullscreen-ui | none
 * at startup (default under-window). Vibrancy keeps the window opaque to the
 * compositor so it keeps its native shadow; `none` is a plain transparent window.
 */
export function materialOptions(): BrowserWindowConstructorOptions {
  const transparent: BrowserWindowConstructorOptions = { transparent: true, backgroundColor: '#00000000' };
  if (process.platform !== 'darwin') return transparent;
  const requested = process.env.XBOT_VIBRANCY ?? 'under-window';
  if (requested === 'none') return transparent;
  const vibrancy: Vibrancy = (VIBRANCY as readonly string[]).includes(requested) ? (requested as Vibrancy) : 'under-window';
  return { vibrancy, visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true };
}

/**
 * What the page draws over. Unpackaged runs may force it with
 * `XBOT_MATERIAL=vibrancy|css`, so captures on Linux can render the macOS
 * layers on a transparent window.
 */
export function rendererMaterial(): RendererMaterial {
  const forced = process.env.XBOT_MATERIAL;
  if (!app.isPackaged && (forced === 'vibrancy' || forced === 'css')) return forced;
  return 'vibrancy' in materialOptions() ? 'vibrancy' : 'css';
}

/**
 * App appearance, read at startup: `XBOT_APPEARANCE` = dark | system (default
 * dark). xBot's text is white, and the light under-window material behind it
 * is the rejected milky-silver look. `themeSource` is app-wide, so native
 * menus and dialogs follow it too.
 */
export function applyAppearance(): void {
  nativeTheme.themeSource = process.env.XBOT_APPEARANCE === 'system' ? 'system' : 'dark';
}

const knownIds = new Set<number>();

export function knownWebContentsIds(): ReadonlySet<number> {
  return knownIds;
}

let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

/** Registers an xBot window: trusted for IPC, hidden (never destroyed) on close, reloaded after a crash. */
export function manageWindow(win: BrowserWindow, page: Page): void {
  const id = win.webContents.id;
  knownIds.add(id);
  win.webContents.on('destroyed', () => knownIds.delete(id));

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  const crashes: number[] = [];
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error(`${page}: renderer gone`, details);
    if (details.reason === 'clean-exit') return;
    const now = Date.now();
    while (crashes.length > 0 && now - crashes[0]! > 60_000) crashes.shift();
    if (crashes.length >= 3) {
      log.error(`${page}: renderer crashed 3 times in a minute; not reloading again`);
      return;
    }
    crashes.push(now);
    void loadPage(win, page);
  });
}
