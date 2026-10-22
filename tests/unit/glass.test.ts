import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledMigrations, openDatabase, type Db } from '../../src/main/db';
import { migrate } from '../../src/main/db/migrate';
import type { Logger } from '../../src/main/log';
import { createSettingsService } from '../../src/main/services/settings';
import { clarityToAlpha, createGlass, type GlassOptions } from '../../src/main/windows/glass';

// The native glass (Settings → Appearance → Glass clarity): the clarity →
// alpha mapping, the fallback when the addon is missing or finds nothing, and
// the persisted setting.

const handle = Buffer.alloc(8);

function logger() {
  return { info: vi.fn<Logger['info']>(), warn: vi.fn<Logger['warn']>(), error: vi.fn<Logger['error']>() };
}

function options(overrides: Partial<GlassOptions> = {}): GlassOptions {
  return { platform: 'darwin', vibrancy: true, load: () => ({ setGlass: () => 1 }), log: logger(), osVersion: '15.5.0', ...overrides };
}

describe('clarityToAlpha', () => {
  it('maps 0 to the full material and 1 to none, squared in between', () => {
    expect(clarityToAlpha(0)).toBe(1);
    expect(clarityToAlpha(1)).toBe(0);
    expect(clarityToAlpha(0.8)).toBeCloseTo(0.04);
    expect(clarityToAlpha(0.5)).toBeCloseTo(0.25);
  });

  it('only fades as clarity rises', () => {
    const alphas = [0, 0.2, 0.4, 0.6, 0.8, 1].map(clarityToAlpha);
    expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
  });

  it('clamps out-of-range values and treats NaN as the 0.8 default', () => {
    expect(clarityToAlpha(-1)).toBe(1);
    expect(clarityToAlpha(2)).toBe(0);
    expect(clarityToAlpha(Number.NaN)).toBeCloseTo(0.04);
  });
});

describe('createGlass', () => {
  it('never loads the addon off macOS or without vibrancy', () => {
    for (const overrides of [{ platform: 'linux' as const }, { vibrancy: false }]) {
      const load = vi.fn();
      const log = logger();
      const glass = createGlass(options({ ...overrides, load, log }));
      expect(glass.available).toBe(false);
      expect(glass.apply(handle, { clarity: 0.8, radius: 40 })).toBe(false);
      expect(load).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    }
  });

  it('falls back with one warning when the addon is missing (a mocked module)', () => {
    const log = logger();
    const glass = createGlass(
      options({
        log,
        load: () => {
          throw new Error("Cannot find module 'glass.node'");
        },
      }),
    );
    expect(glass.available).toBe(false);
    expect(glass.apply(handle, { clarity: 0.8, radius: 40 })).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('falls back when the module has no setGlass()', () => {
    const log = logger();
    const glass = createGlass(options({ log, load: () => ({}) }));
    expect(glass.available).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('applies the mapped alpha and radius, logging the first success once', () => {
    const setGlass = vi.fn(() => 1);
    const log = logger();
    const glass = createGlass(options({ log, load: () => ({ setGlass }) }));
    expect(glass.available).toBe(true);
    expect(glass.apply(handle, { clarity: 0.8, radius: 40 })).toBe(true);
    expect(glass.apply(handle, { clarity: 0, radius: 0 })).toBe(true);
    expect(setGlass).toHaveBeenNthCalledWith(1, handle, clarityToAlpha(0.8), 40);
    expect(setGlass).toHaveBeenNthCalledWith(2, handle, 1, 0);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0]![0]).toMatch(/^glass: applied views=1 /);
  });

  it('reports a failure (no view found, or a throw) once and never throws', () => {
    const log = logger();
    const results = [0, new Error('bad handle')];
    const glass = createGlass(
      options({
        log,
        load: () => ({
          setGlass: () => {
            const next = results.shift();
            if (next instanceof Error) throw next;
            return next ?? 0;
          },
        }),
      }),
    );
    expect(glass.apply(handle, { clarity: 0.8, radius: 40 })).toBe(false);
    expect(glass.apply(handle, { clarity: 0.8, radius: 40 })).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe('ui.glassClarity', () => {
  let dir: string;
  let db: Db;
  const events = { emit: vi.fn() };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xbot-glass-'));
    db = openDatabase(join(dir, 'xbot.db'));
    migrate(db, bundledMigrations());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const service = () => createSettingsService(db, { events: events as never, log: logger() });

  it('defaults to 80% and persists what is set', () => {
    expect(service().get('ui.glassClarity')).toBe(0.8);
    service().set('ui.glassClarity', 0.55);
    expect(service().get('ui.glassClarity')).toBe(0.55);
    expect(events.emit).toHaveBeenCalledWith('settings:changed', { key: 'ui.glassClarity', value: 0.55 });
  });

  it('rejects values outside 0–1, and a stored one falls back to the default', () => {
    expect(() => service().set('ui.glassClarity', 1.5)).toThrow();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('ui.glassClarity', '7', '')").run();
    expect(service().get('ui.glassClarity')).toBe(0.8);
  });
});
