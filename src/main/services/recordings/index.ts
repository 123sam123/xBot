import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, desktopCapturer, screen, shell, systemPreferences } from 'electron';
import type { CameraCommand, CaptureSource, RecorderSetup, RecordingState, ScreenPermission, StartRecordingOptions } from '../../../shared/contracts/recordings';
import { cameraOffsetMs, cursorTrack } from '../../../shared/recording/track';
import { IpcError } from '../../ipc/core';
import { hideBar, hideCamera, hidePanel, showBar, showCamera, showPanel } from '../../windows/recorder';
import { openStudio } from '../../windows/studio';
import { draftsQueue } from '../drafts/queue';
import { ffmpeg } from '../ffmpeg';
import { runTool } from '../ffmpeg/run';
import { media } from '../media';
import { MediaRejected } from '../media/service';
import { adoptOpened, beginOpen } from '../studio';
import { studio } from '../studio';
import type { ServiceContext, ServiceModule } from '../types';
import { createCapture, PermissionDenied, type Capture, type CaptureStarted } from './capture';

// Screen recording, Cap's way: the recorder panel picks what to record, a
// 3-2-1 countdown, the native capture (no cursor; the cursor is tracked and
// drawn by the editor), the camera bubble recording alongside, a stop bar,
// and on Stop the recording is saved and opened in the Studio. A recording's
// folder (userData/recordings/<id>) keeps the camera video, the cursor track
// and images, and meta.json; its screen video becomes the document's media.

const FPS = 60;
const COUNTDOWN = 3;
const CAMERA_FLUSH_MS = 8000;

interface Session {
  id: string;
  dir: string;
  options: StartRecordingOptions;
  started: CaptureStarted | null;
  /** Date.now() and host time read together: converts the camera's clock. */
  clock: { date: number; host: number } | null;
  camera: { stream: WriteStream; file: string; startedAt: number | null; done: Promise<void>; finish(): void } | null;
  elapsedMs: number;
  /** Date.now() when recording last (re)started; null while paused. */
  runningSince: number | null;
  status: RecordingState['status'];
  countdown: number;
  canceled: boolean;
}

let ctx: ServiceContext | null = null;
let capture: Capture | null = null;
let session: Session | null = null;

function state(): RecordingState {
  const now = Date.now();
  return {
    status: session?.status ?? 'idle',
    id: session?.id ?? null,
    elapsedMs: session ? session.elapsedMs + (session.runningSince ? now - session.runningSince : 0) : 0,
    at: now,
    countdown: session?.countdown ?? 0,
    camera: session?.options.cameraId != null,
  };
}

function publish(): void {
  ctx?.events.emit('recording:state', state());
}

function camera(id: string, command: CameraCommand): void {
  ctx?.events.emit('recording:camera', { id, command });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function permission(): ScreenPermission {
  return capture?.addon?.screenPermission() ? 'granted' : 'denied';
}

async function sources(): Promise<{ displays: CaptureSource[]; windows: CaptureSource[] }> {
  const found = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
  const displays: CaptureSource[] = [];
  const windows: CaptureSource[] = [];
  const named = new Map(screen.getAllDisplays().map((d, i) => [d.id, d.label || (i === 0 ? 'Built-in Display' : `Display ${i + 1}`)]));
  for (const source of found) {
    const [kind, id] = source.id.split(':');
    const thumbnail = source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL();
    if (kind === 'screen') {
      const displayId = Number(source.display_id || id);
      displays.push({ kind: 'display', id: displayId, name: named.get(displayId) ?? source.name, thumbnail });
    } else if (kind === 'window' && !/^xBot/.test(source.name)) {
      windows.push({ kind: 'window', id: Number(id), name: source.name, thumbnail });
    }
  }
  return { displays, windows };
}

async function setup(): Promise<RecorderSetup> {
  const addon = capture?.addon ?? null;
  const granted = permission() === 'granted';
  const { displays, windows } = granted ? await sources() : { displays: [], windows: [] };
  return {
    supported: addon !== null,
    unsupportedReason: capture?.unavailable ?? null,
    permission: granted ? 'granted' : 'denied',
    displays,
    windows,
    microphones: addon?.microphoneSupported() ? addon.microphones() : [],
    microphoneSupported: addon?.microphoneSupported() ?? false,
  };
}

/** Asks for screen recording access once; after a refusal, opens the Privacy pane. */
function requestPermission(): ScreenPermission {
  if (!capture?.addon) return 'denied';
  if (capture.addon.screenPermission()) return 'granted';
  if (!capture.addon.requestScreenPermission()) {
    void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return permission();
}

async function askMedia(kind: 'camera' | 'microphone'): Promise<void> {
  if (process.platform !== 'darwin') return;
  if (systemPreferences.getMediaAccessStatus(kind) === 'granted') return;
  if (!(await systemPreferences.askForMediaAccess(kind))) {
    throw new IpcError(`${kind}_denied`, `xBot can’t use the ${kind}. Allow it in System Settings → Privacy & Security → ${kind === 'camera' ? 'Camera' : 'Microphone'}.`);
  }
}

async function start(options: StartRecordingOptions): Promise<void> {
  if (!capture?.addon) throw new IpcError('recording_unavailable', capture?.unavailable ?? 'Recording is unavailable.');
  if (session) throw new IpcError('recording_busy', 'A recording is already running.');
  if (permission() !== 'granted') throw new IpcError('screen_permission', 'Allow xBot to record your screen first.');
  if (options.cameraId) await askMedia('camera');
  if (options.microphoneId) await askMedia('microphone');

  const id = randomUUID();
  const dir = join(ctx!.paths.recordings, id);
  await mkdir(join(dir, 'cursors'), { recursive: true });
  const current: Session = { id, dir, options, started: null, clock: null, camera: null, elapsedMs: 0, runningSince: null, status: 'countdown', countdown: COUNTDOWN, canceled: false };
  session = current;

  for (let n = COUNTDOWN; n > 0; n--) {
    current.countdown = n;
    publish();
    await sleep(1000);
    if (current.canceled) return;
  }
  hidePanel();
  current.countdown = 0;
  // Let the panel leave the screen before the first frame.
  await sleep(120);
  if (current.canceled) return;

  const { target } = options;
  try {
    capture.addon.startCursor();
    current.started = await capture.start({
      output: join(dir, 'screen.mp4'),
      fps: FPS,
      systemAudio: options.systemAudio,
      microphoneId: options.microphoneId,
      ...(target.kind === 'window' ? { windowId: target.windowId } : { displayId: target.displayId }),
      ...(target.kind === 'area' ? { rect: target.rect } : {}),
    });
  } catch (err) {
    capture.addon.stopCursor();
    session = null;
    await rm(dir, { recursive: true, force: true });
    publish();
    showPanel();
    if (err instanceof PermissionDenied) throw new IpcError('screen_permission', 'Allow xBot to record your screen in System Settings → Privacy & Security → Screen Recording, then try again.');
    ctx?.log.error('recordings: capture failed to start', err);
    throw new IpcError('capture_failed', err instanceof Error ? err.message : 'The recording couldn’t start.');
  }
  current.clock = { date: Date.now(), host: capture.addon.hostTime() };
  current.status = 'recording';
  current.runningSince = Date.now();
  if (options.cameraId) camera(id, 'record');
  showBar();
  publish();
}

function pause(): void {
  if (!session || session.status !== 'recording' || !session.runningSince) return;
  capture?.addon?.pauseCapture();
  if (session.camera) camera(session.id, 'pause');
  session.elapsedMs += Date.now() - session.runningSince;
  session.runningSince = null;
  session.status = 'paused';
  publish();
}

function resume(): void {
  if (!session || session.status !== 'paused') return;
  capture?.addon?.resumeCapture();
  if (session.camera) camera(session.id, 'resume');
  session.runningSince = Date.now();
  session.status = 'recording';
  publish();
}

/** Stops everything native and the camera; returns what was captured (null if the capture never started). */
async function halt(current: Session, keepCamera: boolean): Promise<{ stopped: Awaited<ReturnType<Capture['stop']>>; cursor: ReturnType<NonNullable<Capture['addon']>['stopCursor']> } | null> {
  current.canceled = true;
  if (!current.started || !capture?.addon) return null;
  if (current.camera || current.options.cameraId) camera(current.id, keepCamera ? 'stop' : 'discard');
  const [stopped] = await Promise.all([
    capture.stop(),
    current.camera && keepCamera ? Promise.race([current.camera.done, sleep(CAMERA_FLUSH_MS)]) : Promise.resolve(),
  ]);
  const cursor = capture.addon.stopCursor();
  current.camera?.stream.end();
  return { stopped, cursor };
}

async function discard(): Promise<void> {
  const current = session;
  if (!current) return;
  session = null;
  hideBar();
  try {
    await halt(current, false);
  } catch (err) {
    ctx?.log.warn('recordings: stopping a discarded recording failed', err);
  }
  await rm(current.dir, { recursive: true, force: true });
  publish();
}

async function restart(): Promise<void> {
  const options = session?.options;
  if (!options) return;
  await discard();
  showPanel();
  await start(options);
}

/**
 * Each audio track as its own file (system.m4a, mic.m4a), so the editor can
 * set their volumes apart. The writer adds the system track before the mic's.
 */
async function splitAudio(screenFile: string, dir: string, has: { system: boolean; microphone: boolean }): Promise<{ system: string | null; microphone: string | null }> {
  const files = { system: has.system ? 'system.m4a' : null, microphone: has.microphone ? 'mic.m4a' : null };
  const tools = await ffmpeg().binaries();
  if (!tools || (!files.system && !files.microphone)) return { system: null, microphone: null };
  const outputs = [files.system, files.microphone].filter((file): file is string => file !== null);
  await runTool(
    tools.ffmpeg,
    ['-hide_banner', '-nostdin', '-y', '-i', screenFile, ...outputs.flatMap((file, i) => ['-map', `0:a:${i}`, '-vn', '-c', 'copy', join(dir, file)])],
    { timeoutMs: 10 * 60_000 },
  );
  return files;
}

/** Mixes the system and microphone tracks into one, first, for playback; keeps both after it. */
async function mixAudio(screenFile: string, out: string, tracks: number): Promise<string> {
  const tools = await ffmpeg().binaries();
  if (!tools || tracks < 2) return screenFile;
  await runTool(
    tools.ffmpeg,
    [
      '-hide_banner', '-nostdin', '-y', '-i', screenFile,
      '-filter_complex', '[0:a:0][0:a:1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]',
      '-map', '0:v', '-map', '[mix]', '-map', '0:a:0', '-map', '0:a:1',
      '-c:v', 'copy', '-c:a:0', 'aac', '-b:a:0', '192k', '-c:a:1', 'copy', '-c:a:2', 'copy',
      '-disposition:a:0', 'default', '-disposition:a:1', '0', '-disposition:a:2', '0',
      '-movflags', '+faststart', out,
    ],
    { timeoutMs: 15 * 60_000 },
  );
  return out;
}

const nameFor = (date: Date) =>
  `Recording ${date.toISOString().slice(0, 10)} at ${date.toTimeString().slice(0, 8).replaceAll(':', '.')}.mp4`;

async function stop(): Promise<void> {
  const current = session;
  if (!current || (current.status !== 'recording' && current.status !== 'paused')) return;
  current.status = 'finishing';
  if (current.runningSince) current.elapsedMs += Date.now() - current.runningSince;
  current.runningSince = null;
  publish();

  try {
    const result = await halt(current, true);
    if (!result || !current.started) throw new Error('Nothing was recorded.');
    const { stopped, cursor } = result;

    const track = cursorTrack(cursor.events, cursor.cursors, { ...stopped, bounds: current.started.bounds });
    await Promise.all(cursor.cursors.map((image) => writeFile(join(current.dir, 'cursors', `${image.id}.png`), image.png)));
    await writeFile(join(current.dir, 'cursor.json'), JSON.stringify(track));

    let cameraMeta: { file: string; offsetMs: number } | null = null;
    if (current.camera?.startedAt && current.clock && existsSync(current.camera.file) && (await stat(current.camera.file)).size > 0) {
      const startHost = current.clock.host + (current.camera.startedAt - current.clock.date) / 1000;
      cameraMeta = { file: current.camera.file.slice(current.dir.length + 1), offsetMs: Math.round(cameraOffsetMs(startHost, stopped.firstHost, stopped.pauses)) };
    }
    const tracks = (current.options.systemAudio ? 1 : 0) + (current.options.microphoneId ? 1 : 0);
    const screenFile = join(current.dir, 'screen.mp4');
    const audio = await splitAudio(screenFile, current.dir, { system: current.options.systemAudio, microphone: current.options.microphoneId !== null });
    const meta = {
      version: 1,
      createdAt: new Date().toISOString(),
      target: current.options.target,
      frame: { width: current.started.width, height: current.started.height, scale: current.started.scale },
      bounds: current.started.bounds,
      durationMs: Math.round(current.elapsedMs),
      /** Each audio track's own file, or null. */
      audio,
      pauses: stopped.pauses,
      camera: cameraMeta,
      cursor: track.samples.length > 0 ? { file: 'cursor.json' } : null,
    };
    await writeFile(join(current.dir, 'meta.json'), JSON.stringify(meta, null, 2));

    const playable = await mixAudio(screenFile, join(current.dir, 'recording.mp4'), tracks);
    const item = await draftsQueue(async () => {
      try {
        return await media().importLoose({ name: nameFor(new Date()), path: playable });
      } catch (err) {
        if (err instanceof MediaRejected) throw new IpcError('media_rejected', err.message);
        throw err;
      }
    });
    // The media folder has its own copy now.
    await rm(screenFile, { force: true });
    if (playable !== screenFile) await rm(playable, { force: true });

    ctx!.db.prepare('INSERT INTO recordings (id, dir, meta_json, created_at) VALUES (?, ?, ?, ?)').run(current.id, current.id, JSON.stringify(meta), meta.createdAt);
    beginOpen();
    const document = await studio().createForRecording(item, current.id, { camera: cameraMeta !== null, cursor: meta.cursor ? track : null, audio: audio.system !== null || audio.microphone !== null });
    const opened = adoptOpened({ document }, null);
    ctx?.events.emit('studio:opened', opened);
    openStudio();
  } catch (err) {
    ctx?.log.error('recordings: saving the recording failed', err);
    ctx?.events.emit('studio:opened', { error: err instanceof IpcError ? err.message : 'The recording couldn’t be saved.' });
    openStudio();
  } finally {
    session = null;
    hideBar();
    hideCamera();
    publish();
  }
}

// ---------------------------------------------------------------- camera bubble

function cameraStarted(id: string, startedAt: number, mime: string): void {
  if (!session || session.id !== id) throw new IpcError('recording_gone', 'That recording is over.');
  const file = join(session.dir, mime.includes('mp4') ? 'camera.mp4' : 'camera.webm');
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  session.camera = { stream: createWriteStream(file, { flags: 'w' }), file, startedAt, done, finish };
}

function cameraChunk(id: string, bytes: Uint8Array): Promise<void> {
  const cam = session?.id === id ? session.camera : null;
  if (!cam) return Promise.resolve();
  return new Promise((resolve, reject) => cam.stream.write(bytes, (err) => (err ? reject(err) : resolve())));
}

function cameraDone(id: string): void {
  if (session?.id === id) session.camera?.finish();
}

export const recordings = {
  setup,
  requestPermission,
  start,
  pause,
  resume,
  stop,
  restart,
  discard,
  state,
  cameraStarted,
  cameraChunk,
  cameraDone,
  /** The camera bubble shows `deviceId` (null hides it). */
  setCamera(deviceId: string | null) {
    ctx?.events.emit('recording:camera-device', { deviceId });
    if (deviceId) showCamera();
    else hideCamera();
  },
  openPanel() {
    if (session) return;
    showPanel();
  },
  closePanel() {
    hidePanel();
    if (!session) {
      ctx?.events.emit('recording:camera-device', { deviceId: null });
      hideCamera();
    }
  },
  /** The desktop picture of display `displayId`, as JPEG bytes. */
  desktopWallpaper(displayId: number): Buffer | null {
    return capture?.addon?.desktopWallpaperJpeg(displayId) ?? null;
  },
};

export const recordingsModule: ServiceModule = {
  name: 'recordings',
  init(context) {
    ctx = context;
    capture = createCapture({
      platform: process.platform,
      load() {
        const addon = { exports: {} };
        process.dlopen(addon, join(app.getAppPath(), 'native', 'capture', 'build', 'capture.node'));
        return addon.exports;
      },
      log: context.log,
    });
    if (capture.unavailable) context.log.warn('recordings:', capture.unavailable);
  },
  async dispose() {
    if (session) await discard().catch(() => {});
    ctx = null;
  },
};
