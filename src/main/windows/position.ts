// Composer placement. Pure: no `electron` import, unit-tested directly.
// All values are DIPs, as Electron reports them, so display scaling needs no
// extra maths.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ComposerPlacement {
  /** `tray.getBounds()`; all zeros where the platform reports none (Linux). */
  trayBounds: Rect;
  /** Cursor position, used when the tray has no bounds. */
  cursor: Point;
  /** Desired window size; the height comes from the renderer's content. */
  size: { width: number; height: number };
  /** Work area of the display nearest the tray icon. */
  workArea: Rect;
  /** Gap between the menu bar and the window. */
  gap?: number;
}

/** The point to look the display up by: the icon's centre, or the cursor. */
export function anchorPoint(trayBounds: Rect, cursor: Point): Point {
  if (trayBounds.width === 0 && trayBounds.height === 0) return cursor;
  return { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y + trayBounds.height / 2 };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Centres the composer under the tray icon and keeps it inside the work area:
 * x is clamped between the work area's edges, y sits just below the icon (and
 * never above the work area, e.g. with an auto-hidden menu bar), and the height
 * shrinks so the bottom edge stays on screen.
 */
export function computeComposerBounds({ trayBounds, cursor, size, workArea, gap = 6 }: ComposerPlacement): Rect {
  const hasTray = !(trayBounds.width === 0 && trayBounds.height === 0);
  const anchor: Rect = hasTray ? trayBounds : { x: cursor.x, y: cursor.y, width: 0, height: 0 };

  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;

  const x = clamp(anchor.x + anchor.width / 2 - width / 2, workArea.x, right - width);
  const y = clamp(anchor.y + anchor.height + gap, workArea.y, bottom - height);

  const top = Math.round(y);
  return {
    x: Math.round(x),
    y: top,
    width: Math.round(width),
    height: Math.min(Math.round(height), bottom - top),
  };
}
