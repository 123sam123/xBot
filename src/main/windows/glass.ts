import type { Logger } from '../log';

// The native glass (native/glass/glass.mm; see ARCHITECTURE.md → "Native
// material"): fades the window's vibrancy view by the Glass clarity setting
// and rounds it to the panel's 40 px corners. Electron-free, so it is
// unit-testable; windows/common.ts wires it to the real windows.

/** The panel's corner radius, CSS px (`--radius-window-css`). */
export const GLASS_RADIUS = 40;
/** `ui.glassClarity`'s default. */
export const DEFAULT_CLARITY = 0.8;

export interface GlassAddon {
  /** Sets the alpha and corner radius of the window's behind-window effect views; returns how many it changed. */
  setGlass(handle: Buffer, alpha: number, radius: number): number;
}

/**
 * The open glass's opacity falls much more slowly than the material's
 * `alphaValue` (measured over black and white on macOS 15.5: alpha 0.13 still
 * leaves it at 40% of its full opacity). Squaring `1 − clarity` makes it fall
 * roughly in step with clarity: 80% → about 80% less opaque.
 */
export const ALPHA_CURVE = 2;

/** The material's opacity for a clarity: 0 → as the system draws it, 1 → invisible. */
export function clarityToAlpha(clarity: number): number {
  const c = Number.isFinite(clarity) ? Math.min(1, Math.max(0, clarity)) : DEFAULT_CLARITY;
  return (1 - c) ** ALPHA_CURVE;
}

export interface GlassOptions {
  platform: NodeJS.Platform;
  /** Whether the windows use native vibrancy (false for `XBOT_VIBRANCY=none`). */
  vibrancy: boolean;
  /** Loads the addon. Called at most once, and only on macOS with vibrancy. */
  load(): unknown;
  log: Logger;
  osVersion: string;
}

export interface Glass {
  /** The addon loaded: windows are created borderless and get the 40 px mask. */
  readonly available: boolean;
  /** Applies clarity and radius to one window. False when nothing changed; never throws. */
  apply(handle: Buffer, options: { clarity: number; radius: number }): boolean;
}

export function createGlass({ platform, vibrancy, load, log, osVersion }: GlassOptions): Glass {
  let addon: GlassAddon | null = null;
  if (platform === 'darwin' && vibrancy) {
    try {
      const loaded = load() as Partial<GlassAddon> | null | undefined;
      if (typeof loaded?.setGlass === 'function') addon = loaded as GlassAddon;
      else log.warn('glass: the native addon has no setGlass(); using the system glass');
    } catch (err) {
      log.warn('glass: native addon not loaded; using the system glass', err);
    }
  }

  let loggedSuccess = false;
  let loggedFailure = false;
  return {
    available: addon !== null,
    apply(handle, { clarity, radius }) {
      if (!addon) return false;
      const alpha = clarityToAlpha(clarity);
      let views = 0;
      let error: unknown = 'no vibrancy view found';
      try {
        views = addon.setGlass(handle, alpha, radius);
      } catch (err) {
        error = err;
      }
      if (views > 0) {
        if (!loggedSuccess) log.info(`glass: applied views=${views} alpha=${alpha.toFixed(3)} radius=${radius} macOS=${osVersion}`);
        loggedSuccess = true;
        return true;
      }
      if (!loggedFailure) log.error(`glass: could not apply (macOS=${osVersion}); the corners stay square`, error);
      loggedFailure = true;
      return false;
    },
  };
}
