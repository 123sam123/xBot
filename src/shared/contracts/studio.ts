// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Payload schemas, settings, events and the bridge API for the
// `studio` domain live here; the aggregators already import this file.
import { z } from 'zod';
import { MAX_EXPORT_BYTES, type Composition, type Style } from '../composition/model';
import { compositionSchema, styleSchema } from '../composition/schema';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';
import type { MediaItem } from './media';

/** An editable Studio document: one source image and its composition. */
export interface StudioDocument {
  id: string;
  /** Bumped by every save; a save must name the revision it started from. */
  revision: number;
  composition: Composition;
  source: MediaItem;
  /** The source file is gone from disk: only "Replace source" works. */
  sourceMissing: boolean;
  /** The image background's media, when there is one. */
  background: MediaItem | null;
  /** GIF sources export their first frame, as PNG. */
  gif: boolean;
  updatedAt: string;
}

/** Media the Studio shows read-only (video, until T5). */
export interface StudioView {
  draftId: string;
  attachmentId: string;
  media: MediaItem;
}

export type StudioSession = { document: StudioDocument } | { view: StudioView } | null;
export type StudioOpened = { document: StudioDocument } | { view: StudioView } | { error: string };

export interface StudioPreset {
  id: string;
  name: string;
  style: Style;
  background: MediaItem | null;
  createdAt: string;
}

export interface StudioImportResult {
  document: StudioDocument;
  /** Files that were not opened, and why. */
  ignored: { name: string; message: string }[];
}

export interface SaveResult {
  revision: number;
  updatedAt: string;
}

export interface AddToPostResult {
  draftId: string;
  attachmentId: string;
  exportId: string;
  revision: number;
}

export const saveCompositionSchema = z.strictObject({
  documentId: z.uuid(),
  baseRevision: z.number().int().min(0),
  composition: compositionSchema,
});

export const studioImportSchema = z.strictObject({
  // `path` is '' for a File that is not on disk; main names it in `ignored`.
  files: z
    .array(z.strictObject({ name: z.string().max(255), path: z.string().max(4096) }))
    .min(1)
    .max(200),
});

export const pickMediaSchema = z.strictObject({ purpose: z.enum(['source', 'background']) });

export const savePresetSchema = z.strictObject({ name: z.string().trim().min(1).max(60), style: styleSchema });

export const presetIdSchema = z.strictObject({ id: z.uuid() });

export const addToPostSchema = z.strictObject({
  documentId: z.uuid(),
  baseRevision: z.number().int().min(0),
  composition: compositionSchema,
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_EXPORT_BYTES, 'The export must be 1 byte to 20 MB.'),
});

export const studioSettings = {
  /** The document the Studio reopens after a restart. */
  'studio.currentDocumentId': defineSetting(z.uuid().nullable(), null),
} satisfies SettingsShape;

export interface StudioEvents {
  /** Export job progress, 0–1. */
  'export:progress': { jobId: string; progress: number };
  /** The Studio's document changed: "Edit in Studio ↗", a pick or a drop. */
  'studio:opened': StudioOpened;
  /** The app is quitting: save pending edits now, then call `studio.flushed()`. */
  'studio:flush-requested': Record<string, never>;
  'studio:fullscreen': { on: boolean };
}

export const studioForwardedEvents = ['studio:opened', 'studio:flush-requested', 'studio:fullscreen'] as const satisfies readonly (keyof StudioEvents)[];

export interface StudioApi {
  current(): Promise<IpcResult<StudioSession>>;
  /** Opens the image picker; null when cancelled. */
  pick(): Promise<IpcResult<StudioDocument | null>>;
  /** Opens the first image of dropped `File`s; the preload resolves their paths. */
  importFiles(files: readonly File[]): Promise<IpcResult<StudioImportResult>>;
  save(documentId: string, baseRevision: number, composition: Composition): Promise<IpcResult<SaveResult>>;
  /** Picks an image for a new source or a background; null when cancelled. */
  pickMedia(purpose: 'source' | 'background'): Promise<IpcResult<MediaItem | null>>;
  listPresets(): Promise<IpcResult<StudioPreset[]>>;
  savePreset(name: string, style: Style): Promise<IpcResult<StudioPreset>>;
  deletePreset(id: string): Promise<IpcResult<null>>;
  /** Saves `composition`, stores the rendered `bytes` and puts them on the current draft. */
  addToPost(documentId: string, baseRevision: number, composition: Composition, bytes: Uint8Array): Promise<IpcResult<AddToPostResult>>;
  /** Returns whether the Studio is now full screen. */
  toggleFullscreen(): Promise<IpcResult<boolean>>;
  /** Acknowledges `studio:flush-requested`. */
  flushed(): Promise<IpcResult<null>>;
}
