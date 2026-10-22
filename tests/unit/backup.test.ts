import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledMigrations, openDatabase, type Db } from '../../src/main/db';
import { migrate } from '../../src/main/db/migrate';
import type { Logger } from '../../src/main/log';
import { appPaths, prepareUserData, type AppPaths } from '../../src/main/paths';
import { BACKUP_DB, backupFolderName, createBackupService } from '../../src/main/services/backup/service';

// SPEC §19 "Backup/export capability": a backup is one consistent copy of the
// database (every table, every row) plus the media files its rows name, and
// X sign-in tokens never leave in it, not even in the copy's free pages.

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const AT = new Date(2026, 9, 22, 14, 5, 9);

let userData: string;
let target: string;
let paths: AppPaths;
let db: Db;
let token: Buffer;

function insertMedia(name: string, withThumb: boolean): string {
  const id = randomUUID();
  const path = `${id}.png`;
  writeFileSync(join(paths.media, path), randomBytes(2048));
  let thumb: string | null = null;
  if (withThumb) {
    thumb = `thumbs/${id}.png`;
    writeFileSync(join(paths.media, thumb), randomBytes(512));
  }
  db.prepare(
    `INSERT INTO media (id, kind, path, mime, width, height, duration_ms, bytes, sha256, thumb_path, original_name, created_at)
     VALUES (?, 'image', ?, 'image/png', 1440, 800, NULL, 2048, ?, ?, ?, ?)`,
  ).run(id, path, randomBytes(32).toString('hex'), thumb, name, AT.toISOString());
  return id;
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-backup-'));
  target = mkdtempSync(join(tmpdir(), 'xbot-backup-target-'));
  paths = appPaths(userData);
  prepareUserData(paths);
  mkdirSync(join(paths.media, 'thumbs'), { recursive: true });
  db = openDatabase(paths.db);
  migrate(db, bundledMigrations());

  const at = AT.toISOString();
  const current = randomUUID();
  const old = randomUUID();
  db.prepare('INSERT INTO drafts (id, text, is_current, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(current, 'Built a tiny tool.', at, at);
  db.prepare('INSERT INTO drafts (id, text, is_current, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(old, 'An older draft.', at, at);
  const first = insertMedia('my-tiny-tool.png', true);
  const second = insertMedia('second.png', false);
  const attach = db.prepare('INSERT INTO draft_attachments (id, draft_id, media_id, position, created_at) VALUES (?, ?, ?, ?, ?)');
  attach.run(randomUUID(), current, first, 0, at);
  attach.run(randomUUID(), current, second, 1, at);
  attach.run(randomUUID(), old, first, 0, at);

  token = randomBytes(96);
  db.prepare(
    `INSERT INTO x_accounts (id, x_user_id, client_id, handle, name, scopes, token_blob, token_expires_at, is_active, reconnect_required, created_at, updated_at)
     VALUES (?, '12345', 'client', 'someone', 'Someone', 'tweet.write', ?, ?, 1, 0, ?, ?)`,
  ).run(randomUUID(), token, at, at, at);
});

afterEach(() => {
  db.close();
  rmSync(userData, { recursive: true, force: true });
  chmodSync(target, 0o700);
  rmSync(target, { recursive: true, force: true });
});

function tableCounts(database: Database.Database): Record<string, number> {
  const names = database.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(names.map(({ name }) => [name, database.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`).get()!.n]));
}

describe('backup', () => {
  it('copies every table and the media its rows name, without the X tokens', async () => {
    const service = createBackupService({ db, paths, log: silent, appVersion: '0.1.0', now: () => AT });
    const { path, result } = await service.create(target);

    expect(result.folderName).toBe(backupFolderName(AT));
    expect(path).toBe(join(target, 'xBot Backup 2026-10-22 14.05.09'));
    expect(readdirSync(target)).toEqual([result.folderName]);
    expect(readdirSync(path).sort()).toEqual(['RESTORE.txt', BACKUP_DB, 'manifest.json', 'media'].sort());

    const original = tableCounts(db);
    const copy = new Database(join(path, BACKUP_DB), { readonly: true, fileMustExist: true });
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      const counts = tableCounts(copy);
      expect(Object.keys(counts)).toContain('schema_migrations');
      expect(counts).toEqual(original);
      expect(result.tables).toBe(Object.keys(original).length);
      expect(result.rows).toBe(Object.values(original).reduce((a, b) => a + b, 0));

      const named = copy.prepare<[], { path: string; thumb_path: string | null }>('SELECT path, thumb_path FROM media').all();
      const files = named.flatMap((r) => [r.path, ...(r.thumb_path ? [r.thumb_path] : [])]);
      expect(files).toHaveLength(3);
      for (const file of files) expect(readFileSync(join(path, 'media', file))).toEqual(readFileSync(join(paths.media, file)));
      expect(result.mediaFiles).toBe(3);
      expect(result.bytes).toBe(2048 + 512 + 2048);
      expect(result.missing).toBe(0);

      const account = copy.prepare<[], { blob: number; reconnect: number }>('SELECT length(token_blob) AS blob, reconnect_required AS reconnect FROM x_accounts').get();
      expect(account).toEqual({ blob: 0, reconnect: 1 });
    } finally {
      copy.close();
    }
    // Not in a row, and not in a free page either.
    expect(readFileSync(join(path, BACKUP_DB)).indexOf(token)).toBe(-1);
    // A plain rollback-journal database: no -wal or -shm beside it.
    expect(existsSync(join(path, `${BACKUP_DB}-wal`))).toBe(false);
    // The live database is untouched.
    expect(db.prepare<[], { blob: Buffer }>('SELECT token_blob AS blob FROM x_accounts').get()!.blob.equals(token)).toBe(true);

    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      app: 'xBot',
      appVersion: '0.1.0',
      createdAt: AT.toISOString(),
      database: BACKUP_DB,
      tables: original,
      media: { folder: 'media', files: 3, bytes: 2048 + 512 + 2048, missing: [] },
    });
    expect(manifest.migrations).toEqual(db.prepare<[], { id: string }>('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id));
    expect(readFileSync(join(path, 'RESTORE.txt'), 'utf8')).toContain('Application Support');
  });

  it('lists a missing media file instead of failing, and never reuses a folder name', async () => {
    const gone = db.prepare<[], { path: string }>("SELECT path FROM media WHERE original_name = 'second.png'").get()!.path;
    unlinkSync(join(paths.media, gone));
    const service = createBackupService({ db, paths, log: silent, appVersion: '0.1.0', now: () => AT });

    const first = await service.create(target);
    expect(first.result.missing).toBe(1);
    expect(JSON.parse(readFileSync(join(first.path, 'manifest.json'), 'utf8')).media.missing).toEqual([gone]);

    const second = await service.create(target);
    expect(second.result.folderName).toBe(`${backupFolderName(AT)} 2`);
    expect(readdirSync(target).sort()).toEqual([first.result.folderName, second.result.folderName].sort());
  });

  it('refuses a second backup while one runs', async () => {
    const service = createBackupService({ db, paths, log: silent, appVersion: '0.1.0', now: () => AT });
    const running = service.create(target);
    await expect(service.create(target)).rejects.toMatchObject({ code: 'backup_running' });
    await running;
  });

  it.skipIf(process.getuid?.() === 0)('leaves no .partial folder behind when the target cannot be written', async () => {
    chmodSync(target, 0o500);
    const service = createBackupService({ db, paths, log: silent, appVersion: '0.1.0', now: () => AT });
    await expect(service.create(target)).rejects.toMatchObject({ code: 'EACCES' });
    expect(readdirSync(target)).toEqual([]);
  });

  it('removes its .partial folder when a copy fails midway', async () => {
    // A media "file" that is a folder: copyFile fails with EISDIR after the database copy exists.
    const row = db.prepare<[], { path: string }>("SELECT path FROM media WHERE original_name = 'second.png'").get()!;
    unlinkSync(join(paths.media, row.path));
    mkdirSync(join(paths.media, row.path));
    const service = createBackupService({ db, paths, log: silent, appVersion: '0.1.0', now: () => AT });
    await expect(service.create(target)).rejects.toThrow();
    expect(readdirSync(target)).toEqual([]);
  });
});
