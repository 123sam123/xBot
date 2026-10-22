import type { Logger } from '../../log';

// The native recorder (native/capture/capture.mm), typed and loaded safely:
// without the addon, or before macOS 13, recording is simply unavailable.
// Electron-free, so the rest of the recordings service is unit-testable.

export interface CaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureStarted {
  /** The file's frame size, px. */
  width: number;
  height: number;
  /** px per point in the file. */
  scale: number;
  /** The captured area in global points, top-left origin. */
  bounds: CaptureBounds;
}

export interface CaptureStopped {
  /** Host time of the first frame: the recording's time 0. */
  firstHost: number;
  endHost: number;
  /** Paused spans, host time. */
  pauses: [number, number][];
  frames: number;
}

export interface RawCursorEvent {
  t: number;
  x: number;
  y: number;
  /** 0 move, 1 down, 2 up. */
  type: number;
  button: number;
  cursor: number;
}

export interface RawCursorImage {
  id: number;
  png: Buffer;
  hotX: number;
  hotY: number;
  width: number;
  height: number;
}

export interface CaptureOptions {
  displayId?: number;
  windowId?: number;
  rect?: CaptureBounds;
  output: string;
  fps: number;
  systemAudio: boolean;
  microphoneId?: string | null;
}

export interface CaptureAddon {
  supported(): boolean;
  microphoneSupported(): boolean;
  screenPermission(): boolean;
  requestScreenPermission(): boolean;
  hostTime(): number;
  microphones(): { id: string; name: string }[];
  desktopWallpaper(displayId: number): string | null;
  desktopWallpaperJpeg(displayId: number): Buffer | null;
  startCapture(options: CaptureOptions, callback: (error: Error | null, result?: CaptureStarted) => void): void;
  pauseCapture(): void;
  resumeCapture(): void;
  stopCapture(callback: (error: Error | null, result?: CaptureStopped) => void): void;
  startCursor(): void;
  stopCursor(): { events: RawCursorEvent[]; cursors: RawCursorImage[] };
}

export interface Capture {
  /** The addon, or null with the reason recording can't run. */
  addon: CaptureAddon | null;
  unavailable: string | null;
  start(options: CaptureOptions): Promise<CaptureStarted>;
  stop(): Promise<CaptureStopped>;
}

/** Thrown when macOS refused screen recording access. */
export class PermissionDenied extends Error {}

export function createCapture({ platform, load, log }: { platform: NodeJS.Platform; load(): unknown; log: Logger }): Capture {
  let addon: CaptureAddon | null = null;
  let unavailable: string | null = null;
  if (platform !== 'darwin') unavailable = 'Screen recording is macOS-only.';
  else {
    try {
      const loaded = load() as Partial<CaptureAddon> | null;
      if (typeof loaded?.startCapture !== 'function') unavailable = 'The screen recorder is missing. Reinstall xBot.';
      else if (!loaded.supported!()) unavailable = 'Screen recording needs macOS 13 or later.';
      else addon = loaded as CaptureAddon;
    } catch (err) {
      log.warn('recordings: native capture not loaded', err);
      unavailable = 'The screen recorder couldn’t load. Run `pnpm native` (or reinstall xBot).';
    }
  }
  return {
    addon,
    unavailable,
    start(options) {
      return new Promise((resolve, reject) => {
        if (!addon) return reject(new Error(unavailable ?? 'Recording is unavailable.'));
        addon.startCapture(options, (error, result) => {
          if (error) reject(error.message === 'permission' ? new PermissionDenied('Screen recording access was refused.') : error);
          else resolve(result!);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (!addon) return reject(new Error('Recording is unavailable.'));
        addon.stopCapture((error, result) => (error ? reject(error) : resolve(result!)));
      });
    },
  };
}
