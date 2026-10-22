// Owned by T3 (XBOT-6F4GAC). Imported media: what the renderer sees of a media
// row, the import / export payloads, and the bridge API.
import { z } from 'zod';
import type { SettingsShape } from './define';
import type { Draft } from './drafts';
import type { IpcResult } from './ipc';

export type MediaKind = 'image' | 'video';

/** One imported file. `url` and `thumbUrl` are `xbot-media://` URLs. */
export interface MediaItem {
  id: string;
  kind: MediaKind;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  bytes: number;
  /** The file's original name, for labels and exported file names. */
  name: string;
  url: string;
  /** A small PNG; null when none could be made (the card then shows the image or a video tile). */
  thumbUrl: string | null;
}

/** A file that was not imported, and why, in words for the user. */
export interface ImportRejection {
  name: string;
  message: string;
}

export interface ImportResult {
  draft: Draft;
  rejected: ImportRejection[];
}

/** Null when the user cancelled the folder picker. */
export type ExportResult = { count: number; folder: string } | null;

/** Files the main process takes from one import call; the rest are rejected. */
export const MAX_IMPORT_FILES = 20;

export const importMediaSchema = z.strictObject({
  draftId: z.uuid(),
  // `path` is '' for a File that is not on disk (e.g. an image dragged out of a browser).
  files: z
    .array(z.strictObject({ name: z.string().max(255), path: z.string().max(4096) }))
    .min(1)
    .max(200),
});
export type ImportMediaPayload = z.infer<typeof importMediaSchema>;

export const draftMediaSchema = z.strictObject({ draftId: z.uuid() });

const MEDIA_URL_PREFIX = 'xbot-media://media/';

/** The `xbot-media://` URL for a path relative to userData/media. */
export function mediaUrl(relativePath: string): string {
  return MEDIA_URL_PREFIX + relativePath.split('/').map(encodeURIComponent).join('/');
}

export const mediaSettings = {} satisfies SettingsShape;

export interface MediaEvents {
  /** Media was imported from outside the composer (a drop on the menu-bar icon). */
  'media:imported': { draftId: string; rejected: ImportRejection[] };
}

export const mediaForwardedEvents = ['media:imported'] as const satisfies readonly (keyof MediaEvents)[];

export interface MediaApi {
  /** Imports dropped files into the draft. Takes `File`s; the preload resolves their paths. */
  importFiles(draftId: string, files: readonly File[]): Promise<IpcResult<ImportResult>>;
  /** Opens the file picker, then imports what was chosen. A cancel returns the draft unchanged. */
  pick(draftId: string): Promise<IpcResult<ImportResult>>;
  /** Copies the draft's media, in order, into a folder the user picks. */
  exportForDraft(draftId: string): Promise<IpcResult<ExportResult>>;
}
