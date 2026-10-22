// Owned by T3 (XBOT-6F4GAC). Drafts: the post being written, its history and
// its attachments.
import { z } from 'zod';
import type { SettingsShape } from './define';
import type { IpcResult } from './ipc';
import type { MediaItem } from './media';

/** One piece of media on a draft, in post order. */
export interface Attachment {
  id: string;
  position: number;
  media: MediaItem;
}

export interface Draft {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
}

/** A history entry. */
export interface DraftSummary {
  id: string;
  /** The first line of the text, shortened; '' for a media-only draft. */
  preview: string;
  updatedAt: string;
  mediaCount: number;
  thumbUrl: string | null;
}

/** The attachment "Edit in Studio ↗" opened. T4 takes this hand-off over. */
export interface StudioTarget {
  draftId: string;
  attachmentId: string;
  media: MediaItem;
}

/** Storage bound for a draft's text (X's own ceiling for long posts). */
export const DRAFT_TEXT_MAX = 25_000;

export const draftIdSchema = z.strictObject({ id: z.uuid() });
export const updateDraftSchema = z.strictObject({ id: z.uuid(), text: z.string().max(DRAFT_TEXT_MAX) });
export const attachmentRefSchema = z.strictObject({ draftId: z.uuid(), attachmentId: z.uuid() });
export const reorderAttachmentsSchema = z.strictObject({
  draftId: z.uuid(),
  attachmentIds: z.array(z.uuid()).min(1).max(200),
});

export const draftsSettings = {} satisfies SettingsShape;

export interface DraftsEvents {
  /** A draft's attachments changed, or another draft became current. Text saves do not emit it. */
  'draft:changed': { draftId: string };
  /** "Edit in Studio ↗" chose the media the Studio shows. */
  'draft:studio-target': StudioTarget;
  /** The app is quitting: save pending text now, then call `drafts.flushed()`. */
  'drafts:flush-requested': Record<string, never>;
}

export const draftsForwardedEvents = ['draft:changed', 'draft:studio-target', 'drafts:flush-requested'] as const satisfies readonly (keyof DraftsEvents)[];

export interface DraftsApi {
  /** The draft the composer edits; an empty one is created when there is none. */
  getCurrent(): Promise<IpcResult<Draft>>;
  update(id: string, text: string): Promise<IpcResult<{ updatedAt: string }>>;
  /** History: drafts other than the current one that have text or media, newest first. */
  list(): Promise<IpcResult<DraftSummary[]>>;
  /** Makes a history draft current; the old one goes to history (or away, if empty). */
  restore(id: string): Promise<IpcResult<Draft>>;
  /** Deletes a history draft. The current draft cannot be deleted. */
  delete(id: string): Promise<IpcResult<null>>;
  /** Starts an empty draft; the current one goes to history (or away, if empty). */
  startNew(): Promise<IpcResult<Draft>>;
  removeAttachment(draftId: string, attachmentId: string): Promise<IpcResult<Draft>>;
  /** `attachmentIds` must list every attachment of the draft, in the new order. */
  reorderAttachments(draftId: string, attachmentIds: readonly string[]): Promise<IpcResult<Draft>>;
  /** Writes the saved text of draft `id` to the clipboard. */
  copyText(id: string): Promise<IpcResult<null>>;
  /** Shows the Studio with this attachment's media. */
  openInStudio(draftId: string, attachmentId: string): Promise<IpcResult<null>>;
  getStudioTarget(): Promise<IpcResult<StudioTarget | null>>;
  /** Acknowledges `drafts:flush-requested`. */
  flushed(): Promise<IpcResult<null>>;
}
