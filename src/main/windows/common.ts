import { join } from 'node:path';
import { app, nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import type { RendererMaterial } from '../../shared/contracts/windows';
import { log } from '../log';
import { settings } from '../services/settings';
import { createGlass, GLASS_RADIUS, type Glass } from './glass';

// Shared window plumbing: secure webPreferences, the page loader, the native
// material switch and glass, the registry of xBot's own webContents and close → hide.

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
  const query = { material: rendererMaterial(), ...glassQuery(win) };
  const dev = devServerUrl();
  return dev
    ? win.loadURL(`${dev}/${page}/index.html?${new URLSearchParams(query)}`)
    : win.loadFile(join(rendererDir(), page, 'index.html'), { query });
}

const VIBRANCY = ['popover', 'hud', 'under-window', 'fullscreen-ui'] as const;
type Vibrancy = (typeof VIBRANCY)[number];

/** macOS reads `XBOT_VIBRANCY` at startup (default under-window); null off macOS and for `none`. */
function requestedVibrancy(): Vibrancy | null {
  if (process.platform !== 'darwin') return null;
  const requested = process.env.XBOT_VIBRANCY ?? 'under-window';
  if (requested === 'none') return null;
  return (VIBRANCY as readonly string[]).includes(requested) ? (requested as Vibrancy) : 'under-window';
}

/**
 * Native material for both windows (see ARCHITECTURE.md → "Native material").
 * macOS reads `XBOT_VIBRANCY` = popover | hud | under-window | fullscreen-ui | none
 * at startup (default under-window). Vibrancy keeps the window opaque to the
 * compositor so it keeps its native shadow; `none` is a plain transparent window.
 * With the native glass the window is borderless, so its silhouette, outline and
 * shadow follow the glass's 40 px mask instead of the system's 10 px corners.
 */
export function materialOptions(): BrowserWindowConstructorOptions {
  const transparent: BrowserWindowConstructorOptions = { transparent: true, backgroundColor: '#00000000' };
  const vibrancy = requestedVibrancy();
  if (!vibrancy) return transparent;
  return { vibrancy, visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: !nativeGlass().available };
}

let glass: Glass | null = null;

/**
 * The native glass addon, loaded on first use. Unpackaged runs may turn it off
 * with `XBOT_GLASS=off`, for today's look (captures, fallback checks).
 */
function nativeGlass(): Glass {
  glass ??= createGlass({
    platform: process.platform,
    vibrancy: requestedVibrancy() !== null,
    load() {
      if (!app.isPackaged && process.env.XBOT_GLASS === 'off') throw new Error('XBOT_GLASS=off');
      const addon = { exports: {} };
      process.dlopen(addon, join(app.getAppPath(), 'native', 'glass', 'build', 'glass.node'));
      return addon.exports;
    },
    log,
    osVersion: process.getSystemVersion(),
  });
  return glass;
}

/** 'native': clarity and the 40 px mask applied; 'square': borderless, but the apply failed. */
const glassState = new WeakMap<BrowserWindow, 'native' | 'square'>();

/** How long the page takes to repaint after a clarity or size change, before the shadow is recomputed. */
const SHADOW_SETTLE_MS = 300;
const shadowTimers = new WeakMap<BrowserWindow, NodeJS.Timeout>();

/**
 * A borderless, non-opaque window's shadow is computed from its pixels, and it
 * shows through the clear glass: a stale one leaves ghosts of content that has
 * gone. Recompute it once the page has repainted after a clarity or size
 * change; the page asks for the rest (`refreshGlassShadow`).
 */
function invalidateShadowSoon(win: BrowserWindow): void {
  clearTimeout(shadowTimers.get(win));
  shadowTimers.set(
    win,
    setTimeout(() => {
      if (!win.isDestroyed()) win.invalidateShadow();
    }, SHADOW_SETTLE_MS),
  );
}

/**
 * Fades the window's native material by `ui.glassClarity` and rounds it, with
 * square corners in simple full screen. A no-op without the addon.
 */
export function applyGlass(win: BrowserWindow): void {
  if (win.isDestroyed() || !nativeGlass().available) return;
  const radius = win.isSimpleFullScreen() ? 0 : GLASS_RADIUS;
  const applied = nativeGlass().apply(win.getNativeWindowHandle(), { clarity: settings().get('ui.glassClarity'), radius });
  glassState.set(win, applied ? 'native' : 'square');
  invalidateShadowSoon(win);
}

/** The page has repainted with new content (renderer's `useGlassShadow`): recompute the shadow now. */
export function refreshGlassShadow(win: BrowserWindow): void {
  if (glassState.has(win) && !win.isDestroyed()) win.invalidateShadow();
}

/** Applies the glass now (call it before `loadPage`) and again whenever the window shows. */
export function manageGlass(win: BrowserWindow): void {
  applyGlass(win);
  if (!glassState.has(win)) return;
  win.on('show', () => applyGlass(win));
  win.on('resize', () => invalidateShadowSoon(win));
}

/** What the page needs to match the native glass: `?glass=native&clarity=…[&fullscreen=1]` or `?glass=square`. */
function glassQuery(win: BrowserWindow): Record<string, string> {
  const state = glassState.get(win);
  if (state === 'square') return { glass: 'square' };
  if (state !== 'native') return {};
  return {
    glass: 'native',
    clarity: String(settings().get('ui.glassClarity')),
    ...(win.isSimpleFullScreen() ? { fullscreen: '1' } : {}),
  };
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
