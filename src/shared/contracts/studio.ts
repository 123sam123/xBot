// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Payload schemas, settings, events and the bridge API for the
// `studio` domain live here; the aggregators already import this file.
import { z } from 'zod';
import { MAX_EXPORT_BYTES, type Composition, type Style } from '../composition/model';
import { compositionSchema, styleSchema } from '../composition/schema';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';
import type { MediaItem } from './media';

/**
 * What ffprobe said about a video source (T5), stored with its document.
 * Sizes are display sizes: rotation and pixel aspect applied.
 */
export interface VideoInfo {
  /** The video stream's duration (not the container's: audio may run longer). */
  durationMs: number;
  width: number;
  height: number;
  /** The display-matrix rotation, clockwise. */
  rotation: 0 | 90 | 180 | 270;
  /** The export frame rate (≤ 60) and the same as FFmpeg's rational, for the `fps` filter. */
  fps: number;
  frameRate: string;
  /** Stream indexes in the file; never a cover-art stream. */
  videoStream: number;
  audioStream: number | null;
  videoCodec: string;
  audioCodec: string | null;
  audioChannels: number;
  audioSampleRate: number;
  /** Stored (coded) size and pixel aspect, e.g. "1:1". */
  codedWidth: number;
  codedHeight: number;
  sampleAspect: string;
  colorSpace: string | null;
  colorRange: 'tv' | 'pc' | null;
  /** HLG or PQ transfer: xBot doesn't convert HDR, so the export's colours will be off. */
  hdr: boolean;
}

export type ExportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** One video export ("Add to post" on a video document). */
export interface ExportJob {
  id: string;
  documentId: string;
  status: ExportJobStatus;
  /** 0–1, from FFmpeg's `out_time_us` over the trimmed length. */
  progress: number;
  /** The sentence the user sees when it failed or was canceled. */
  error: string | null;
  /** The stored export once it succeeded. */
  exportId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type H264Encoder = 'libx264' | 'h264_videotoolbox';

export type FfmpegMissingReason = 'not-found' | 'no-ffprobe' | 'timeout' | 'too-old' | 'no-h264' | 'blocked' | 'not-ffmpeg' | 'disabled';

/** Whether video editing and export can run, and if not, what to do about it. */
export type FfmpegStatus =
  | { state: 'checking' }
  | { state: 'ready'; version: string; encoder: H264Encoder; path: string }
  | { state: 'missing'; reason: FfmpegMissingReason; message: string };

/** An editable Studio document: one source image or video and its composition. */
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
  /** Set for a video document: what ffprobe read when the document was created. */
  video: VideoInfo | null;
  /** The document's queued or running export, so a reopened Studio shows its progress. */
  exportJob: ExportJob | null;
  updatedAt: string;
}

/**
 * Media the Studio shows read-only: a video while FFmpeg is missing. The
 * attachment is set when it was opened with "Edit in Studio ↗".
 */
export interface StudioView {
  draftId: string | null;
  attachmentId: string | null;
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
  /** What the first openable file became. */
  opened: { document: StudioDocument } | { view: StudioView };
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

export interface ExportVideoResult {
  job: ExportJob;
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

/** The frame layer is a PNG at the export size: everything but the video, with a hole where it shows. */
export const exportVideoSchema = z.strictObject({
  documentId: z.uuid(),
  baseRevision: z.number().int().min(0),
  composition: compositionSchema,
  layer: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_EXPORT_BYTES, 'The frame layer must be 1 byte to 20 MB.'),
});

export const jobIdSchema = z.strictObject({ jobId: z.uuid() });

export const documentIdSchema = z.strictObject({ documentId: z.uuid() });

export const studioSettings = {
  /** The document the Studio reopens after a restart. */
  'studio.currentDocumentId': defineSetting(z.uuid().nullable(), null),
  // The user's FFmpeg (Locate FFmpeg…) is deliberately not a setting here:
  // `settings:set` takes any registry key, and the renderer must never choose
  // what main spawns. The ffmpeg service stores it itself (see FFMPEG.md).
} satisfies SettingsShape;

export interface StudioEvents {
  /** A video export job moved: queued, progress, finished. */
  'export:progress': { job: ExportJob };
  /** The Studio's document changed: "Edit in Studio ↗", a pick or a drop. */
  'studio:opened': StudioOpened;
  /** The app is quitting: save pending edits now, then call `studio.flushed()`. */
  'studio:flush-requested': Record<string, never>;
  'studio:fullscreen': { on: boolean };
  /** FFmpeg was found, lost or re-checked. */
  'studio:ffmpeg': FfmpegStatus;
}

export const studioForwardedEvents = [
  'export:progress',
  'studio:opened',
  'studio:flush-requested',
  'studio:fullscreen',
  'studio:ffmpeg',
] as const satisfies readonly (keyof StudioEvents)[];

export interface StudioApi {
  current(): Promise<IpcResult<StudioSession>>;
  /** Opens the image and video picker; null when cancelled. */
  pick(): Promise<IpcResult<StudioSession>>;
  /** Opens the first image or video of dropped `File`s; the preload resolves their paths. */
  importFiles(files: readonly File[]): Promise<IpcResult<StudioImportResult>>;
  save(documentId: string, baseRevision: number, composition: Composition): Promise<IpcResult<SaveResult>>;
  /** Picks an image for a new source or a background; null when cancelled. */
  pickMedia(purpose: 'source' | 'background'): Promise<IpcResult<MediaItem | null>>;
  listPresets(): Promise<IpcResult<StudioPreset[]>>;
  savePreset(name: string, style: Style): Promise<IpcResult<StudioPreset>>;
  deletePreset(id: string): Promise<IpcResult<null>>;
  /** Saves `composition`, stores the rendered `bytes` and puts them on the current draft. */
  addToPost(documentId: string, baseRevision: number, composition: Composition, bytes: Uint8Array): Promise<IpcResult<AddToPostResult>>;
  /** Saves a video document's `composition` and queues its MP4 export over the frame `layer` PNG. */
  exportVideo(documentId: string, baseRevision: number, composition: Composition, layer: Uint8Array): Promise<IpcResult<ExportVideoResult>>;
  /** Stops a queued or running export; resolves once FFmpeg has exited and its files are gone. */
  cancelExport(jobId: string): Promise<IpcResult<ExportJob>>;
  /** The video's filmstrip: JPEG frames evenly spaced over its duration. */
  filmstrip(documentId: string): Promise<IpcResult<Uint8Array[]>>;
  ffmpegStatus(): Promise<IpcResult<FfmpegStatus>>;
  /** Looks for FFmpeg again ("Check again"). */
  checkFfmpeg(): Promise<IpcResult<FfmpegStatus>>;
  /** Lets the user pick the ffmpeg program; null when cancelled. */
  locateFfmpeg(): Promise<IpcResult<FfmpegStatus | null>>;
  /** Returns whether the Studio is now full screen. */
  toggleFullscreen(): Promise<IpcResult<boolean>>;
  /** Acknowledges `studio:flush-requested`. */
  flushed(): Promise<IpcResult<null>>;
}
