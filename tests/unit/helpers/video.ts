import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { bundledMigrations, openDatabase, type Db } from '../../../src/main/db';
import { migrate } from '../../../src/main/db/migrate';
import type { Logger } from '../../../src/main/log';
import { appPaths, prepareUserData, type AppPaths } from '../../../src/main/paths';
import { createDraftsService, type DraftsService } from '../../../src/main/services/drafts/service';
import { createSerialQueue } from '../../../src/main/services/drafts/queue';
import { locateFfmpeg, type FfmpegBinaries } from '../../../src/main/services/ffmpeg/locate';
import { probeVideo } from '../../../src/main/services/ffmpeg/probe';
import { createMediaService, type MediaService } from '../../../src/main/services/media/service';
import { createStudioService, type StudioService } from '../../../src/main/services/studio/service';
import type { ServiceContext } from '../../../src/main/services/types';
import type { Layout } from '../../../src/shared/composition/layout';
import type { ExportJob } from '../../../src/shared/contracts/studio';

// Shared by the video tests: find FFmpeg, generate fixtures with lavfi (never
// committed), build the real electron-free services on a migrated database,
// and read exports back with ffprobe / ffmpeg.

export const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** The FFmpeg on PATH (or Homebrew's), or null. XBOT_REQUIRE_FFMPEG=1 turns "not found" into a failure. */
export async function findFfmpeg(): Promise<FfmpegBinaries | null> {
  const found = await locateFfmpeg({ userPath: null, resourcesPath: null, env: process.env, platform: process.platform });
  if (found.state === 'ready') return found.binaries;
  if (process.env.XBOT_REQUIRE_FFMPEG === '1') throw new Error(`XBOT_REQUIRE_FFMPEG=1 but FFmpeg isn't usable: ${found.message}`);
  console.warn(`Skipping the FFmpeg tests: ${found.message}`);
  return null;
}

/** Runs a tool with an argument array; stdout as a Buffer. */
export function run(file: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${file} ${args.join(' ')}\n${stderr.toString()}`));
      else resolve(stdout);
    });
  });
}

const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** testsrc2 plus a 440 Hz stereo tone, BT.709-tagged. */
export async function makeClip(ffmpeg: string, file: string, { seconds, width = 640, height = 360 }: { seconds: number; width?: number; height?: number }): Promise<string> {
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', ...BT709_TAGS, '-c:a', 'aac', '-ac', '2', '-shortest', '-movflags', '+faststart', file,
  ]);
  return file;
}

export const QUADRANTS = {
  topLeft: [230, 40, 40],
  topRight: [40, 200, 60],
  bottomLeft: [40, 70, 220],
  bottomRight: [235, 210, 40],
  centre: [200, 60, 200],
} as const;

/** A still picture: four flat quadrants with a flat square in the middle (a quarter of the height). */
export function quadrantPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  const box = height / 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBox = Math.abs(x - width / 2) < box && Math.abs(y - height / 2) < box;
      const [r, g, b] = inBox
        ? QUADRANTS.centre
        : y < height / 2
          ? x < width / 2
            ? QUADRANTS.topLeft
            : QUADRANTS.topRight
          : x < width / 2
            ? QUADRANTS.bottomLeft
            : QUADRANTS.bottomRight;
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** The quadrant picture as a static clip with a tone, BT.709-tagged. */
export async function makeQuadrantClip(ffmpeg: string, dir: string, file: string, { seconds, width = 640, height = 360 }: { seconds: number; width?: number; height?: number }): Promise<string> {
  const still = join(dir, 'quadrants.png');
  writeFileSync(still, quadrantPng(width, height));
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', still,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', ...BT709_TAGS, '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file,
  ]);
  return file;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The frame at `seconds`, decoded through BT.709 limited range (pinned, so both sides use one matrix). */
export async function frameAt(ffmpeg: string, file: string, seconds: number): Promise<PNG> {
  const png = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', seconds.toFixed(3), '-i', file, '-frames:v', '1',
    '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24', '-c:v', 'png', '-f', 'image2pipe', '-',
  ]);
  return PNG.sync.read(png);
}

export function pixel(png: PNG, x: number, y: number): Rgb {
  const i = (Math.floor(y) * png.width + Math.floor(x)) * 4;
  return { r: png.data[i]!, g: png.data[i + 1]!, b: png.data[i + 2]! };
}

export function distance(a: Rgb, b: Rgb | readonly number[]): number {
  const [r, g, bl] = Array.isArray(b) ? b : [(b as Rgb).r, (b as Rgb).g, (b as Rgb).b];
  return Math.max(Math.abs(a.r - r!), Math.abs(a.g - g!), Math.abs(a.b - bl!));
}

export const LAYER_BACKGROUND = [32, 64, 128] as const;
export const LAYER_FRAME = [43, 44, 49] as const;

/**
 * A stand-in for the renderer's frame layer (an RGBA PNG at the export size):
 * a flat background, the frame rect in the chrome colour, and a transparent
 * hole over the content rect.
 */
export function syntheticLayer(layout: Layout): Uint8Array {
  const { width, height } = layout.canvas;
  const png = new PNG({ width, height });
  const inside = (rect: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
    x + 0.5 >= rect.x && x + 0.5 <= rect.x + rect.width && y + 0.5 >= rect.y && y + 0.5 <= rect.y + rect.height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const hole = inside(layout.content, x, y);
      const [r, g, b] = inside(layout.frame, x, y) ? LAYER_FRAME : LAYER_BACKGROUND;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = hole ? 0 : 255;
    }
  }
  return new Uint8Array(PNG.sync.write(png, { colorType: 6 }));
}

export interface ProbedStream {
  index: number;
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  side_data_list?: unknown[];
}

export async function ffprobe(ffprobePath: string, file: string): Promise<{ streams: ProbedStream[]; format: { duration: string; tags?: Record<string, string> } }> {
  const out = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(out.toString('utf8'));
}

export interface Harness {
  userData: string;
  paths: AppPaths;
  db: Db;
  events: ServiceContext['events'];
  drafts: DraftsService;
  media: MediaService;
  studio: StudioService;
  close(): void;
}

/** The real drafts, media and studio services on a fresh, migrated userData; FFmpeg is `bins` (or missing for null). */
export async function harness(bins: FfmpegBinaries | null, { realtime = false }: { realtime?: boolean } = {}): Promise<Harness> {
  const userData = mkdtempSync(join(tmpdir(), 'xbot-video-'));
  const paths = appPaths(userData);
  prepareUserData(paths);
  const db = openDatabase(paths.db);
  migrate(db, bundledMigrations());
  const events = new EventEmitter() as ServiceContext['events'];
  const drafts = createDraftsService(db, { events });
  const media = createMediaService({
    db,
    paths,
    log: silent,
    tools: { makeThumbnail: async () => false, inspectVideo: async (file) => (bins ? probeVideo(bins.ffprobe, file) : null) },
    drafts,
  });
  await media.init();
  const studio = createStudioService({
    db,
    paths,
    log: silent,
    media,
    drafts,
    events,
    video: { binaries: async () => bins },
    serialize: createSerialQueue(),
    realtime,
  });
  await studio.init(null);
  return {
    userData,
    paths,
    db,
    events,
    drafts,
    media,
    studio,
    close() {
      studio.dispose();
      db.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** Resolves with the job once `done` holds for one of its `export:progress` events. */
export function waitForJob(events: ServiceContext['events'], jobId: string, done: (job: ExportJob) => boolean = (job) => job.status !== 'queued' && job.status !== 'running'): Promise<ExportJob> {
  return new Promise((resolve) => {
    const listener = ({ job }: { job: ExportJob }) => {
      if (job.id !== jobId || !done(job)) return;
      events.off('export:progress', listener);
      resolve(job);
    };
    events.on('export:progress', listener);
  });
}

/** The file of the current draft's attachment that holds `documentId`'s export. */
export function exportedFile(h: Harness, documentId: string): string {
  const path = h.db
    .prepare(
      `SELECT m.path FROM draft_attachments a JOIN drafts d ON d.id = a.draft_id AND d.is_current = 1
       JOIN media m ON m.id = a.media_id WHERE a.studio_document_id = ?`,
    )
    .pluck()
    .get(documentId) as string;
  return join(h.paths.media, path);
}

export const readBytes = (file: string) => readFileSync(file);
