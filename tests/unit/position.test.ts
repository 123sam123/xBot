import { describe, expect, it } from 'vitest';
import { computeComposerBounds, type Rect } from '../../src/main/windows/position';

const size = { width: 420, height: 635 };
const noTray: Rect = { x: 0, y: 0, width: 0, height: 0 };
// A 1512×982 MacBook display with a 24 px menu bar.
const laptop: Rect = { x: 0, y: 24, width: 1512, height: 958 };

describe('computeComposerBounds', () => {
  it('centres the composer under the tray icon, just below the menu bar', () => {
    const tray = { x: 1000, y: 0, width: 24, height: 24 };
    expect(computeComposerBounds({ trayBounds: tray, cursor: { x: 0, y: 0 }, size, workArea: laptop, gap: 6 })).toEqual({
      x: 802,
      y: 30,
      width: 420,
      height: 635,
    });
  });

  it('clamps to the right edge when the icon is near the screen edge', () => {
    const tray = { x: 1490, y: 0, width: 22, height: 24 };
    const bounds = computeComposerBounds({ trayBounds: tray, cursor: { x: 0, y: 0 }, size, workArea: laptop });
    expect(bounds.x + bounds.width).toBe(1512);
  });

  it('clamps to the left edge', () => {
    const tray = { x: 4, y: 0, width: 22, height: 24 };
    expect(computeComposerBounds({ trayBounds: tray, cursor: { x: 0, y: 0 }, size, workArea: laptop }).x).toBe(0);
  });

  it('stays on a second display to the right of the first', () => {
    const external: Rect = { x: 1512, y: 25, width: 2560, height: 1415 };
    const tray = { x: 3990, y: 0, width: 24, height: 25 };
    const bounds = computeComposerBounds({ trayBounds: tray, cursor: { x: 0, y: 0 }, size, workArea: external });
    expect(bounds.x).toBe(external.x + external.width - 420);
    expect(bounds.y).toBeGreaterThanOrEqual(external.y);
  });

  it('handles a display with a negative origin', () => {
    const leftOfPrimary: Rect = { x: -1920, y: -200, width: 1920, height: 1080 };
    const tray = { x: -1910, y: -224, width: 24, height: 24 };
    const bounds = computeComposerBounds({ trayBounds: tray, cursor: { x: 0, y: 0 }, size, workArea: leftOfPrimary });
    expect(bounds.x).toBe(-1920);
    expect(bounds.y).toBe(-194);
  });

  it('never goes above the work area with an auto-hidden menu bar', () => {
    const fullHeight: Rect = { x: 0, y: 0, width: 1512, height: 982 };
    const tray = { x: 1000, y: 0, width: 24, height: 24 };
    expect(computeComposerBounds({ trayBounds: tray, cursor: { x: 0, y: 0 }, size, workArea: fullHeight, gap: 6 }).y).toBe(30);
  });

  it('shrinks an oversized height so the bottom edge stays inside the work area', () => {
    const short: Rect = { x: 0, y: 24, width: 1280, height: 776 };
    const tray = { x: 900, y: 0, width: 24, height: 24 };
    const bounds = computeComposerBounds({
      trayBounds: tray,
      cursor: { x: 0, y: 0 },
      size: { width: 420, height: 2000 },
      workArea: short,
    });
    expect(bounds.y).toBeGreaterThanOrEqual(short.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(short.y + short.height);
  });

  it('rounds to whole pixels for an odd-width icon on a scaled display', () => {
    const bounds = computeComposerBounds({
      trayBounds: { x: 1000.5, y: 0, width: 23, height: 24 },
      cursor: { x: 0, y: 0 },
      size,
      workArea: laptop,
    });
    for (const value of Object.values(bounds)) expect(Number.isInteger(value)).toBe(true);
  });

  it('falls back to the cursor when the tray reports no bounds', () => {
    const bounds = computeComposerBounds({ trayBounds: noTray, cursor: { x: 700, y: 10 }, size, workArea: laptop, gap: 6 });
    expect(bounds.x).toBe(490);
    expect(bounds.y).toBe(24);
  });
});
