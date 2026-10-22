import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaRejected } from '../../src/main/services/media/service';
import { findFfmpeg, harness, makeClip, run, type Harness } from './helpers/video';

// SPEC §22 "Invalid media", for video: a file that isn't a readable video is
// refused at import, before anything is stored, with the sentence the user
// sees. T3's box check already catches a truncated file; ffprobe (T5) also
// catches a damaged `moov`, garbage where the frames should be, and an MP4
// with no picture in it. Skipped with a message when FFmpeg is absent;
// XBOT_REQUIRE_FFMPEG=1 makes that a failure.

const bins = await findFfmpeg();
const TIMEOUT = 60_000;

let fixtures: string;
const files = { good: '', truncated: '', badMoov: '', zeroFrames: '', audioOnly: '' };

beforeAll(async () => {
  if (!bins) return;
  fixtures = mkdtempSync(join(tmpdir(), 'xbot-video-bad-'));
  files.good = await makeClip(bins.ffmpeg, join(fixtures, 'good.mp4'), { seconds: 2 });
  const bytes = readFileSync(files.good);

  // Cut off mid-download: the `mdat` box now runs past the end of the file.
  files.truncated = join(fixtures, 'truncated.mp4');
  writeFileSync(files.truncated, bytes.subarray(0, Math.floor(bytes.length * 0.6)));

  // Every box still fits, but the sample-size table is garbage: ffprobe can't read the header.
  const badMoov = Buffer.from(bytes);
  const stsz = badMoov.indexOf('stsz');
  badMoov.fill(0xff, stsz + 12, stsz + 12 + 400);
  files.badMoov = join(fixtures, 'bad-moov.mp4');
  writeFileSync(files.badMoov, badMoov);

  // Headers intact, frames zeroed: only decoding the first frame tells.
  const zeroFrames = Buffer.from(bytes);
  const mdat = zeroFrames.indexOf('mdat');
  zeroFrames.fill(0, mdat + 4);
  files.zeroFrames = join(fixtures, 'zero-frames.mp4');
  writeFileSync(files.zeroFrames, zeroFrames);

  files.audioOnly = join(fixtures, 'audio-only.mp4');
  await run(bins.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', files.audioOnly]);
}, TIMEOUT);

afterAll(() => {
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

function expectNothingStored(h: Harness): void {
  expect(h.db.prepare('SELECT COUNT(*) FROM media').pluck().get()).toBe(0);
  expect(h.db.prepare('SELECT COUNT(*) FROM studio_documents').pluck().get()).toBe(0);
  expect(h.db.prepare('SELECT COUNT(*) FROM draft_attachments').pluck().get()).toBe(0);
  expect(readdirSync(h.paths.media)).toEqual(['thumbs']);
  expect(readdirSync(join(h.paths.media, 'thumbs'))).toEqual([]);
  expect(readdirSync(h.paths.tmp)).toEqual([]);
}

describe.skipIf(!bins)('video import rejects files that are not readable videos', () => {
  it('refuses a truncated MP4 in the Studio and in the composer, storing nothing', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      // The Studio's open (pick or drop) imports loose media first.
      await expect(h.media.importLoose({ name: 'truncated.mp4', path: files.truncated })).rejects.toThrow(
        new MediaRejected('truncated.mp4 couldn’t be read as a video. It may be incomplete.'),
      );
      const draft = h.drafts.getCurrent();
      const result = await h.media.importFiles(draft.id, [{ name: 'truncated.mp4', path: files.truncated }]);
      expect(result.rejected).toEqual([{ name: 'truncated.mp4', message: 'truncated.mp4 couldn’t be read as a video. It may be incomplete.' }]);
      expect(result.draft.attachments).toEqual([]);
      expectNothingStored(h);
    } finally {
      h.close();
    }
  });

  it('refuses a damaged moov, frames that do not decode and an MP4 without a picture', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      const damaged = 'couldn’t be read as a video. It may be incomplete or damaged.';
      const draft = h.drafts.getCurrent();
      const result = await h.media.importFiles(draft.id, [
        { name: 'bad-moov.mp4', path: files.badMoov },
        { name: 'zero-frames.mp4', path: files.zeroFrames },
        { name: 'audio-only.mp4', path: files.audioOnly },
      ]);
      expect(result.rejected).toEqual([
        { name: 'bad-moov.mp4', message: `bad-moov.mp4 ${damaged}` },
        { name: 'zero-frames.mp4', message: `zero-frames.mp4 ${damaged}` },
        { name: 'audio-only.mp4', message: 'audio-only.mp4 has no video in it.' },
      ]);
      expectNothingStored(h);

      // The same files the box check alone would have let through:
      const unchecked = await harness(null);
      try {
        const accepted = await unchecked.media.importFiles(unchecked.drafts.getCurrent().id, [
          { name: 'zero-frames.mp4', path: files.zeroFrames },
          { name: 'audio-only.mp4', path: files.audioOnly },
        ]);
        expect(accepted.rejected).toEqual([]);
      } finally {
        unchecked.close();
      }
    } finally {
      h.close();
    }
  });

  it('stores a good MP4 with ffprobe’s size and duration, and still attaches video when FFmpeg is missing', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      const item = await h.media.importLoose({ name: 'good.mp4', path: files.good });
      expect(item).toMatchObject({ kind: 'video', width: 640, height: 360 });
      expect(Math.abs((item.durationMs ?? 0) - 2000)).toBeLessThanOrEqual(50);
    } finally {
      h.close();
    }
    const noFfmpeg = await harness(null);
    try {
      const result = await noFfmpeg.media.importFiles(noFfmpeg.drafts.getCurrent().id, [{ name: 'good.mp4', path: files.good }]);
      expect(result.rejected).toEqual([]);
      expect(result.draft.attachments).toHaveLength(1);
      // Without FFmpeg the Studio opens it read-only, with guidance, instead of as a document.
      const opened = await noFfmpeg.studio.openForAttachment(result.draft.id, result.draft.attachments[0]!.id);
      expect('view' in opened).toBe(true);
    } finally {
      noFfmpeg.close();
    }
  });
});
