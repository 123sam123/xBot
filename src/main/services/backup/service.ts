import { constants, existsSync, rmSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import Database from 'better-sqlite3';
import type { BackupResult } from '../../../shared/contracts/backup';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import type { AppPaths } from '../../paths';

// Backups (SPEC §19). No `electron` import: unit tests drive it with a
// temporary database. One backup is a folder, built as `<name>.partial` and
// renamed when complete:
//
// - `xbot.db`: `VACUUM INTO`, one consistent snapshot even while the app
//   writes. X sign-in tokens are blanked in the copy (they only decrypt on the
//   Mac that made them) and the copy is vacuumed again with secure_delete, so
//   no ciphertext survives in its free pages. A restored account reads
//   "Reconnect".
// - `media/`: exactly the files the copy's media rows name (thumbnails too),
//   cloned where the volume can (APFS), else copied. Missing ones are listed.
// - `manifest.json` and `RESTORE.txt`.
//
// Any failure removes the `.partial` folder this run made, and nothing else.

export const BACKUP_DB = 'xbot.db';
export const BACKUP_MEDIA = 'media';

export interface BackupServiceDeps {
  db: Db;
  paths: Pick<AppPaths, 'media'>;
  log: Logger;
  appVersion: string;
  now?: () => Date;
}

export interface BackupOutcome {
  /** The finished backup folder. */
  path: string;
  result: BackupResult;
}

export interface BackupService {
  /** Writes a new backup folder inside `parentDir`. Throws IpcError('backup_running') while one runs. */
  create(parentDir: string): Promise<BackupOutcome>;
  /** Quit: stops a running backup and removes its `.partial` folder. */
  dispose(): void;
}

const EXCLUDED = [
  'X sign-in tokens: they only decrypt on the Mac that made them. Restored accounts read "Reconnect".',
  'logs/, tmp/ and exports/: logs, temporary files and nothing that has to survive.',
];

const RESTORE_TEXT = `How to restore this xBot backup
================================

1. Quit xBot: right-click its menu-bar icon, then Quit xBot.
2. In Finder, choose Go → Go to Folder… and open
   ~/Library/Application Support/
3. Rename the "xBot" folder there (for example to "xBot before restore"), so
   the data you have now is kept.
4. Make a new folder named "xBot" in the same place, and copy "xbot.db" and the
   "media" folder from this backup into it.
5. Open xBot. Your drafts, media, Studio documents and presets, ideas, voice
   and settings are back.

X accounts are not in backups: their sign-in only works on the Mac that made
it. Each one reads "Reconnect"; sign in to X again from the account menu.

manifest.json lists what this backup holds. Keep the files together.
`;

class Aborted extends Error {
  constructor() {
    super('The backup was stopped because xBot is quitting.');
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "xBot Backup 2026-10-22 14.05.09", in local time. */
export function backupFolderName(at: Date): string {
  return `xBot Backup ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
}

/** A path a media row names, if it stays inside the media folder. */
function safeRelative(path: string | null): string | null {
  if (!path || path.includes('\0') || isAbsolute(path)) return null;
  const clean = normalize(path);
  return clean === '..' || clean.startsWith(`..${sep}`) ? null : clean;
}

export function createBackupService({ db, paths, log, appVersion, now = () => new Date() }: BackupServiceDeps): BackupService {
  let running: { partial: string; aborted: boolean } | null = null;

  /** The first free "<name>", "<name> 2", … in `parentDir` (neither the folder nor its `.partial` may exist). */
  function freeName(parentDir: string, base: string): string {
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? base : `${base} ${n}`;
      if (!existsSync(join(parentDir, name)) && !existsSync(join(parentDir, `${name}.partial`))) return name;
    }
    throw new IpcError('backup_failed', 'That folder already holds too many backups from this second.');
  }

  /** Blanks the X tokens in the copy and rewrites it, so their ciphertext is nowhere in the file. Returns the copy's tables and rows. */
  function scrubCopy(file: string): { tables: Record<string, number>; migrations: string[]; media: { path: string; thumb_path: string | null }[] } {
    const copy = new Database(file);
    try {
      copy.pragma('journal_mode = DELETE');
      copy.pragma('secure_delete = ON');
      copy.prepare("UPDATE x_accounts SET token_blob = X'', reconnect_required = 1").run();
      copy.exec('VACUUM');
      const tables: Record<string, number> = {};
      const names = copy.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      for (const { name } of names) {
        tables[name] = copy.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get()!.n;
      }
      const migrations = copy.prepare<[], { id: string }>('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id);
      const media = copy.prepare<[], { path: string; thumb_path: string | null }>('SELECT path, thumb_path FROM media ORDER BY rowid').all();
      return { tables, migrations, media };
    } finally {
      copy.close();
    }
  }

  /** Fills `job.partial`; resolves to the result without its folder name. */
  async function write(job: { partial: string; aborted: boolean }, createdAt: Date): Promise<Omit<BackupResult, 'folderName'>> {
    const step = () => {
      if (job.aborted) throw new Aborted();
    };
    const dbFile = join(job.partial, BACKUP_DB);
    // One read transaction: every table as of the same moment.
    db.prepare('VACUUM INTO ?').run(dbFile);
    step();
    const copy = scrubCopy(dbFile);
    step();

    const missing: string[] = [];
    let mediaFiles = 0;
    let bytes = 0;
    const seen = new Set<string>();
    for (const row of copy.media) {
      for (const rel of [safeRelative(row.path), safeRelative(row.thumb_path)]) {
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        step();
        const dest = join(job.partial, BACKUP_MEDIA, rel);
        await mkdir(dirname(dest), { recursive: true });
        try {
          await copyFile(join(paths.media, rel), dest, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        } catch (err) {
          // A source that is gone is listed; anything else (or our own folder gone) fails the backup.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || !existsSync(dirname(dest))) throw err;
          missing.push(rel);
          continue;
        }
        mediaFiles += 1;
        bytes += (await stat(dest)).size;
      }
    }
    step();

    const tables = Object.keys(copy.tables).length;
    const rows = Object.values(copy.tables).reduce((sum, n) => sum + n, 0);
    const manifest = {
      app: 'xBot',
      format: 1,
      appVersion,
      createdAt: createdAt.toISOString(),
      database: BACKUP_DB,
      migrations: copy.migrations,
      tables: copy.tables,
      media: { folder: BACKUP_MEDIA, files: mediaFiles, bytes, missing },
      excluded: EXCLUDED,
    };
    await writeFile(join(job.partial, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await writeFile(join(job.partial, 'RESTORE.txt'), RESTORE_TEXT, { flag: 'wx' });
    step();
    return { tables, rows, mediaFiles, bytes, missing: missing.length };
  }

  return {
    async create(parentDir) {
      if (running) throw new IpcError('backup_running', 'A backup is already running.');
      const createdAt = now();
      const base = backupFolderName(createdAt);
      let name = freeName(parentDir, base);
      const job = { partial: join(parentDir, `${name}.partial`), aborted: false };
      running = job;
      let made = false;
      try {
        // Not recursive: a folder that vanished or can't be written fails here, before anything exists.
        await mkdir(job.partial);
        made = true;
        const written = await write(job, createdAt);
        // Another backup may have taken the name meanwhile; renaming onto an empty folder would replace it.
        if (existsSync(join(parentDir, name))) name = freeName(parentDir, base);
        const path = join(parentDir, name);
        await rename(job.partial, path);
        made = false;
        log.info('backup: wrote', path, written);
        return { path, result: { folderName: name, ...written } };
      } catch (err) {
        if (made) await rm(job.partial, { recursive: true, force: true }).catch((cleanup: unknown) => log.warn('backup: could not remove', job.partial, cleanup));
        if (!(err instanceof IpcError)) log.warn('backup: failed', err);
        throw err;
      } finally {
        if (running === job) running = null;
      }
    },

    dispose() {
      if (!running) return;
      running.aborted = true;
      // Synchronously: the app is about to exit.
      try {
        rmSync(running.partial, { recursive: true, force: true });
      } catch (err) {
        log.warn('backup: could not remove', running.partial, err);
      }
    },
  };
}
