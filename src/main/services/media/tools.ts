import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { nativeImage, type NativeImage } from 'electron';
import type { Logger } from '../../log';
import type { FfmpegService } from '../ffmpeg';
import { probeVideo } from '../ffmpeg/probe';
import { runTool } from '../ffmpeg/run';
import type { MediaTools } from './service';
import { ProbeError } from './sniff';

// Electron-side decoding and thumbnails for the media service.
// - PNG / JPEG must decode with nativeImage (it decodes only those two).
// - Thumbnails come from QuickLook (`createThumbnailFromPath`, macOS and
//   Windows): it honours EXIF rotation and makes MP4 / MOV posters with no
//   FFmpeg. It is raced against a timeout, because it can stall.
// - Without it: PNG / JPEG are resized here; video falls back to the FFmpeg the
//   ffmpeg service found, and GIF / WebP use the file itself.
// - Videos are checked with that FFmpeg's ffprobe before they are stored (T5).

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

async function ffmpegPoster(ffmpeg: FfmpegService, file: string, out: string, log: Logger): Promise<boolean> {
  const binaries = await ffmpeg.binaries();
  if (!binaries) return false;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease`, '-f', 'image2', '-c:v', 'png', '-update', '1', out];
  try {
    await runTool(binaries.ffmpeg, args, { timeoutMs: FFMPEG_TIMEOUT_MS });
    return existsSync(out);
  } catch (err) {
    log.warn('media: ffmpeg poster failed', err instanceof Error ? err.message : err);
    return false;
  }
}

export function electronMediaTools(log: Logger, ffmpeg: FfmpegService): MediaTools {
  return {
    async inspectVideo(file) {
      // Waits for a check still in progress (at most its timeout), so nothing slips through unchecked right after launch.
      const binaries = await ffmpeg.binaries();
      return binaries ? probeVideo(binaries.ffprobe, file) : null;
    },
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
      return info.kind === 'video' ? ffmpegPoster(ffmpeg, file, out, log) : false;
    },
  };
}
