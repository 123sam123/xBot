import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { copyFile, link, open, rename, stat, unlink } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_IMPORT_FILES, type ImportRejection, type ImportResult, type MediaItem } from '../../../shared/contracts/media';
import type { VideoInfo } from '../../../shared/contracts/studio';
import type { Db } from '../../db';
import type { Logger } from '../../log';
import type { AppPaths } from '../../paths';
import { statusChanged } from '../../status';
import type { DraftsService } from '../drafts/service';
import { VideoProbeError } from '../ffmpeg/probe';
import { toMediaItem, type MediaRow } from './rows';
import { probe, ProbeError, sniff, SNIFF_BYTES, type Probe } from './sniff';

// Media import, export and cleanup. No `electron` import: decoding and
// thumbnails come in through `MediaTools`, so unit tests run it with a fake.
//
// Import, per file: validate the source, sniff and probe it by content, stream
// it into tmp/ while hashing, check a video with ffprobe when FFmpeg is there
// (T5), make a thumbnail from the temp copy, then in one transaction reuse the
// row with the same sha256 or move the file into media/ and insert it, and
// attach it to the draft. A failure leaves nothing behind.

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
/** Orphans younger than this are kept: a safety margin for anything still settling. */
export const GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface MediaTools {
  /**
   * Writes a PNG thumbnail (at most 480 px) of `file` to `out`. Returns false
   * when none could be made; throws ProbeError('unreadable') when an image
   * does not decode.
   */
  makeThumbnail(file: string, info: Probe, out: string): Promise<boolean>;
  /**
   * Checks a video with ffprobe and decodes its first frame (T5). Returns
   * null when FFmpeg isn't installed (the box check then stands alone);
   * throws VideoProbeError when the file isn't a readable video.
   */
  inspectVideo?(file: string): Promise<VideoInfo | null>;
}

export interface MediaServiceDeps {
  db: Db;
  paths: Pick<AppPaths, 'media' | 'tmp'>;
  log: Logger;
  tools: MediaTools;
  drafts: Pick<DraftsService, 'get' | 'attach'>;
  /** Milliseconds since the epoch; injected so tests can age files past the GC window. */
  now?: () => number;
}

export interface MediaService {
  /** Creates media/thumbs/ and collects orphaned media. Runs at startup. */
  init(): Promise<void>;
  importFiles(draftId: string, files: readonly { name: string; path: string }[]): Promise<ImportResult>;
  /**
   * Imports one file without attaching it to a draft (the Studio's sources,
   * background images and exports). Throws MediaRejected with the sentence
   * the user sees. The caller must reference the row with a foreign key soon:
   * unreferenced media is collected after GC_MIN_AGE_MS.
   */
  importLoose(file: { name: string; path: string }): Promise<MediaItem>;
  /** Copies the draft's media, in order, into `folder`. */
  exportDraft(draftId: string, folder: string): Promise<{ count: number; folder: string }>;
  /** True while an export copies files (the "Export running" status). */
  exporting(): boolean;
  /** Aborts in-flight copies; later work is skipped. */
  dispose(): void;
}

/** A file that will not be imported, with the sentence the user sees. */
export class MediaRejected extends Error {}

const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|mp4|mov)$/;
const THUMB_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;
const THUMBS = 'thumbs';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function probeMessage(name: string, err: ProbeError, kind: 'image' | 'video'): string {
  if (err.reason === 'too-many-pixels') return `${name} is larger than 16,384 pixels on a side.`;
  if (err.reason === 'unsupported') return `${name} isn’t a PNG, JPEG, WebP, GIF, MP4 or MOV file.`;
  return kind === 'video' ? `${name} couldn’t be read as a video. It may be incomplete.` : `${name} couldn’t be read as an image.`;
}

function videoMessage(name: string, err: VideoProbeError): string {
  return err.reason === 'no-video' ? `${name} has no video in it.` : `${name} couldn’t be read as a video. It may be incomplete or damaged.`;
}

/** A name safe for any folder: basename only, no control characters, `/` or `:`. */
export function exportName(index: number, originalName: string, ext: string): string {
  const base = [...basename(originalName, extname(originalName))]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch !== '\u007f' && !'/\\:'.includes(ch))
    .join('')
    .trim()
    .slice(0, 80);
  return `${String(index + 1).padStart(2, '0')}-${base || 'media'}.${ext}`;
}

export function createMediaService({ db, paths, log, tools, drafts, now = Date.now }: MediaServiceDeps): MediaService {
  const thumbsDir = join(paths.media, THUMBS);
  let closed = false;
  let exportsRunning = 0;
  const aborter = new AbortController();

  const q = {
    bySha: db.prepare<[string], MediaRow>('SELECT * FROM media WHERE sha256 = ?'),
    videoSize: db.prepare('UPDATE media SET width = ?, height = ?, duration_ms = ? WHERE id = ?'),
    byId: db.prepare<[string], MediaRow>('SELECT * FROM media WHERE id = ?'),
    insert: db.prepare(
      `INSERT INTO media (id, kind, path, mime, width, height, duration_ms, bytes, sha256, thumb_path, original_name, created_at)
       VALUES (@id, @kind, @path, @mime, @width, @height, @duration_ms, @bytes, @sha256, @thumb_path, @original_name, @created_at)`,
    ),
    rowsForDraft: db.prepare<[string], MediaRow>(
      `SELECT m.* FROM draft_attachments a JOIN media m ON m.id = a.media_id WHERE a.draft_id = ? ORDER BY a.position`,
    ),
  };

  function removeQuietly(file: string): void {
    try {
      unlinkSync(file);
    } catch {
      // already gone
    }
  }

  /** Streams `src` into `dest` while hashing; aborts past `cap` bytes or on dispose. */
  async function copyAndHash(src: string, dest: string, cap: number, name: string, kind: string): Promise<{ sha256: string; bytes: number }> {
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > cap) done(new MediaRejected(`${name} is larger than ${cap === IMAGE_MAX_BYTES ? '20 MB' : '1 GB'}, the limit for ${kind}s.`));
        else {
          hash.update(chunk);
          done(null, chunk);
        }
      },
    });
    try {
      await pipeline(createReadStream(src), meter, createWriteStream(dest, { flags: 'wx' }), { signal: aborter.signal });
    } catch (err) {
      removeQuietly(dest);
      if (err instanceof MediaRejected) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC') throw new MediaRejected(`Not enough disk space to add ${name}.`);
      if (closed) throw new MediaRejected(`${name} wasn’t added because xBot is quitting.`);
      log.warn('media: copy failed', name, err);
      throw new MediaRejected(`${name} couldn’t be copied.`);
    }
    return { sha256: hash.digest('hex'), bytes };
  }

  /** Imports `src` and returns its media id; attaches it to `attachTo` inside the same transaction. */
  async function importOne(name: string, src: string, attachTo: string | null): Promise<string> {
    if (!src) throw new MediaRejected(`Couldn’t read ${name}. Drag it from Finder instead.`);
    if (!isAbsolute(src)) throw new MediaRejected(`${name} couldn’t be read.`);

    let size: number;
    try {
      const info = await stat(src);
      if (!info.isFile()) throw new MediaRejected(`${name} isn’t a file.`);
      size = info.size;
    } catch (err) {
      if (err instanceof MediaRejected) throw err;
      throw new MediaRejected(`${name} couldn’t be found.`);
    }
    if (size === 0) throw new MediaRejected(`${name} is empty.`);

    const head = Buffer.alloc(SNIFF_BYTES);
    const handle = await open(src, 'r');
    try {
      await handle.read(head, 0, SNIFF_BYTES, 0);
    } finally {
      await handle.close();
    }
    const type = sniff(head);
    if (!type) throw new MediaRejected(`${name} isn’t a PNG, JPEG, WebP, GIF, MP4 or MOV file.`);
    const cap = type.kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
    if (size > cap) throw new MediaRejected(`${name} is larger than ${type.kind === 'image' ? '20 MB' : '1 GB'}, the limit for ${type.kind}s.`);

    let info: Probe;
    try {
      info = await probe(src, type, size);
    } catch (err) {
      if (err instanceof ProbeError) throw new MediaRejected(probeMessage(name, err, type.kind));
      throw new MediaRejected(`${name} couldn’t be read.`);
    }

    const id = randomUUID();
    const tmpFile = join(paths.tmp, `${id}.${info.ext}`);
    const tmpThumb = join(paths.tmp, `${id}.thumb.png`);
    try {
      const { sha256, bytes } = await copyAndHash(src, tmpFile, cap, name, type.kind);
      if (type.kind === 'video' && tools.inspectVideo) {
        let video: VideoInfo | null;
        try {
          video = await tools.inspectVideo(tmpFile);
        } catch (err) {
          if (err instanceof VideoProbeError) throw new MediaRejected(videoMessage(name, err));
          log.warn('media: video check failed', name, err);
          throw new MediaRejected(`${name} couldn’t be checked as a video.`);
        }
        // ffprobe's display size and the picture's own duration beat the box headers'.
        if (video) info = { ...info, width: video.width, height: video.height, durationMs: video.durationMs };
      }
      let hasThumb: boolean;
      try {
        hasThumb = await tools.makeThumbnail(tmpFile, info, tmpThumb);
      } catch (err) {
        if (err instanceof ProbeError) throw new MediaRejected(probeMessage(name, err, type.kind));
        log.warn('media: thumbnail failed', name, err);
        hasThumb = false;
      }
      if (closed) throw new MediaRejected(`${name} wasn’t added because xBot is quitting.`);

      const moved: string[] = [];
      try {
        return db.transaction(() => {
          if (attachTo) drafts.get(attachTo);
          const existing = q.bySha.get(sha256);
          let mediaId: string;
          if (existing) {
            mediaId = existing.id;
            if (info.kind === 'video' && info.width && info.height) q.videoSize.run(info.width, info.height, info.durationMs, existing.id);
            // Repair a row whose file went missing; otherwise the temps are simply dropped.
            const file = join(paths.media, existing.path);
            if (!existsSync(file)) {
              renameSync(tmpFile, file);
              moved.push(file);
            }
          } else {
            const relPath = `${id}.${info.ext}`;
            const relThumb = hasThumb ? `${THUMBS}/${id}.png` : null;
            renameSync(tmpFile, join(paths.media, relPath));
            moved.push(join(paths.media, relPath));
            if (relThumb) {
              renameSync(tmpThumb, join(paths.media, relThumb));
              moved.push(join(paths.media, relThumb));
            }
            q.insert.run({
              id,
              kind: info.kind,
              path: relPath,
              mime: info.mime,
              width: info.width,
              height: info.height,
              duration_ms: info.durationMs,
              bytes,
              sha256,
              thumb_path: relThumb,
              original_name: name,
              created_at: new Date(now()).toISOString(),
            });
            mediaId = id;
          }
          if (attachTo) drafts.attach(attachTo, [mediaId]);
          return mediaId;
        })();
      } catch (err) {
        for (const file of moved) removeQuietly(file);
        throw err;
      }
    } finally {
      removeQuietly(tmpFile);
      removeQuietly(tmpThumb);
    }
  }

  /** Deletes media no table references, then stray files no row names; both only past GC_MIN_AGE_MS. */
  function collectGarbage(): void {
    const cutoff = now() - GC_MIN_AGE_MS;
    const references = db
      .prepare<[], { tbl: string; col: string; to: string | null }>(
        `SELECT m.name AS tbl, p."from" AS col, p."to" AS "to"
         FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) p
         WHERE m.type = 'table' AND p."table" = 'media'`,
      )
      .all();
    const unreferenced = references
      .map((r) => `NOT EXISTS (SELECT 1 FROM ${quote(r.tbl)} r WHERE r.${quote(r.col)} = media.${quote(r.to ?? 'id')})`)
      .join(' AND ');
    const orphans = db
      .prepare<[string], MediaRow>(`SELECT * FROM media WHERE created_at < ?${unreferenced ? ` AND ${unreferenced}` : ''}`)
      .all(new Date(cutoff).toISOString());
    if (orphans.length > 0) {
      const remove = db.prepare('DELETE FROM media WHERE id = ?');
      db.transaction(() => orphans.forEach((o) => remove.run(o.id)))();
      for (const o of orphans) {
        removeQuietly(join(paths.media, o.path));
        if (o.thumb_path) removeQuietly(join(paths.media, o.thumb_path));
        log.info('media: removed unused media', o.id, o.original_name);
      }
    }

    const known = new Set<string>();
    for (const r of db.prepare<[], { path: string; thumb_path: string | null }>('SELECT path, thumb_path FROM media').all()) {
      known.add(r.path);
      if (r.thumb_path) known.add(r.thumb_path);
    }
    const sweep = (dir: string, prefix: string, pattern: RegExp) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !pattern.test(entry.name) || known.has(prefix + entry.name)) continue;
        const file = join(dir, entry.name);
        if (statSync(file).mtimeMs >= cutoff) continue;
        removeQuietly(file);
        log.info('media: removed a stray file', prefix + entry.name);
      }
    };
    sweep(paths.media, '', FILE_NAME);
    sweep(thumbsDir, `${THUMBS}/`, THUMB_NAME);
  }

  /** Copies without ever overwriting: `<name>.partial`, then a hard link to the first free name. */
  async function exportOne(src: string, folder: string, name: string): Promise<void> {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    const partial = join(folder, `.${name}.${randomUUID().slice(0, 8)}.partial`);
    await copyFile(src, partial, constants.COPYFILE_EXCL);
    try {
      for (let n = 1; n < 1000; n++) {
        const target = join(folder, n === 1 ? name : `${stem} (${n})${ext}`);
        try {
          await link(partial, target);
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') continue;
          // Some volumes (exFAT, network shares) have no hard links: rename instead.
          if (existsSync(target)) continue;
          await rename(partial, target);
          return;
        }
      }
      throw new Error(`no free name for ${name}`);
    } finally {
      await unlink(partial).catch(() => {});
    }
  }

  return {
    async init() {
      mkdirSync(thumbsDir, { recursive: true });
      try {
        collectGarbage();
      } catch (err) {
        log.error('media: cleanup failed', err);
      }
    },

    async importFiles(draftId, files) {
      drafts.get(draftId); // a missing draft fails the whole call
      const rejected: ImportRejection[] = [];
      for (const [index, file] of files.entries()) {
        if (closed) break;
        if (index >= MAX_IMPORT_FILES) {
          rejected.push({ name: file.name, message: `Add up to ${MAX_IMPORT_FILES} files at a time.` });
          continue;
        }
        try {
          await importOne(file.name, file.path, draftId);
        } catch (err) {
          if (err instanceof MediaRejected) rejected.push({ name: file.name, message: err.message });
          else throw err;
        }
      }
      return { draft: drafts.get(draftId), rejected };
    },

    async importLoose(file) {
      if (closed) throw new MediaRejected(`${file.name} wasn’t added because xBot is quitting.`);
      const mediaId = await importOne(file.name, file.path, null);
      return toMediaItem(q.byId.get(mediaId)!);
    },

    async exportDraft(draftId, folder) {
      drafts.get(draftId);
      const rows = q.rowsForDraft.all(draftId);
      exportsRunning += 1;
      statusChanged();
      try {
        for (const [index, row] of rows.entries()) {
          if (closed) throw new Error('xBot is quitting');
          await exportOne(join(paths.media, row.path), folder, exportName(index, row.original_name, extname(row.path).slice(1)));
        }
      } finally {
        exportsRunning -= 1;
        statusChanged();
      }
      return { count: rows.length, folder };
    },

    exporting: () => exportsRunning > 0,

    dispose() {
      closed = true;
      aborter.abort();
    },
  };
}
