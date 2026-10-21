import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { computeLayout } from '../../../shared/composition/layout';
import { defaultComposition, effectiveFormat, gradientBackground, MAX_EDIT_PIXELS, type Composition, type Style } from '../../../shared/composition/model';
import { compositionSchema, styleSchema } from '../../../shared/composition/schema';
import type { MediaItem } from '../../../shared/contracts/media';
import type { AddToPostResult, SaveResult, StudioDocument, StudioPreset, StudioView } from '../../../shared/contracts/studio';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import type { AppPaths } from '../../paths';
import type { DraftsService } from '../drafts/service';
import { MediaRejected, type MediaService } from '../media/service';
import { toMediaItem, type MediaRow } from '../media/rows';
import { probe, sniff, SNIFF_BYTES } from '../media/sniff';
import type { ServiceContext } from '../types';

// Studio documents, exports and presets. No `electron` import: the IPC layer
// supplies pickers and windows. A document is one source image plus its
// composition (shared/composition); every save names the revision it started
// from, so a stale page can never overwrite newer edits. "Add to post" checks
// the rendered bytes against computeLayout before storing them as media and
// putting them on the current draft, in place of the document's last export.

/** Unlinked documents untouched for this long are deleted at startup. */
export const DOCUMENT_GC_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface StudioServiceDeps {
  db: Db;
  paths: Pick<AppPaths, 'media' | 'tmp'>;
  log: Logger;
  media: Pick<MediaService, 'importLoose'>;
  drafts: Pick<DraftsService, 'getCurrent'>;
  events: ServiceContext['events'];
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

export interface StudioService {
  /** Startup: deletes old documents nothing links to, except `keepId`. */
  collectGarbage(keepId: string | null): void;
  exists(documentId: string): boolean;
  get(documentId: string): StudioDocument;
  /** The attachment's document, created and linked on first open; video opens read-only. */
  openForAttachment(draftId: string, attachmentId: string): { document: StudioDocument } | { view: StudioView };
  /** The newest document for this image (or for the document it was exported from), else a new one. */
  openForMedia(item: MediaItem): StudioDocument;
  save(documentId: string, baseRevision: number, composition: Composition): SaveResult;
  listPresets(): StudioPreset[];
  savePreset(name: string, style: Style): StudioPreset;
  deletePreset(id: string): void;
  addToPost(input: AddToPostInput): Promise<AddToPostResult>;
}

interface DocumentRow {
  id: string;
  source_media_id: string;
  background_media_id: string | null;
  composition_json: string;
  composition_backup: string | null;
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

const STALE = 'This document changed elsewhere. Reloaded the latest version.';

export function createStudioService({ db, paths, log, media, drafts, events, now = () => new Date() }: StudioServiceDeps): StudioService {
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
      `INSERT INTO studio_documents (id, source_media_id, background_media_id, composition_json, revision, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 0, ?, ?)`,
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

  /** The stored composition, or the defaults (keeping the unreadable JSON) when it is corrupt or no longer fits its source. */
  function readComposition(row: DocumentRow, source: MediaRow): Composition {
    let parsed: Composition | null = null;
    try {
      const result = compositionSchema.safeParse(JSON.parse(row.composition_json));
      if (result.success) parsed = result.data;
    } catch {
      // not JSON
    }
    if (parsed && parsed.source.mediaId === source.id && parsed.source.width === source.width && parsed.source.height === source.height) {
      return parsed;
    }
    log.warn('studio: unreadable composition; using the defaults and keeping a backup', row.id);
    const fallback = defaultComposition({ mediaId: source.id, width: source.width ?? 1, height: source.height ?? 1 });
    q.replaceCorrupt.run(JSON.stringify(fallback), row.composition_json, row.id);
    row.revision += 1;
    row.background_media_id = null;
    return fallback;
  }

  function toDocument(row: DocumentRow): StudioDocument {
    const source = mediaRow(row.source_media_id)!; // NOT NULL foreign key
    let composition = readComposition(row, source);
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

  function create(source: MediaRow, size: { width: number; height: number }): DocumentRow {
    const id = randomUUID();
    const at = stamp();
    const composition = defaultComposition({ mediaId: source.id, ...size });
    q.insertDocument.run(id, source.id, JSON.stringify(composition), at, at);
    return q.document.get(id)!;
  }

  function checkBackground(background: Composition['background'] | Style['background']): string | null {
    if (background.type !== 'image') return null;
    const row = mediaRow(background.mediaId);
    if (!row || row.kind !== 'image') throw new IpcError('invalid_background', 'That background image no longer exists.');
    return row.id;
  }

  const service: StudioService = {
    collectGarbage(keepId) {
      const cutoff = new Date(now().getTime() - DOCUMENT_GC_AGE_MS).toISOString();
      const { changes } = q.collect.run({ cutoff, keep: keepId ?? '' });
      if (changes > 0) log.info(`studio: removed ${changes} unused document(s)`);
    },

    exists: (documentId) => q.document.get(documentId) !== undefined,

    get(documentId) {
      return toDocument(documentRow(documentId));
    },

    openForAttachment(draftId, attachmentId) {
      const opened = db.transaction((): { documentId: string } | { view: StudioView } => {
        const attachment = q.attachment.get(attachmentId, draftId);
        if (!attachment) throw new IpcError('attachment_not_found', 'That attachment is no longer on the draft.');
        const linked = attachment.studio_document_id ?? q.exportOf.get(attachment.media_id)?.document_id ?? null;
        if (linked && q.document.get(linked)) {
          if (attachment.studio_document_id !== linked) q.link.run(linked, attachment.id);
          return { documentId: linked };
        }
        const source = mediaRow(attachment.media_id)!;
        const size = editableImage(source);
        if (!size) return { view: { draftId, attachmentId, media: toMediaItem(source) } };
        const row = create(source, size);
        q.link.run(row.id, attachment.id);
        return { documentId: row.id };
      })();
      return 'view' in opened ? { view: opened.view } : { document: service.get(opened.documentId) };
    },

    openForMedia(item) {
      const source = mediaRow(item.id);
      if (!source) throw new IpcError('media_rejected', `${item.name} couldn’t be opened.`);
      const fromExport = q.exportOf.get(source.id)?.document_id;
      if (fromExport && q.document.get(fromExport)) return service.get(fromExport);
      const size = editableImage(source);
      if (!size) throw new IpcError('not_an_image', 'Media Studio edits images. Add videos from Write Post.');
      const existing = q.latestForSource.get(source.id);
      return toDocument(existing ? documentRow(existing.id) : create(source, size));
    },

    save(documentId, baseRevision, composition) {
      return db.transaction(() => {
        const row = documentRow(documentId);
        if (row.revision !== baseRevision) throw new IpcError('stale_revision', STALE);
        const source = mediaRow(composition.source.mediaId);
        if (!source || source.kind !== 'image' || source.width !== composition.source.width || source.height !== composition.source.height) {
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
          const expected = computeLayout(composition, { scale: composition.output.scale }).canvas;
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

        const draft = drafts.getCurrent();
        const exportId = randomUUID();
        const attachmentId = db.transaction(() => {
          const at = stamp();
          q.insertExport.run(exportId, documentId, item.id, format, composition.output.scale, item.width, item.height, at);
          const attachments = q.draftAttachments.all(draft.id);
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
            q.insertAttachment.run(id, draft.id, item.id, q.nextPosition.get(draft.id)!.next, at, documentId);
          }
          q.unlinkOthers.run(draft.id, documentId, id);
          q.deleteUnusedExports.run(documentId);
          q.touchDraft.run(at, draft.id);
          return id;
        })();
        events.emit('draft:changed', { draftId: draft.id });
        return { draftId: draft.id, attachmentId, exportId, revision };
      } finally {
        adding.delete(documentId);
      }
    },
  };
  return service;
}
