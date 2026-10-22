import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { exportLayout } from '../../../shared/composition/layout';
import { defaultComposition, effectiveFormat, gradientBackground, MAX_EDIT_PIXELS, minTrimMs, type Composition, type Style } from '../../../shared/composition/model';
import { compositionSchema, styleSchema } from '../../../shared/composition/schema';
import type { MediaItem } from '../../../shared/contracts/media';
import type { AddToPostResult, ExportJob, ExportVideoResult, SaveResult, StudioDocument, StudioPreset, StudioView, VideoInfo } from '../../../shared/contracts/studio';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import type { AppPaths } from '../../paths';
import type { SerialQueue } from '../drafts/queue';
import type { DraftsService } from '../drafts/service';
import { filmstrip } from '../ffmpeg/frames';
import type { FfmpegBinaries } from '../ffmpeg/locate';
import { probeVideo, VideoProbeError } from '../ffmpeg/probe';
import { MediaRejected, type MediaService } from '../media/service';
import { toMediaItem, type MediaRow } from '../media/rows';
import { probe, sniff, SNIFF_BYTES } from '../media/sniff';
import type { ServiceContext } from '../types';
import { createExportRunner, type ExportRunner } from './exports';

// Studio documents, exports and presets. No `electron` import: the IPC layer
// supplies pickers and windows. A document is one source image or video plus
// its composition (shared/composition); every save names the revision it
// started from, so a stale page can never overwrite newer edits. "Add to post"
// checks the rendered bytes against the export layout before storing them as
// media and putting them on the current draft, in place of the document's last
// export. A video document (T5) also keeps what ffprobe read when it was
// created, and its "Add to post" is an FFmpeg job (exports.ts) over the frame
// layer the renderer drew.

/** Unlinked documents untouched for this long are deleted at startup. */
export const DOCUMENT_GC_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface StudioVideoTools {
  /** FFmpeg's binaries once a check in progress settles; null when FFmpeg is missing. */
  binaries(): Promise<FfmpegBinaries | null>;
}

export interface StudioServiceDeps {
  db: Db;
  paths: Pick<AppPaths, 'media' | 'tmp'>;
  log: Logger;
  media: Pick<MediaService, 'importLoose'>;
  drafts: Pick<DraftsService, 'getCurrent'>;
  events: ServiceContext['events'];
  video: StudioVideoTools;
  /** The drafts/media queue: a finished video export is imported and attached on it. */
  serialize: SerialQueue;
  /** Test seam: video exports read their input at the native rate. */
  realtime?: boolean;
  now?: () => Date;
}

export interface AddToPostInput {
  documentId: string;
  baseRevision: number;
  composition: Composition;
  bytes: Uint8Array;
  /** The attachment whose "Edit in Studio ↗" opened this document, captured when the call was made. */
  openedFromAttachmentId: string | null;
}

export interface ExportVideoInput {
  documentId: string;
  baseRevision: number;
  composition: Composition;
  /** The frame layer: a PNG at the export size, transparent where the video shows. */
  layer: Uint8Array;
  openedFromAttachmentId: string | null;
}

export type Opened = { document: StudioDocument } | { view: StudioView };

export interface StudioService {
  /** Startup: deletes old documents nothing links to (except `keepId`), and tidies export jobs. */
  init(keepId: string | null): Promise<void>;
  exists(documentId: string): boolean;
  get(documentId: string): StudioDocument;
  /** The attachment's document, created and linked on first open; a video opens read-only while FFmpeg is missing. */
  openForAttachment(draftId: string, attachmentId: string): Promise<Opened>;
  /** The newest document for this media (or for the document it was exported from), else a new one. */
  openForMedia(item: MediaItem): Promise<Opened>;
  save(documentId: string, baseRevision: number, composition: Composition): SaveResult;
  listPresets(): StudioPreset[];
  savePreset(name: string, style: Style): StudioPreset;
  deletePreset(id: string): void;
  addToPost(input: AddToPostInput): Promise<AddToPostResult>;
  /** Saves a video document and queues its MP4 export. */
  exportVideo(input: ExportVideoInput): Promise<ExportVideoResult>;
  cancelExport(jobId: string): Promise<ExportJob>;
  job(jobId: string): ExportJob;
  exportActivity(): ReturnType<ExportRunner['activity']>;
  /** A video document's timeline frames (JPEG). */
  filmstrip(documentId: string, signal?: AbortSignal): Promise<Uint8Array[]>;
  /** Quit: stops a running export at once. */
  dispose(): void;
}

interface DocumentRow {
  id: string;
  source_media_id: string;
  background_media_id: string | null;
  composition_json: string;
  composition_backup: string | null;
  source_video_json: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  draft_id: string;
  media_id: string;
  position: number;
  studio_document_id: string | null;
}

interface PresetRow {
  id: string;
  name: string;
  style_json: string;
  background_media_id: string | null;
  created_at: string;
}

interface AttachInput {
  documentId: string;
  item: MediaItem;
  format: 'png' | 'jpeg' | 'mp4';
  scale: 1 | 2;
  draftId: string;
  openedFromAttachmentId: string | null;
}

const STALE = 'This document changed elsewhere. Reloaded the latest version.';
const SOURCE_MISSING = 'The video file is missing. Add it again from Write Post.';
const FFMPEG_NEEDED = 'Video export needs FFmpeg. Install it with Homebrew: brew install ffmpeg';

/** A PNG's IHDR: size and colour type (6 is RGBA). */
function pngHeader(bytes: Uint8Array): { width: number; height: number; colorType: number } | null {
  if (bytes.byteLength < 26) return null;
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20), colorType: view[25]! };
}

export function createStudioService({ db, paths, log, media, drafts, events, video, serialize, realtime = false, now = () => new Date() }: StudioServiceDeps): StudioService {
  const stamp = () => now().toISOString();
  const adding = new Set<string>();

  const q = {
    document: db.prepare<[string], DocumentRow>('SELECT * FROM studio_documents WHERE id = ?'),
    latestForSource: db.prepare<[string], { id: string }>(
      'SELECT id FROM studio_documents WHERE source_media_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1',
    ),
    exportOf: db.prepare<[string], { document_id: string }>(
      'SELECT document_id FROM studio_exports WHERE media_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    ),
    insertDocument: db.prepare(
      `INSERT INTO studio_documents (id, source_media_id, background_media_id, composition_json, source_video_json, revision, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 0, ?, ?)`,
    ),
    replaceCorrupt: db.prepare(
      'UPDATE studio_documents SET composition_json = ?, composition_backup = ?, background_media_id = NULL, revision = revision + 1 WHERE id = ?',
    ),
    saveDocument: db.prepare(
      `UPDATE studio_documents SET composition_json = ?, source_media_id = ?, background_media_id = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
    ),
    media: db.prepare<[string], MediaRow>('SELECT * FROM media WHERE id = ?'),
    attachment: db.prepare<[string, string], AttachmentRow>('SELECT * FROM draft_attachments WHERE id = ? AND draft_id = ?'),
    draftAttachments: db.prepare<[string], AttachmentRow>('SELECT * FROM draft_attachments WHERE draft_id = ? ORDER BY position'),
    draftExists: db.prepare<[string], { id: string }>('SELECT id FROM drafts WHERE id = ?'),
    link: db.prepare('UPDATE draft_attachments SET studio_document_id = ? WHERE id = ?'),
    swap: db.prepare('UPDATE draft_attachments SET media_id = ?, studio_document_id = ? WHERE id = ?'),
    nextPosition: db.prepare<[string], { next: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM draft_attachments WHERE draft_id = ?'),
    insertAttachment: db.prepare(
      'INSERT INTO draft_attachments (id, draft_id, media_id, position, created_at, studio_document_id) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    unlinkOthers: db.prepare('UPDATE draft_attachments SET studio_document_id = NULL WHERE draft_id = ? AND studio_document_id = ? AND id <> ?'),
    touchDraft: db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?'),
    insertExport: db.prepare(
      'INSERT INTO studio_exports (id, document_id, media_id, format, scale, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    // Exports no attachment on any draft (history included) still uses.
    deleteUnusedExports: db.prepare(
      'DELETE FROM studio_exports WHERE document_id = ? AND media_id NOT IN (SELECT media_id FROM draft_attachments)',
    ),
    presets: db.prepare<[], PresetRow>('SELECT * FROM studio_presets ORDER BY created_at, rowid'),
    insertPreset: db.prepare('INSERT INTO studio_presets (id, name, style_json, background_media_id, created_at) VALUES (?, ?, ?, ?, ?)'),
    deletePreset: db.prepare('DELETE FROM studio_presets WHERE id = ?'),
    collect: db.prepare(
      `DELETE FROM studio_documents
       WHERE updated_at < @cutoff AND id <> @keep
         AND NOT EXISTS (SELECT 1 FROM draft_attachments a WHERE a.studio_document_id = studio_documents.id)
         AND NOT EXISTS (SELECT 1 FROM draft_attachments a JOIN studio_exports e ON e.media_id = a.media_id
                         WHERE e.document_id = studio_documents.id)`,
    ),
  };

  function mediaRow(id: string): MediaRow | undefined {
    return q.media.get(id);
  }

  function documentRow(id: string): DocumentRow {
    const row = q.document.get(id);
    if (!row) throw new IpcError('document_not_found', 'That Studio document no longer exists.');
    return row;
  }

  /** The source facts of a video document (main wrote them); null for an image document. */
  function videoOf(row: DocumentRow): VideoInfo | null {
    return row.source_video_json ? (JSON.parse(row.source_video_json) as VideoInfo) : null;
  }

  /** Does `parsed` still fit its source (and, for a video, the clip)? */
  function fits(parsed: Composition, source: MediaRow, info: VideoInfo | null): boolean {
    if (parsed.source.mediaId !== source.id) return false;
    if (!info) return parsed.video === undefined && parsed.source.width === source.width && parsed.source.height === source.height;
    return (
      parsed.video !== undefined &&
      parsed.source.width === info.width &&
      parsed.source.height === info.height &&
      parsed.video.trimEndMs <= info.durationMs &&
      parsed.video.trimEndMs - parsed.video.trimStartMs >= minTrimMs(info.durationMs)
    );
  }

  /** The stored composition, or the defaults (keeping the unreadable JSON) when it is corrupt or no longer fits its source. */
  function readComposition(row: DocumentRow, source: MediaRow, info: VideoInfo | null): Composition {
    let parsed: Composition | null = null;
    try {
      const result = compositionSchema.safeParse(JSON.parse(row.composition_json));
      if (result.success) parsed = result.data;
    } catch {
      // not JSON
    }
    if (parsed && fits(parsed, source, info)) return parsed;
    log.warn('studio: unreadable composition; using the defaults and keeping a backup', row.id);
    const fallback = info
      ? defaultComposition({ mediaId: source.id, width: info.width, height: info.height }, { durationMs: info.durationMs })
      : defaultComposition({ mediaId: source.id, width: source.width ?? 1, height: source.height ?? 1 });
    q.replaceCorrupt.run(JSON.stringify(fallback), row.composition_json, row.id);
    row.revision += 1;
    row.background_media_id = null;
    return fallback;
  }

  function toDocument(row: DocumentRow): StudioDocument {
    const source = mediaRow(row.source_media_id)!; // NOT NULL foreign key
    const info = videoOf(row);
    let composition = readComposition(row, source, info);
    const background = composition.background.type === 'image' ? (mediaRow(composition.background.mediaId) ?? null) : null;
    if (composition.background.type === 'image' && !background) {
      // The background image is gone: fall back to the default gradient (saved with the next edit).
      composition = { ...composition, background: gradientBackground('blue', composition.background.brightness) };
    }
    return {
      id: row.id,
      revision: row.revision,
      composition,
      source: toMediaItem(source),
      sourceMissing: !existsSync(join(paths.media, source.path)),
      background: background ? toMediaItem(background) : null,
      gif: source.mime === 'image/gif',
      video: info,
      exportJob: runner.activeFor(row.id),
      updatedAt: row.updated_at,
    };
  }

  /** An image xBot can edit, or the reason it can't. */
  function editableImage(row: Pick<MediaRow, 'kind' | 'width' | 'height'>): { width: number; height: number } | null {
    if (row.kind !== 'image' || !row.width || !row.height) return null;
    if (row.width * row.height > MAX_EDIT_PIXELS) {
      throw new IpcError('source_too_large', 'This image is too large to edit (over 50 megapixels).');
    }
    return { width: row.width, height: row.height };
  }

  function create(source: MediaRow, size: { width: number; height: number }, info: VideoInfo | null = null): DocumentRow {
    const id = randomUUID();
    const at = stamp();
    const composition = defaultComposition({ mediaId: source.id, width: size.width, height: size.height }, info ? { durationMs: info.durationMs } : undefined);
    q.insertDocument.run(id, source.id, JSON.stringify(composition), info ? JSON.stringify(info) : null, at, at);
    return q.document.get(id)!;
  }

  /** ffprobe's view of a stored video; null while FFmpeg is missing (the Studio then shows it read-only). */
  async function probeSource(source: MediaRow): Promise<VideoInfo | null> {
    const tools = await video.binaries();
    if (!tools) return null;
    const file = join(paths.media, source.path);
    if (!existsSync(file)) throw new IpcError('source_missing', SOURCE_MISSING);
    try {
      return await probeVideo(tools.ffprobe, file);
    } catch (err) {
      if (!(err instanceof VideoProbeError)) log.warn('studio: probing the video failed', source.id, err);
      throw new IpcError('media_rejected', `${source.original_name} couldn’t be read as a video.`);
    }
  }

  function checkBackground(background: Composition['background'] | Style['background']): string | null {
    if (background.type !== 'image') return null;
    const row = mediaRow(background.mediaId);
    if (!row || row.kind !== 'image') throw new IpcError('invalid_background', 'That background image no longer exists.');
    return row.id;
  }

  /**
   * Puts `item` on the draft in place of the attachment that opened the
   * document (else the one linked to it), keeping its position, or appends a
   * linked attachment; exports no draft uses any more are deleted. Runs on the
   * drafts queue.
   */
  function attachExport({ documentId, item, format, scale, draftId, openedFromAttachmentId }: AttachInput): { attachmentId: string; exportId: string } {
    const exportId = randomUUID();
    const attachmentId = db.transaction(() => {
      const at = stamp();
      q.insertExport.run(exportId, documentId, item.id, format, scale, item.width, item.height, at);
      const attachments = q.draftAttachments.all(draftId);
      const target =
        attachments.find((a) => a.id === openedFromAttachmentId) ??
        attachments.find((a) => a.studio_document_id === documentId) ??
        attachments.find((a) => a.media_id === item.id);
      let id: string;
      if (target) {
        id = target.id;
        q.swap.run(item.id, documentId, id);
      } else {
        id = randomUUID();
        q.insertAttachment.run(id, draftId, item.id, q.nextPosition.get(draftId)!.next, at, documentId);
      }
      q.unlinkOthers.run(draftId, documentId, id);
      q.deleteUnusedExports.run(documentId);
      q.touchDraft.run(at, draftId);
      return id;
    })();
    events.emit('draft:changed', { draftId });
    return { attachmentId, exportId };
  }

  const runner = createExportRunner({
    db,
    paths,
    log,
    events,
    binaries: () => video.binaries(),
    serialize,
    realtime,
    now,
    async finish({ documentId, draftId, openedFromAttachmentId, output, sourceName }) {
      const stem = basename(sourceName, extname(sourceName)) || 'video';
      let item: MediaItem;
      try {
        item = await media.importLoose({ name: `${stem}-studio.mp4`, path: output });
      } catch (err) {
        if (err instanceof MediaRejected) throw new IpcError('media_rejected', err.message);
        throw err;
      }
      // The draft the user asked from, unless it is gone.
      const target = q.draftExists.get(draftId) ? draftId : drafts.getCurrent().id;
      return attachExport({ documentId, item, format: 'mp4', scale: 1, draftId: target, openedFromAttachmentId }).exportId;
    },
  });

  const service: StudioService = {
    async init(keepId) {
      const cutoff = new Date(now().getTime() - DOCUMENT_GC_AGE_MS).toISOString();
      const { changes } = q.collect.run({ cutoff, keep: keepId ?? '' });
      if (changes > 0) log.info(`studio: removed ${changes} unused document(s)`);
      await runner.init();
    },

    exists: (documentId) => q.document.get(documentId) !== undefined,

    get(documentId) {
      return toDocument(documentRow(documentId));
    },

    async openForAttachment(draftId, attachmentId) {
      const found = db.transaction((): { documentId: string } | { view: StudioView } | { video: MediaRow } => {
        const attachment = q.attachment.get(attachmentId, draftId);
        if (!attachment) throw new IpcError('attachment_not_found', 'That attachment is no longer on the draft.');
        const linked = attachment.studio_document_id ?? q.exportOf.get(attachment.media_id)?.document_id ?? null;
        if (linked && q.document.get(linked)) {
          if (attachment.studio_document_id !== linked) q.link.run(linked, attachment.id);
          return { documentId: linked };
        }
        const source = mediaRow(attachment.media_id)!;
        if (source.kind === 'video') return { video: source };
        const size = editableImage(source);
        if (!size) return { view: { draftId, attachmentId, media: toMediaItem(source) } };
        const row = create(source, size);
        q.link.run(row.id, attachment.id);
        return { documentId: row.id };
      })();
      if ('documentId' in found) return { document: service.get(found.documentId) };
      if ('view' in found) return found;

      // A video: probe it outside any transaction, then create and link it, unless another open got there first.
      const info = await probeSource(found.video);
      if (!info) return { view: { draftId, attachmentId, media: toMediaItem(found.video) } };
      const documentId = db.transaction(() => {
        const attachment = q.attachment.get(attachmentId, draftId);
        if (!attachment) throw new IpcError('attachment_not_found', 'That attachment is no longer on the draft.');
        if (attachment.studio_document_id && q.document.get(attachment.studio_document_id)) return attachment.studio_document_id;
        const row = create(found.video, info, info);
        q.link.run(row.id, attachment.id);
        return row.id;
      })();
      return { document: service.get(documentId) };
    },

    async openForMedia(item) {
      const source = mediaRow(item.id);
      if (!source) throw new IpcError('media_rejected', `${item.name} couldn’t be opened.`);
      const fromExport = q.exportOf.get(source.id)?.document_id;
      if (fromExport && q.document.get(fromExport)) return { document: service.get(fromExport) };
      const existing = q.latestForSource.get(source.id);
      if (source.kind === 'video') {
        if (existing) return { document: service.get(existing.id) };
        const info = await probeSource(source);
        if (!info) return { view: { draftId: null, attachmentId: null, media: toMediaItem(source) } };
        const id = db.transaction(() => q.latestForSource.get(source.id)?.id ?? create(source, info, info).id)();
        return { document: service.get(id) };
      }
      const size = editableImage(source);
      if (!size) throw new IpcError('not_editable', 'Media Studio edits images and videos.');
      return { document: toDocument(existing ? documentRow(existing.id) : create(source, size)) };
    },

    save(documentId, baseRevision, composition) {
      return db.transaction(() => {
        const row = documentRow(documentId);
        if (row.revision !== baseRevision) throw new IpcError('stale_revision', STALE);
        const info = videoOf(row);
        const source = mediaRow(composition.source.mediaId);
        if (info) {
          if (!source || source.id !== row.source_media_id || composition.source.width !== info.width || composition.source.height !== info.height || !composition.video) {
            throw new IpcError('invalid_source', 'A video document keeps its video.');
          }
          const { trimStartMs, trimEndMs } = composition.video;
          if (trimEndMs > info.durationMs || trimEndMs - trimStartMs < minTrimMs(info.durationMs)) {
            throw new IpcError('invalid_trim', 'The trim must stay inside the video and last at least half a second.');
          }
        } else if (!source || source.kind !== 'image' || source.width !== composition.source.width || source.height !== composition.source.height || composition.video) {
          throw new IpcError('invalid_source', 'That source image no longer matches. Replace it again.');
        }
        const backgroundId = checkBackground(composition.background);
        const updatedAt = stamp();
        q.saveDocument.run(JSON.stringify(composition), source.id, backgroundId, updatedAt, documentId, baseRevision);
        return { revision: baseRevision + 1, updatedAt };
      })();
    },

    listPresets() {
      const presets: StudioPreset[] = [];
      for (const row of q.presets.all()) {
        let style: Style | null = null;
        try {
          const parsed = styleSchema.safeParse(JSON.parse(row.style_json));
          if (parsed.success) style = parsed.data;
        } catch {
          // not JSON
        }
        if (!style) {
          log.warn('studio: skipping an unreadable preset', row.id);
          continue;
        }
        const background = row.background_media_id ? mediaRow(row.background_media_id) : undefined;
        presets.push({ id: row.id, name: row.name, style, background: background ? toMediaItem(background) : null, createdAt: row.created_at });
      }
      return presets;
    },

    savePreset(name, style) {
      const backgroundId = checkBackground(style.background);
      const id = randomUUID();
      const createdAt = stamp();
      q.insertPreset.run(id, name, JSON.stringify(style), backgroundId, createdAt);
      const background = backgroundId ? mediaRow(backgroundId) : undefined;
      return { id, name, style, background: background ? toMediaItem(background) : null, createdAt };
    },

    deletePreset(id) {
      q.deletePreset.run(id);
    },

    async addToPost({ documentId, baseRevision, composition, bytes, openedFromAttachmentId }) {
      if (videoOf(documentRow(documentId))) throw new IpcError('not_an_image', 'Videos are exported with FFmpeg. Try again.');
      if (adding.has(documentId)) throw new IpcError('add_in_progress', 'Already adding this image to your post.');
      adding.add(documentId);
      try {
        const { revision } = service.save(documentId, baseRevision, composition);
        const document = service.get(documentId);

        // The bytes must be what this composition renders to: the right format, the layout's size.
        const format = effectiveFormat(composition, document.gif);
        const type = sniff(Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES)));
        if (!type || type.format !== format) throw new IpcError('export_mismatch', 'The rendered image didn’t match the composition. Try again.');
        const tmpFile = join(paths.tmp, `${randomUUID()}.${type.ext}`);
        let item: MediaItem;
        try {
          await writeFile(tmpFile, bytes, { flag: 'wx' });
          const info = await probe(tmpFile, type, bytes.byteLength);
          const expected = exportLayout(composition).canvas;
          if (info.width !== expected.width || info.height !== expected.height) {
            throw new IpcError('export_mismatch', 'The rendered image didn’t match the composition. Try again.');
          }
          const stem = basename(document.source.name, extname(document.source.name)) || 'image';
          item = await media.importLoose({ name: `${stem}-studio.${type.ext}`, path: tmpFile });
        } catch (err) {
          if (err instanceof MediaRejected) throw new IpcError('media_rejected', err.message);
          throw err;
        } finally {
          await unlink(tmpFile).catch(() => {});
        }

        const draftId = drafts.getCurrent().id;
        const { attachmentId, exportId } = attachExport({ documentId, item, format, scale: composition.output.scale, draftId, openedFromAttachmentId });
        return { draftId, attachmentId, exportId, revision };
      } finally {
        adding.delete(documentId);
      }
    },

    async exportVideo({ documentId, baseRevision, composition, layer, openedFromAttachmentId }) {
      const row = documentRow(documentId);
      const info = videoOf(row);
      if (!info) throw new IpcError('not_a_video', 'Only video documents export as MP4.');
      if (runner.activeFor(documentId)) throw new IpcError('export_in_progress', 'This video is already exporting.');
      if (!(await video.binaries())) throw new IpcError('ffmpeg_missing', FFMPEG_NEEDED);
      if (composition.background.type === 'transparent') {
        throw new IpcError('transparent_video', 'Video can’t have a transparent background. Pick a background first.');
      }
      const { revision } = service.save(documentId, baseRevision, composition);

      // The layer must be the RGBA PNG this composition's export layout asks for.
      const type = sniff(Buffer.from(layer.buffer, layer.byteOffset, Math.min(layer.byteLength, SNIFF_BYTES)));
      const header = type?.format === 'png' ? pngHeader(layer) : null;
      const expected = exportLayout(composition).canvas;
      if (!header || header.colorType !== 6 || header.width !== expected.width || header.height !== expected.height) {
        throw new IpcError('export_mismatch', 'The rendered frame didn’t match the composition. Try again.');
      }
      const source = mediaRow(row.source_media_id)!;
      const sourcePath = join(paths.media, source.path);
      if (!existsSync(sourcePath)) throw new IpcError('source_missing', SOURCE_MISSING);

      const job = await runner.enqueue({
        documentId,
        draftId: drafts.getCurrent().id,
        openedFromAttachmentId,
        composition,
        info,
        sourcePath,
        sourceName: source.original_name,
        layer,
      });
      return { job, revision };
    },

    cancelExport: (jobId) => runner.cancel(jobId),
    job: (jobId) => runner.get(jobId),
    exportActivity: () => runner.activity(),

    async filmstrip(documentId, signal) {
      const row = documentRow(documentId);
      const info = videoOf(row);
      if (!info) throw new IpcError('not_a_video', 'Only videos have a filmstrip.');
      const tools = await video.binaries();
      if (!tools) throw new IpcError('ffmpeg_missing', FFMPEG_NEEDED);
      const source = mediaRow(row.source_media_id)!;
      const file = join(paths.media, source.path);
      if (!existsSync(file)) throw new IpcError('source_missing', SOURCE_MISSING);
      try {
        return await filmstrip({ ffmpeg: tools.ffmpeg, source: file, durationMs: info.durationMs, dir: join(paths.tmp, 'filmstrips', source.sha256), signal });
      } catch (err) {
        log.warn('studio: filmstrip failed', documentId, err);
        throw new IpcError('filmstrip_failed', 'Couldn’t make the timeline’s thumbnails.');
      }
    },

    dispose: () => runner.dispose(),
  };
  return service;
}
