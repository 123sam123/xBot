import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportLayout } from '../../src/shared/composition/layout';
import type { Composition } from '../../src/shared/composition/model';
import type { StudioDocument } from '../../src/shared/contracts/studio';
import {
  distance,
  exportedFile,
  ffprobe,
  findFfmpeg,
  frameAt,
  harness,
  LAYER_BACKGROUND,
  LAYER_FRAME,
  makeClip,
  makeQuadrantClip,
  pixel,
  QUADRANTS,
  run,
  syntheticLayer,
  waitForJob,
  type Harness,
} from './helpers/video';

// SPEC §16 / §22 "Image/video export" and "Canceling exports", against real
// FFmpeg: the whole main pipeline (import with ffprobe, video document,
// export job, FFmpeg, import of the MP4, attach) on a migrated database. The
// renderer's frame layer is stood in for by a flat PNG with a hole at the
// layout's content rect; the e2e spec checks the real one. Skipped with a
// message when FFmpeg is absent; XBOT_REQUIRE_FFMPEG=1 makes that a failure.

const bins = await findFfmpeg();
const TIMEOUT = 60_000;

let fixtures: string;
const clips = { six: '', quad: '', long: '', rotated: '' };

beforeAll(async () => {
  if (!bins) return;
  fixtures = mkdtempSync(join(tmpdir(), 'xbot-video-fixtures-'));
  clips.six = await makeClip(bins.ffmpeg, join(fixtures, 'six.mp4'), { seconds: 6 });
  clips.long = await makeClip(bins.ffmpeg, join(fixtures, 'long.mp4'), { seconds: 10 });
  clips.quad = await makeQuadrantClip(bins.ffmpeg, fixtures, join(fixtures, 'quad.mp4'), { seconds: 3 });
  // Rotation in two steps, so the turn is metadata, not baked into the pixels.
  clips.rotated = join(fixtures, 'rotated.mp4');
  await run(bins.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', clips.quad, '-c', 'copy', clips.rotated]);
}, TIMEOUT);

afterAll(() => {
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

/** Imports `file` the way the Studio does and opens it as a video document. */
async function openVideo(h: Harness, file: string, name: string): Promise<StudioDocument> {
  const item = await h.media.importLoose({ name, path: file });
  const opened = await h.studio.openForMedia(item);
  if (!('document' in opened)) throw new Error('expected a document');
  expect(opened.document.video).not.toBeNull();
  return opened.document;
}

/** Saves `composition` and runs its export to the end. */
async function exportVideo(h: Harness, doc: StudioDocument, composition: Composition) {
  const { job } = await h.studio.exportVideo({
    documentId: doc.id,
    baseRevision: doc.revision,
    composition,
    layer: syntheticLayer(exportLayout(composition)),
    openedFromAttachmentId: null,
  });
  const done = await waitForJob(h.events, job.id);
  expect(done.status, done.error ?? '').toBe('succeeded');
  return exportedFile(h, doc.id);
}

const trimmed = (comp: Composition, trimStartMs: number, trimEndMs: number, muted = false): Composition => ({ ...comp, video: { trimStartMs, trimEndMs, muted } });

describe.skipIf(!bins)('video export with real FFmpeg', () => {
  it('honours a 1.0–3.0 s trim: 2 s of H.264 High + AAC LC at the layout size, no metadata', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      const doc = await openVideo(h, clips.six, 'six.mp4');
      const composition = trimmed(doc.composition, 1000, 3000);
      const file = await exportVideo(h, doc, composition);

      const { streams, format } = await ffprobe(bins!.ffprobe, file);
      const canvas = exportLayout(composition).canvas;
      expect(Math.abs(Number(format.duration) - 2)).toBeLessThanOrEqual(0.1);
      const videos = streams.filter((s) => s.codec_type === 'video');
      const audios = streams.filter((s) => s.codec_type === 'audio');
      expect(videos).toHaveLength(1);
      expect(videos[0]).toMatchObject({ codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: canvas.width, height: canvas.height });
      expect(videos[0]!.sample_aspect_ratio ?? '1:1').toBe('1:1');
      expect(canvas.width % 2).toBe(0);
      expect(canvas.height % 2).toBe(0);
      expect(audios).toHaveLength(1);
      expect(audios[0]).toMatchObject({ codec_name: 'aac', profile: 'LC' });
      expect(Object.keys(format.tags ?? {}).filter((tag) => /location/i.test(tag))).toEqual([]);
    } finally {
      h.close();
    }
  });

  it('drops the audio when muted and keeps it when not', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      const doc = await openVideo(h, clips.six, 'six.mp4');
      const muted = await exportVideo(h, doc, trimmed(doc.composition, 0, 2000, true));
      expect((await ffprobe(bins!.ffprobe, muted)).streams.filter((s) => s.codec_type === 'audio')).toHaveLength(0);

      const reopened = h.studio.get(doc.id);
      const unmuted = await exportVideo(h, reopened, trimmed(reopened.composition, 0, 2000, false));
      expect((await ffprobe(bins!.ffprobe, unmuted)).streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  it('cancels at about 20 %: canceled, FFmpeg gone, no output, no temp files, nothing attached', { timeout: TIMEOUT }, async () => {
    // Realtime: the 10 s clip takes about 10 s to export on any machine.
    const h = await harness(bins, { realtime: true });
    try {
      const doc = await openVideo(h, clips.long, 'long.mp4');
      const composition = trimmed(doc.composition, 0, 10_000);
      const exportsBefore = h.db.prepare('SELECT COUNT(*) FROM studio_exports').pluck().get();
      const attachmentsBefore = h.drafts.getCurrent().attachments.length;
      const { job } = await h.studio.exportVideo({
        documentId: doc.id,
        baseRevision: doc.revision,
        composition,
        layer: syntheticLayer(exportLayout(composition)),
        openedFromAttachmentId: null,
      });
      const running = await waitForJob(h.events, job.id, (j) => j.status === 'running' && j.progress >= 0.2);
      expect(running.progress).toBeLessThan(0.6);
      const pid = h.db.prepare('SELECT pid FROM export_jobs WHERE id = ?').pluck().get(job.id) as number;
      expect(pid).toBeGreaterThan(0);

      const canceled = await h.studio.cancelExport(job.id);

      expect(canceled.status).toBe('canceled');
      expect(h.studio.job(job.id).status).toBe('canceled');
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
      expect(readdirSync(h.paths.tmp).filter((name) => name.startsWith(job.id))).toEqual([]);
      expect(existsSync(join(h.paths.tmp, `${job.id}.mp4`))).toBe(false);
      expect(h.db.prepare('SELECT COUNT(*) FROM studio_exports').pluck().get()).toBe(exportsBefore);
      expect(h.drafts.getCurrent().attachments).toHaveLength(attachmentsBefore);
      expect(h.studio.exportActivity()).toEqual({ running: null, queued: 0 });
    } finally {
      h.close();
    }
  });

  it('agrees with the layer and the source: background, frame and the cropped picture where the layout puts them', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      const doc = await openVideo(h, clips.quad, 'quad.mp4');
      const composition: Composition = {
        ...trimmed(doc.composition, 500, 2500),
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        padding: { x: 0.08, y: 0.08, linked: true },
      };
      const layout = exportLayout(composition);
      const file = await exportVideo(h, doc, composition);
      const { content, frame, canvas } = layout;

      for (const at of [0.05, 1.95]) {
        const out = await frameAt(bins!.ffmpeg, file, at);
        const source = await frameAt(bins!.ffmpeg, clips.quad, 0.5 + at);
        expect([out.width, out.height]).toEqual([canvas.width, canvas.height]);

        // The layer, 8 px clear of every edge: the background corners and the chrome bar.
        for (const [x, y] of [
          [8, 8],
          [canvas.width - 9, canvas.height - 9],
          [8, canvas.height - 9],
        ]) {
          expect(distance(pixel(out, x!, y!), LAYER_BACKGROUND), `background at ${x},${y} (${at}s)`).toBeLessThanOrEqual(4);
        }
        const chromeY = frame.y + (content.y - frame.y) / 2;
        expect(distance(pixel(out, frame.x + frame.width / 2, chromeY), LAYER_FRAME), `chrome (${at}s)`).toBeLessThanOrEqual(4);

        // The picture: the content rect's centre is the source frame's centre (the crop is centred) …
        const centre = pixel(out, content.x + content.width / 2, content.y + content.height / 2);
        expect(distance(centre, pixel(source, source.width / 2, source.height / 2)), `centre (${at}s)`).toBeLessThanOrEqual(8);
        expect(distance(centre, QUADRANTS.centre)).toBeLessThanOrEqual(8);
        // … and the quadrants sit where the crop maps them.
        const quarter = (fx: number, fy: number) => pixel(out, content.x + content.width * fx, content.y + content.height * fy);
        expect(distance(quarter(0.15, 0.15), QUADRANTS.topLeft), 'top left').toBeLessThanOrEqual(8);
        expect(distance(quarter(0.85, 0.15), QUADRANTS.topRight), 'top right').toBeLessThanOrEqual(8);
        expect(distance(quarter(0.15, 0.85), QUADRANTS.bottomLeft), 'bottom left').toBeLessThanOrEqual(8);
        expect(distance(quarter(0.85, 0.85), QUADRANTS.bottomRight), 'bottom right').toBeLessThanOrEqual(8);
      }
    } finally {
      h.close();
    }
  });

  it('honours rotation metadata: an upright document and export with no rotation left in the file', { timeout: TIMEOUT }, async () => {
    const h = await harness(bins);
    try {
      const fixture = await ffprobe(bins!.ffprobe, clips.rotated);
      expect(JSON.stringify(fixture.streams[0]?.side_data_list ?? [])).toContain('Display Matrix');

      const doc = await openVideo(h, clips.rotated, 'rotated.mp4');
      expect([doc.video!.width, doc.video!.height]).toEqual([360, 640]);
      expect([doc.composition.source.width, doc.composition.source.height]).toEqual([360, 640]);
      const composition = trimmed(doc.composition, 0, 1000);
      const file = await exportVideo(h, doc, composition);

      const { streams } = await ffprobe(bins!.ffprobe, file);
      const canvas = exportLayout(composition).canvas;
      expect(streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: canvas.width, height: canvas.height });
      expect(JSON.stringify(streams.find((s) => s.codec_type === 'video')?.side_data_list ?? [])).not.toContain('rotation');
      const out = await frameAt(bins!.ffmpeg, file, 0.5);
      const { content } = exportLayout(composition);
      expect(distance(pixel(out, content.x + content.width / 2, content.y + content.height / 2), QUADRANTS.centre)).toBeLessThanOrEqual(8);
    } finally {
      h.close();
    }
  });
});
