import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import type { FfmpegMissingReason, FfmpegStatus, H264Encoder } from '../../../shared/contracts/studio';
import { runTool, ToolError, type Runner } from './run';

// Finds a usable FFmpeg: the user's pick (Locate FFmpeg…), a bundled copy
// under the app's resources (none ships in v1, see docs/FFMPEG.md), then
// Homebrew's folders and PATH. Apps started from Finder get a short PATH, so
// Homebrew's folders are searched explicitly. A candidate counts only if it
// really is FFmpeg ≥ 4.4 with an H.264 and an AAC encoder, and ffprobe is
// found too. No `electron` import.

export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  encoder: H264Encoder;
}

export interface LocateOptions {
  /** The user's pick, stored as picked: the ffmpeg program or its folder. */
  userPath: string | null;
  /** `process.resourcesPath` in a packaged app; a bundle would sit in `<it>/ffmpeg/`. */
  resourcesPath: string | null;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  timeoutMs?: number;
  run?: Runner;
}

export type LocateResult = { state: 'ready'; binaries: FfmpegBinaries } | Extract<FfmpegStatus, { state: 'missing' }>;

/** `-stats_period` (used for progress) arrived in FFmpeg 4.4. */
const MIN_VERSION: readonly [number, number] = [4, 4];
const INSTALL = 'Install it with Homebrew: brew install ffmpeg';

export const MISSING_MESSAGES: Record<Exclude<FfmpegMissingReason, 'too-old' | 'blocked' | 'not-ffmpeg'>, string> = {
  'not-found': `Video editing needs FFmpeg. ${INSTALL}, then Check again.`,
  'no-ffprobe': 'FFmpeg was found, but not ffprobe. Install the full FFmpeg: brew install ffmpeg',
  timeout: 'FFmpeg didn’t answer in time. Check again in a moment.',
  'no-h264': 'This FFmpeg can’t encode H.264 video (no libx264 or VideoToolbox). Install Homebrew’s: brew install ffmpeg',
  disabled: 'FFmpeg is turned off for this test run.',
};

function missing(reason: FfmpegMissingReason, message: string): LocateResult {
  return { state: 'missing', reason, message };
}

const exe = (name: string, platform: NodeJS.Platform) => (platform === 'win32' ? `${name}.exe` : name);

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    const real = await realpath(file);
    if (!(await stat(real)).isFile()) return false;
    await access(real, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** "ffmpeg version 8.1.2 Copyright …" → "8.1.2"; null when it is not FFmpeg's banner. */
export function parseVersion(banner: string, tool: 'ffmpeg' | 'ffprobe'): string | null {
  const match = new RegExp(`^${tool} version (\\S+)`).exec(banner.trimStart());
  return match ? match[1]! : null;
}

/** True for 4.4 and later; git builds ("N-112233-g…") have no number and are assumed current. */
export function versionSupported(version: string): boolean {
  const match = /^n?(\d+)\.(\d+)/.exec(version);
  if (!match) return true;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]);
}

/** The encoders `ffmpeg -encoders` lists, e.g. " V....D libx264   libx264 H.264 …". */
export function listedEncoders(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    const match = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (match) names.add(match[1]!);
  }
  return names;
}

/** libx264 first (best quality per bit, and what the tests exercise), then VideoToolbox. */
export function pickEncoder(encoders: ReadonlySet<string>): H264Encoder | null {
  if (encoders.has('libx264')) return 'libx264';
  if (encoders.has('h264_videotoolbox')) return 'h264_videotoolbox';
  return null;
}

function failureFor(err: unknown, file: string): LocateResult {
  if (err instanceof ToolError) {
    if (err.kind === 'timeout') return missing('timeout', MISSING_MESSAGES.timeout);
    if (err.kind === 'signal') {
      return missing('blocked', `macOS stopped ${file} from running. If you downloaded it, run: xattr -d com.apple.quarantine "${file}"`);
    }
  }
  return missing('not-ffmpeg', `${file} isn’t a working FFmpeg.`);
}

export async function locateFfmpeg({ userPath, resourcesPath, env, platform, timeoutMs = 15_000, run = runTool }: LocateOptions): Promise<LocateResult> {
  const ffmpegName = exe('ffmpeg', platform);
  const ffprobeName = exe('ffprobe', platform);

  // The user's pick may be the program or the folder holding it. If it no
  // longer works, the automatic search still runs; its problem is reported
  // only when nothing else is found.
  let userCandidate: string | null = null;
  let firstFailure: LocateResult | null = null;
  if (userPath && isAbsolute(userPath)) {
    try {
      userCandidate = (await stat(userPath)).isDirectory() ? join(userPath, ffmpegName) : userPath;
    } catch {
      firstFailure = missing('not-ffmpeg', `${userPath} no longer exists. Locate FFmpeg again.`);
    }
  }
  const dirs = [
    ...(resourcesPath ? [join(resourcesPath, 'ffmpeg')] : []),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(env.PATH ?? '').split(delimiter).filter((dir) => dir && isAbsolute(dir)),
  ];
  const candidates = [...new Set([...(userCandidate ? [userCandidate] : []), ...dirs.map((dir) => join(dir, ffmpegName))])];

  for (const candidate of candidates) {
    if (!(await isExecutableFile(candidate))) {
      if (candidate === userCandidate) firstFailure ??= missing('not-ffmpeg', `${candidate} isn’t a program xBot can run.`);
      continue;
    }
    const result = await check(candidate);
    if (result.state === 'ready') return result;
    firstFailure ??= result;
  }
  return firstFailure ?? missing('not-found', MISSING_MESSAGES['not-found']);

  async function check(ffmpeg: string): Promise<LocateResult> {
    let version: string | null;
    let encoders: Set<string>;
    try {
      version = parseVersion((await run(ffmpeg, ['-hide_banner', '-version'], { timeoutMs })).stdout, 'ffmpeg');
      if (!version) return missing('not-ffmpeg', `${ffmpeg} isn’t FFmpeg.`);
      if (!versionSupported(version)) {
        return missing('too-old', `FFmpeg ${version} is too old: xBot needs 4.4 or later. Update it: brew upgrade ffmpeg`);
      }
      encoders = listedEncoders((await run(ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs })).stdout);
    } catch (err) {
      return failureFor(err, ffmpeg);
    }
    const encoder = pickEncoder(encoders);
    if (!encoder || !encoders.has('aac')) return missing('no-h264', MISSING_MESSAGES['no-h264']);

    // ffprobe beside this ffmpeg (as found, then its real folder), else anywhere on the search path.
    const real = await realpath(ffmpeg).catch(() => ffmpeg);
    const probes = [...new Set([join(dirname(ffmpeg), ffprobeName), join(dirname(real), ffprobeName), ...dirs.map((dir) => join(dir, ffprobeName))])];
    for (const ffprobe of probes) {
      if (!(await isExecutableFile(ffprobe))) continue;
      try {
        if (parseVersion((await run(ffprobe, ['-hide_banner', '-version'], { timeoutMs })).stdout, 'ffprobe')) {
          return { state: 'ready', binaries: { ffmpeg, ffprobe, version, encoder } };
        }
      } catch {
        // try the next one
      }
    }
    return missing('no-ffprobe', MISSING_MESSAGES['no-ffprobe']);
  }
}
