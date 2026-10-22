// Screen recording: the recorder panel, the camera bubble, the stop bar and
// the area picker (one `recorder` page), and main's capture. Payload schemas,
// events and the bridge API for the `recordings` domain.
import { z } from 'zod';
import type { IpcResult } from './ipc';

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What to record: a display, one window, or an area of a display (points, relative to the display). */
export type CaptureTarget =
  | { kind: 'display'; displayId: number }
  | { kind: 'window'; windowId: number }
  | { kind: 'area'; displayId: number; rect: CaptureRect };

export interface CaptureSource {
  kind: 'display' | 'window';
  /** CGDirectDisplayID for a display, CGWindowID for a window. */
  id: number;
  name: string;
  /** A small JPEG data URL. */
  thumbnail: string;
}

export interface Microphone {
  id: string;
  name: string;
}

export type ScreenPermission = 'granted' | 'denied';

export interface RecorderSetup {
  /** The native recorder loaded and macOS is 13 or later. */
  supported: boolean;
  /** Why not, when it isn't. */
  unsupportedReason: string | null;
  permission: ScreenPermission;
  displays: CaptureSource[];
  windows: CaptureSource[];
  microphones: Microphone[];
  /** Microphone capture needs macOS 15. */
  microphoneSupported: boolean;
}

export interface StartRecordingOptions {
  target: CaptureTarget;
  /** The browser's camera deviceId (the bubble records it), or null for no camera. */
  cameraId: string | null;
  microphoneId: string | null;
  systemAudio: boolean;
}

export type RecordingStatus = 'idle' | 'countdown' | 'recording' | 'paused' | 'finishing';

export interface RecordingState {
  status: RecordingStatus;
  /** The recording's id while one is running. */
  id: string | null;
  /** Recorded time, ms, as of `at`. */
  elapsedMs: number;
  /** Date.now() when `elapsedMs` was taken; while recording, the bar adds the time since. */
  at: number;
  /** 3, 2, 1 during the countdown. */
  countdown: number;
  camera: boolean;
}

/** What the camera bubble is asked to do. */
export type CameraCommand = 'record' | 'pause' | 'resume' | 'stop' | 'discard';

/** One saved recording, for the Recordings list. */
export interface RecordingSummary {
  id: string;
  /** The Studio document it opens as (null if that document is gone). */
  documentId: string | null;
  name: string;
  durationMs: number;
  createdAt: string;
  thumbUrl: string | null;
  camera: boolean;
}

export interface RecordingsEvents {
  'recording:state': RecordingState;
  /** To the camera bubble: start, pause, resume, stop or drop its recording. */
  'recording:camera': { id: string; command: CameraCommand };
  /** To the camera bubble: show this camera (null hides it). */
  'recording:camera-device': { deviceId: string | null };
}

export const recordingsForwardedEvents = ['recording:state', 'recording:camera', 'recording:camera-device'] as const satisfies readonly (keyof RecordingsEvents)[];

const rectSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(16),
  height: z.number().finite().min(16),
});

export const startRecordingSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('display'), displayId: z.number().int().min(0) }),
    z.strictObject({ kind: z.literal('window'), windowId: z.number().int().min(1) }),
    z.strictObject({ kind: z.literal('area'), displayId: z.number().int().min(0), rect: rectSchema }),
  ]),
  cameraId: z.string().max(512).nullable(),
  microphoneId: z.string().max(512).nullable(),
  systemAudio: z.boolean(),
});

export const pickAreaSchema = z.strictObject({ displayId: z.number().int().min(0) });
export const areaPickedSchema = z.strictObject({ rect: rectSchema.nullable() });
export const cameraDeviceSchema = z.strictObject({ deviceId: z.string().max(512).nullable() });
export const cameraStartedSchema = z.strictObject({ id: z.uuid(), startedAt: z.number().finite(), mime: z.string().max(100) });
export const cameraChunkSchema = z.strictObject({
  id: z.uuid(),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 64 * 1024 * 1024, 'A chunk must be 1 byte to 64 MB.'),
});
export const recordingIdSchema = z.strictObject({ id: z.uuid() });

export interface RecordingsApi {
  /** What can be recorded, with thumbnails, and whether recording is possible. */
  setup(): Promise<IpcResult<RecorderSetup>>;
  /** Shows the recorder panel (Write Post's Record, the menu bar's Start Recording). */
  openPanel(): Promise<IpcResult<null>>;
  closePanel(): Promise<IpcResult<null>>;
  /** Asks macOS for screen recording access, or opens System Settings when it was refused. */
  requestPermission(): Promise<IpcResult<ScreenPermission>>;
  /** Shows the area overlay on a display; resolves with the area, or null when cancelled. */
  pickArea(displayId: number): Promise<IpcResult<CaptureRect | null>>;
  /** The overlay's answer. */
  areaPicked(rect: CaptureRect | null): Promise<IpcResult<null>>;
  /** Shows the camera bubble with this camera, or hides it. */
  setCamera(deviceId: string | null): Promise<IpcResult<null>>;
  /** Counts down, then records. */
  start(options: StartRecordingOptions): Promise<IpcResult<null>>;
  pause(): Promise<IpcResult<null>>;
  resume(): Promise<IpcResult<null>>;
  /** Stops, saves the recording and opens it in the Studio. */
  stop(): Promise<IpcResult<null>>;
  /** Drops what was recorded and starts again. */
  restart(): Promise<IpcResult<null>>;
  /** Drops the recording. */
  discard(): Promise<IpcResult<null>>;
  state(): Promise<IpcResult<RecordingState>>;
  /** The camera bubble: its MediaRecorder started (Date.now()). */
  cameraStarted(id: string, startedAt: number, mime: string): Promise<IpcResult<null>>;
  /** The camera bubble: the next piece of its recording, in order. */
  cameraChunk(id: string, bytes: Uint8Array): Promise<IpcResult<null>>;
  /** The camera bubble: every chunk has been sent. */
  cameraDone(id: string): Promise<IpcResult<null>>;
  /** Saved recordings, newest first. */
  list(): Promise<IpcResult<RecordingSummary[]>>;
  /** Opens a recording in the Studio. */
  open(id: string): Promise<IpcResult<null>>;
  /** Shows a recording's folder in Finder. */
  reveal(id: string): Promise<IpcResult<null>>;
  /** Deletes a recording and its Studio document (exports already on posts stay). */
  remove(id: string): Promise<IpcResult<null>>;
}
