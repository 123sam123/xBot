import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { nativeImage, type NativeImage } from 'electron';
import type { Logger } from '../../log';
import type { MediaTools } from './service';
import { ProbeError } from './sniff';

// Electron-side decoding and thumbnails for the media service.
// - PNG / JPEG must decode with nativeImage (it decodes only those two).
// - Thumbnails come from QuickLook (`createThumbnailFromPath`, macOS and
//   Windows): it honours EXIF rotation and makes MP4 / MOV posters with no
//   FFmpeg. It is raced against a timeout, because it can stall.
// - Without it: PNG / JPEG are resized here; video falls back to ffmpeg if one
//   is installed (T5 refines video), and GIF / WebP use the file itself.

const THUMB_SIZE = 480;
const QUICKLOOK_TIMEOUT_MS = 10_000;
const FFMPEG_TIMEOUT_MS = 15_000;

async function quickLook(file: string): Promise<NativeImage | null> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), QUICKLOOK_TIMEOUT_MS);
    });
    const image = await Promise.race([nativeImage.createThumbnailFromPath(file, { width: THUMB_SIZE, height: THUMB_SIZE }), timeout]);
    return image && !image.isEmpty() ? image : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fitWithin(image: NativeImage): NativeImage {
  const { width, height } = image.getSize();
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  if (scale === 1) return image;
  return image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
}

/** An ffmpeg binary, if one is installed. Apps started from Finder have a short PATH, so Homebrew's folders come first. */
function findFfmpeg(): string | null {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(delimiter).filter(Boolean)];
  for (const dir of dirs) {
    const candidate = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function ffmpegPoster(file: string, out: string, log: Logger): Promise<boolean> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return Promise.resolve(false);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease`, out];
  return new Promise((resolve) => {
    execFile(ffmpeg, args, { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true }, (err) => {
      if (err) log.warn('media: ffmpeg poster failed', err.message);
      resolve(!err && existsSync(out));
    });
  });
}

export function electronMediaTools(log: Logger): MediaTools {
  return {
    async makeThumbnail(file, info, out) {
      if (info.format === 'png' || info.format === 'jpeg') {
        const image = nativeImage.createFromPath(file);
        if (image.isEmpty()) throw new ProbeError('unreadable');
        const thumb = (info.format === 'jpeg' ? await quickLook(file) : null) ?? fitWithin(image);
        await writeFile(out, thumb.toPNG());
        return true;
      }
      const thumb = await quickLook(file);
      if (thumb) {
        await writeFile(out, thumb.toPNG());
        return true;
      }
      return info.kind === 'video' ? ffmpegPoster(file, out, log) : false;
    },
  };
}
