import { randomUUID } from 'node:crypto';
import type { Attachment, Draft, DraftSummary } from '../../../shared/contracts/drafts';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import { previewUrl, toMediaItem, type MediaRow } from '../media/rows';
import type { ServiceContext } from '../types';

// Drafts and their attachments. No `electron` import: unit tests drive it with
// a temporary database. Every write is one transaction; better-sqlite3 nests a
// transaction opened inside another one as a savepoint, so the media service
// can attach inside its own import transaction.

export interface DraftsService {
  /** The draft the composer edits; an empty one is created when there is none. */
  getCurrent(): Draft;
  get(id: string): Draft;
  update(id: string, text: string): { updatedAt: string };
  list(limit?: number): DraftSummary[];
  restore(id: string): Draft;
  remove(id: string): void;
  startNew(): Draft;
  /** Appends media to a draft, skipping media it already has. */
  attach(draftId: string, mediaIds: readonly string[]): void;
  removeAttachment(draftId: string, attachmentId: string): Draft;
  reorderAttachments(draftId: string, attachmentIds: readonly string[]): Draft;
  attachment(draftId: string, attachmentId: string): Attachment;
}

interface DraftRow {
  id: string;
  text: string;
  is_current: 0 | 1;
  created_at: string;
  updated_at: string;
}

type AttachmentRow = MediaRow & { attachment_id: string; position: number };

const PREVIEW_CHARS = 120;

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

export function createDraftsService(
  db: Db,
  ctx: Pick<ServiceContext, 'events'> & { now?: () => Date },
): DraftsService {
  const now = () => (ctx.now?.() ?? new Date()).toISOString();

  const q = {
    current: db.prepare<[], DraftRow>('SELECT * FROM drafts WHERE is_current = 1'),
    byId: db.prepare<[string], DraftRow>('SELECT * FROM drafts WHERE id = ?'),
    insert: db.prepare('INSERT INTO drafts (id, text, is_current, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    setText: db.prepare('UPDATE drafts SET text = ?, updated_at = ? WHERE id = ?'),
    touch: db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?'),
    clearCurrent: db.prepare('UPDATE drafts SET is_current = 0 WHERE is_current = 1'),
    makeCurrent: db.prepare('UPDATE drafts SET is_current = 1 WHERE id = ?'),
    delete: db.prepare('DELETE FROM drafts WHERE id = ?'),
    history: db.prepare<[number], DraftRow & { media_count: number }>(
      `SELECT d.*, (SELECT COUNT(*) FROM draft_attachments a WHERE a.draft_id = d.id) AS media_count
       FROM drafts d
       WHERE d.is_current = 0
         AND (trim(d.text) <> '' OR EXISTS (SELECT 1 FROM draft_attachments a WHERE a.draft_id = d.id))
       ORDER BY d.updated_at DESC, d.rowid DESC
       LIMIT ?`,
    ),
    attachments: db.prepare<[string], AttachmentRow>(
      `SELECT a.id AS attachment_id, a.position, m.*
       FROM draft_attachments a JOIN media m ON m.id = a.media_id
       WHERE a.draft_id = ? ORDER BY a.position`,
    ),
    firstMedia: db.prepare<[string], MediaRow>(
      `SELECT m.* FROM draft_attachments a JOIN media m ON m.id = a.media_id
       WHERE a.draft_id = ? ORDER BY a.position LIMIT 1`,
    ),
    mediaIds: db.prepare<[string], { media_id: string }>('SELECT media_id FROM draft_attachments WHERE draft_id = ?'),
    nextPosition: db.prepare<[string], { next: number }>(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM draft_attachments WHERE draft_id = ?',
    ),
    insertAttachment: db.prepare(
      'INSERT INTO draft_attachments (id, draft_id, media_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    deleteAttachment: db.prepare('DELETE FROM draft_attachments WHERE id = ? AND draft_id = ?'),
    // Two-phase renumbering: move every position below zero, then set 0..n-1,
    // so UNIQUE(draft_id, position) never sees a duplicate.
    parkPositions: db.prepare('UPDATE draft_attachments SET position = -(position + 1) WHERE draft_id = ?'),
    setPosition: db.prepare('UPDATE draft_attachments SET position = ? WHERE id = ?'),
  };

  function row(id: string): DraftRow {
    const found = q.byId.get(id);
    if (!found) throw new IpcError('draft_not_found', 'That draft no longer exists.');
    return found;
  }

  function attachmentsOf(draftId: string): Attachment[] {
    return q.attachments.all(draftId).map((r) => ({ id: r.attachment_id, position: r.position, media: toMediaItem(r) }));
  }

  function toDraft(r: DraftRow): Draft {
    return { id: r.id, text: r.text, createdAt: r.created_at, updatedAt: r.updated_at, attachments: attachmentsOf(r.id) };
  }

  function isEmpty(r: DraftRow): boolean {
    return r.text.trim() === '' && q.mediaIds.all(r.id).length === 0;
  }

  function create(current: boolean): DraftRow {
    const stamp = now();
    const created: DraftRow = { id: randomUUID(), text: '', is_current: current ? 1 : 0, created_at: stamp, updated_at: stamp };
    q.insert.run(created.id, created.text, created.is_current, created.created_at, created.updated_at);
    return created;
  }

  /** Moves the current draft into history, or deletes it if it holds nothing. */
  function retireCurrent(): void {
    const old = q.current.get();
    q.clearCurrent.run(); // before any new current: the partial unique index is checked per statement
    if (old && isEmpty(old)) q.delete.run(old.id);
  }

  function renumber(orderedIds: readonly string[], draftId: string): void {
    q.parkPositions.run(draftId);
    orderedIds.forEach((id, index) => q.setPosition.run(index, id));
    q.touch.run(now(), draftId);
  }

  const changed = (draftId: string) => ctx.events.emit('draft:changed', { draftId });

  const service: DraftsService = {
    getCurrent() {
      return toDraft(db.transaction(() => q.current.get() ?? create(true))());
    },

    get(id) {
      return toDraft(row(id));
    },

    update(id, text) {
      const updatedAt = now();
      const { changes } = q.setText.run(text, updatedAt, id);
      if (changes === 0) throw new IpcError('draft_not_found', 'That draft no longer exists.');
      return { updatedAt };
    },

    list(limit = 50) {
      return q.history.all(limit).map((r) => {
        const first = q.firstMedia.get(r.id);
        return {
          id: r.id,
          preview: firstLine(r.text),
          updatedAt: r.updated_at,
          mediaCount: r.media_count,
          thumbUrl: first ? previewUrl(toMediaItem(first)) : null,
        };
      });
    },

    restore(id) {
      const restored = db.transaction(() => {
        const target = row(id);
        if (target.is_current) return target;
        retireCurrent();
        q.makeCurrent.run(id);
        return row(id);
      })();
      changed(restored.id);
      return toDraft(restored);
    },

    remove(id) {
      const target = row(id);
      if (target.is_current) throw new IpcError('draft_is_current', 'The draft you are writing cannot be deleted from history.');
      q.delete.run(id); // attachments go with it (ON DELETE CASCADE); unused media is collected at startup
    },

    startNew() {
      const fresh = db.transaction(() => {
        const current = q.current.get();
        if (current && isEmpty(current)) return current;
        retireCurrent();
        return create(true);
      })();
      changed(fresh.id);
      return toDraft(fresh);
    },

    attach(draftId, mediaIds) {
      db.transaction(() => {
        row(draftId);
        const present = new Set(q.mediaIds.all(draftId).map((r) => r.media_id));
        let position = q.nextPosition.get(draftId)!.next;
        const stamp = now();
        for (const mediaId of mediaIds) {
          if (present.has(mediaId)) continue;
          present.add(mediaId);
          q.insertAttachment.run(randomUUID(), draftId, mediaId, position++, stamp);
        }
        q.touch.run(stamp, draftId);
      })();
      changed(draftId);
    },

    removeAttachment(draftId, attachmentId) {
      db.transaction(() => {
        row(draftId);
        if (q.deleteAttachment.run(attachmentId, draftId).changes === 0) {
          throw new IpcError('attachment_not_found', 'That attachment is no longer on the draft.');
        }
        renumber(
          attachmentsOf(draftId).map((a) => a.id),
          draftId,
        );
      })();
      changed(draftId);
      return service.get(draftId);
    },

    reorderAttachments(draftId, attachmentIds) {
      db.transaction(() => {
        row(draftId);
        const existing = attachmentsOf(draftId).map((a) => a.id);
        const wanted = new Set(attachmentIds);
        if (wanted.size !== attachmentIds.length || wanted.size !== existing.length || existing.some((id) => !wanted.has(id))) {
          throw new IpcError('invalid_order', 'The new order must list every attachment of the draft once.');
        }
        renumber(attachmentIds, draftId);
      })();
      changed(draftId);
      return service.get(draftId);
    },

    attachment(draftId, attachmentId) {
      const found = attachmentsOf(row(draftId).id).find((a) => a.id === attachmentId);
      if (!found) throw new IpcError('attachment_not_found', 'That attachment is no longer on the draft.');
      return found;
    },
  };
  return service;
}
