import { mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledMigrations, openDatabase, type Db } from '../../src/main/db';
import { migrate } from '../../src/main/db/migrate';
import type { Logger } from '../../src/main/log';
import { appPaths, prepareUserData, type AppPaths } from '../../src/main/paths';
import { createDraftsService } from '../../src/main/services/drafts/service';
import { createMediaService, type MediaTools } from '../../src/main/services/media/service';
import type { ServiceContext } from '../../src/main/services/types';

// SPEC §22 "Invalid media": media is validated by content and size before
// anything is copied, so a rejected file leaves no trace in media/, tmp/ or
// the database.

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let userData: string;
let sources: string;
let paths: AppPaths;
let db: Db;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-media-'));
  sources = mkdtempSync(join(tmpdir(), 'xbot-sources-'));
  paths = appPaths(userData);
  prepareUserData(paths);
  db = openDatabase(paths.db);
  migrate(db, bundledMigrations());
});

afterEach(() => {
  db.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(sources, { recursive: true, force: true });
});

describe('media import rejects invalid files and stores nothing for them', () => {
  it('refuses a .txt renamed to .png and an oversized PNG', async () => {
    const tools: MediaTools = { makeThumbnail: vi.fn(async () => true) };
    const drafts = createDraftsService(db, { events: new EventEmitter() as ServiceContext['events'] });
    const media = createMediaService({ db, paths, log: silent, tools, drafts });
    await media.init();
    const draft = drafts.getCurrent();

    const renamed = join(sources, 'notes.png');
    writeFileSync(renamed, 'These are my notes, not a screenshot.\n');
    // A real PNG signature and IHDR, so sniffing passes and the 20 MB cap is what refuses it.
    // Sparse: 21 MB on paper, almost nothing on disk.
    const huge = join(sources, 'huge.png');
    writeFileSync(huge, ONE_PIXEL_PNG.subarray(0, 33));
    truncateSync(huge, 21 * 1024 * 1024);

    const result = await media.importFiles(draft.id, [
      { name: 'notes.png', path: renamed },
      { name: 'huge.png', path: huge },
    ]);

    expect(result.rejected).toEqual([
      { name: 'notes.png', message: 'notes.png isn’t a PNG, JPEG, WebP, GIF, MP4 or MOV file.' },
      { name: 'huge.png', message: 'huge.png is larger than 20 MB, the limit for images.' },
    ]);
    expect(result.draft.attachments).toEqual([]);
    expect(tools.makeThumbnail).not.toHaveBeenCalled();

    // Nothing written: media/ holds only the empty thumbs/ folder, tmp/ is empty, no rows.
    expect(readdirSync(paths.media)).toEqual(['thumbs']);
    expect(readdirSync(join(paths.media, 'thumbs'))).toEqual([]);
    expect(readdirSync(paths.tmp)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM media').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM draft_attachments').pluck().get()).toBe(0);
  });
});
