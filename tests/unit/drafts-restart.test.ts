import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledMigrations, openDatabase, type Db } from '../../src/main/db';
import { migrate } from '../../src/main/db/migrate';
import type { Logger } from '../../src/main/log';
import { appPaths, prepareUserData, type AppPaths } from '../../src/main/paths';
import { createDraftsService } from '../../src/main/services/drafts/service';
import { createMediaService, type MediaTools } from '../../src/main/services/media/service';
import type { ServiceContext } from '../../src/main/services/types';

// SPEC §22 "Draft restart recovery": a draft written with two attachments
// comes back after the database and services are closed and reopened, with
// the same text and the same attachment order. The reopen also runs the
// startup cleanup a day later, which must keep the attached media and drop
// media that was removed from the draft.

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const FIXTURE_PNG = resolve(__dirname, '../../resources/fixtures/my-tiny-tool.png');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Electron-free stand-in for nativeImage: writes a placeholder thumbnail. */
const fakeTools: MediaTools = {
  async makeThumbnail(_file, _info, out) {
    writeFileSync(out, ONE_PIXEL_PNG);
    return true;
  },
};

let userData: string;
let sources: string;
let paths: AppPaths;
let db: Db | null = null;

function open(now: number) {
  db = openDatabase(paths.db);
  migrate(db, bundledMigrations());
  const events = new EventEmitter() as ServiceContext['events'];
  const drafts = createDraftsService(db, { events });
  const media = createMediaService({ db, paths, log: silent, tools: fakeTools, drafts, now: () => now });
  return { db, drafts, media };
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-drafts-'));
  sources = mkdtempSync(join(tmpdir(), 'xbot-sources-'));
  paths = appPaths(userData);
  prepareUserData(paths);
});

afterEach(() => {
  db?.close();
  db = null;
  rmSync(userData, { recursive: true, force: true });
  rmSync(sources, { recursive: true, force: true });
});

describe('draft restart recovery', () => {
  it('restores the exact text and attachment order after a reopen, and keeps attached media', async () => {
    const text = 'Built a tiny tool because I was tired of doing this manually.\nHere’s how it works 🚀 https://example.com';
    const screenshot = join(sources, 'Screenshot 1.png');
    const icon = join(sources, 'icon.png');
    const discarded = join(sources, 'discarded.png');
    copyFileSync(FIXTURE_PNG, screenshot);
    writeFileSync(icon, ONE_PIXEL_PNG);
    writeFileSync(discarded, Buffer.concat([ONE_PIXEL_PNG, Buffer.from('different bytes')]));

    const now = Date.now();
    const first = open(now);
    await first.media.init();
    const draft = first.drafts.getCurrent();
    first.drafts.update(draft.id, text);
    const imported = await first.media.importFiles(draft.id, [
      { name: 'Screenshot 1.png', path: screenshot },
      { name: 'icon.png', path: icon },
      { name: 'discarded.png', path: discarded },
    ]);
    expect(imported.rejected).toEqual([]);
    const [shot, small, extra] = imported.draft.attachments;
    expect(extra).toBeDefined();

    // Stored order now differs from insertion order; the third file leaves the draft.
    first.drafts.reorderAttachments(draft.id, [small!.id, shot!.id, extra!.id]);
    const before = first.drafts.removeAttachment(draft.id, extra!.id);
    expect(before.attachments.map((a) => a.id)).toEqual([small!.id, shot!.id]);

    const mediaRow = (id: string) => first.db.prepare<[string], { path: string; thumb_path: string }>('SELECT path, thumb_path FROM media WHERE id = ?').get(id)!;
    const kept = [small!, shot!].map((a) => mediaRow(a.media.id));
    const removed = mediaRow(extra!.media.id);
    first.media.dispose();
    first.db.close();
    db = null;

    // Reopen a day and an hour later, so the startup cleanup really runs past its 24 h window.
    const second = open(now + DAY_MS + 60 * 60 * 1000);
    await second.media.init();
    const restored = second.drafts.getCurrent();

    expect(restored.id).toBe(draft.id);
    expect(restored.text).toBe(text);
    expect(restored.attachments.map((a) => a.id)).toEqual([small!.id, shot!.id]);
    expect(restored.attachments.map((a) => a.media.name)).toEqual(['icon.png', 'Screenshot 1.png']);
    expect(restored.attachments.map((a) => a.position)).toEqual([0, 1]);
    for (const row of kept) {
      expect(existsSync(join(paths.media, row.path))).toBe(true);
      expect(existsSync(join(paths.media, row.thumb_path))).toBe(true);
    }

    expect(second.db.prepare('SELECT COUNT(*) FROM media WHERE id = ?').pluck().get(extra!.media.id)).toBe(0);
    expect(existsSync(join(paths.media, removed.path))).toBe(false);
    expect(existsSync(join(paths.media, removed.thumb_path))).toBe(false);
  });
});

