import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { exportLayout } from '../../src/shared/composition/layout';
import type { Composition } from '../../src/shared/composition/model';
import type { FfmpegBinaries } from '../../src/main/services/ffmpeg/locate';
import type { IntegrationStatus } from '../../src/shared/contracts/app';
import { distance, ffprobe, findFfmpeg, frameAt, makeQuadrantClip, pixel, quadrantPng, QUADRANTS, type Rgb } from '../unit/helpers/videoFixtures';
import { composerPage, launch, previewDrawn, readDb, root, showComposerFirstRun, studioPage, stubPicker, windowVisible } from './studio-harness';

// SPEC §16 video and §21: the real Studio with a real video and real FFmpeg.
// It plays the clip inside its frame and trims it from the timeline
// (keyboard and pointer). It exports with climbing progress, a status chip and
// Cancel, then exports again. "Add to post" puts the MP4 on the post. The
// export agrees with what the preview canvas drew, at 1× and 100 %: the
// background where the renderer drew it, and the picture filling the hole the
// renderer cut. Without FFmpeg a video opens read-only with guidance, while
// images still edit and export. Writes test-results/captures/studio-video.png.

let bins: FfmpegBinaries | null = null;
let fixtures: string;
let clip: string;
let userData: string;
let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  bins = await findFfmpeg();
  if (!bins) return;
  fixtures = mkdtempSync(join(tmpdir(), 'xbot-e2e-video-'));
  clip = await makeQuadrantClip(bins.ffmpeg, fixtures, join(fixtures, 'quad.mp4'), { seconds: 6 });
});

test.beforeEach(() => {
  test.skip(!bins, 'FFmpeg not found');
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-video-data-'));
});

test.afterEach(async () => {
  await app?.close();
  app = null;
  rmSync(userData, { recursive: true, force: true });
});

test.afterAll(() => {
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

/** The page objects these checks touch, typed structurally (the test tsconfig has no DOM lib). */
interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> } };
}
const statusOf = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { xbot: { app: { getStatus(): Promise<{ ok: boolean; data: IntegrationStatus[] }> } } }).xbot.app.getStatus());

async function openInStudio(target: ElectronApplication, file: string): Promise<Page> {
  await stubPicker(target, file);
  await target.evaluate(() => (globalThis as unknown as { __xbotTest: { openStudio(): void } }).__xbotTest.openStudio());
  await expect.poll(() => windowVisible(target, '/studio/')).toBe(true);
  const studio = await studioPage(target);
  await studio.getByTestId('studio-choose').click();
  return studio;
}

function composition(documentId: string): Composition {
  return JSON.parse(readDb(userData, (db) => db.prepare('SELECT composition_json FROM studio_documents WHERE id = ?').pluck().get(documentId) as string));
}

/** Waits until the Studio's autosave has stored a composition that `check` accepts. */
async function stored(documentId: string, check: (comp: Composition) => boolean): Promise<Composition> {
  await expect.poll(() => check(composition(documentId)), { timeout: 10_000 }).toBe(true);
  return composition(documentId);
}

/** A pixel of the preview canvas, in its backing-store px (1 per output px at 100 % and a device scale of 1). */
async function previewPixel(studio: Page, x: number, y: number): Promise<Rgb> {
  return studio.getByTestId('studio-preview-canvas').evaluate(
    (el, [px, py]) => {
      const { data } = (el as unknown as CanvasLike).getContext('2d').getImageData(px!, py!, 1, 1);
      return { r: data[0]!, g: data[1]!, b: data[2]! };
    },
    [Math.floor(x), Math.floor(y)],
  );
}

test('a video plays in its frame, trims on the timeline, exports with progress and cancel, and lands on the post', async () => {
  test.setTimeout(120_000);
  // Realtime: an export takes as long as its trim, so progress and Cancel can be watched.
  app = await launch(userData, { XBOT_E2E_FFMPEG_REALTIME: '1' });
  await showComposerFirstRun(app);
  const studio = await openInStudio(app, clip);
  const panel = studio.getByTestId('studio-panel');
  await expect(panel).toHaveAttribute('data-document-id', /^[0-9a-f-]{36}$/);
  const documentId = (await panel.getAttribute('data-document-id'))!;

  // The video plays inside the frame: a <video> under the canvas, with the timeline below.
  const video = studio.getByTestId('studio-video');
  await expect.poll(() => video.evaluate((el) => (el as unknown as { readyState: number }).readyState)).toBeGreaterThanOrEqual(2);
  await expect(studio.getByTestId('timeline-time')).toHaveText(/^\d\d:\d\d \/ 00:06$/);
  await expect(studio.locator('.timeline-frames img')).toHaveCount(8);
  await studio.getByTestId('timeline-play').click();
  await expect.poll(() => video.evaluate((el) => (el as unknown as { currentTime: number }).currentTime)).toBeGreaterThan(0.3);
  await studio.getByTestId('timeline-play').click();

  // Trim: a pointer drag on the end handle, then the keyboard (0.1 s, Shift 1 s).
  const end = studio.getByTestId('timeline-trim-end');
  const box = (await end.boundingBox())!;
  await studio.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await studio.mouse.down();
  await studio.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 5 });
  await studio.mouse.up();
  await stored(documentId, (c) => (c.video?.trimEndMs ?? 6000) < 5800);
  await end.focus();
  await studio.keyboard.press('End');
  await studio.keyboard.press('Shift+ArrowLeft');
  await studio.keyboard.press('Shift+ArrowLeft');
  const start = studio.getByTestId('timeline-trim-start');
  await start.focus();
  await studio.keyboard.press('ArrowRight');
  await stored(documentId, (c) => c.video?.trimStartMs === 100 && c.video.trimEndMs === 4000);
  await studio.keyboard.press('Shift+ArrowRight');
  await stored(documentId, (c) => c.video?.trimStartMs === 1100);

  // Mute keeps or drops the sound; leave it on.
  await studio.getByTestId('timeline-mute').click();
  await stored(documentId, (c) => c.video?.muted === true);
  await studio.getByTestId('timeline-mute').click();
  await stored(documentId, (c) => c.video?.muted === false);

  // The capture for the human's look check: the default frame and background, with the timeline.
  await previewDrawn(studio);
  mkdirSync(join(root, 'test-results', 'captures'), { recursive: true });
  await studio.screenshot({ path: join(root, 'test-results', 'captures', 'studio-video.png') });

  // A flat background and no shadow, so pixels can be compared exactly (as the image export spec does).
  await studio.getByTestId('tool-background').click();
  await studio.getByTestId('background-more').click();
  await expect(studio.getByTestId('background-type-transparent')).toHaveAttribute('aria-disabled', 'true');
  await studio.getByTestId('background-type-solid').click();
  await studio.getByTestId('background-color').fill('#204080');
  const brightness = studio.getByTestId('background-brightness');
  await brightness.focus();
  for (let i = 0; i < 5; i++) await studio.keyboard.press('ArrowLeft');
  await studio.keyboard.press('Escape');
  await studio.getByTestId('tool-shadow').click();
  await studio.getByTestId('shadow-style-none').click();
  await studio.keyboard.press('Escape');

  const comp = await stored(documentId, (c) => c.background.type === 'solid' && c.shadow.style === 'none' && c.video?.trimStartMs === 1100);

  // 100 %: the preview canvas is the export's size, pixel for pixel.
  await studio.getByTestId('studio-zoom').click();
  await studio.getByTestId('zoom-menu').getByRole('menuitemradio', { name: '100%' }).click();
  await previewDrawn(studio);
  const layout = exportLayout(comp);
  const canvasSize = await studio.getByTestId('studio-preview-canvas').evaluate((el) => [(el as unknown as CanvasLike).width, (el as unknown as CanvasLike).height]);
  expect(canvasSize).toEqual([layout.canvas.width, layout.canvas.height]);
  const backgroundPoints = [
    [8, 8],
    [layout.canvas.width - 9, layout.canvas.height - 9],
  ] as const;
  const previewBackground = await Promise.all(backgroundPoints.map(([x, y]) => previewPixel(studio, x, y)));
  // The hole really is a hole: the canvas is transparent at the content's centre.
  const holeAlpha = await studio.getByTestId('studio-preview-canvas').evaluate(
    (el, [x, y]) => (el as unknown as CanvasLike).getContext('2d').getImageData(x!, y!, 1, 1).data[3],
    [Math.floor(layout.content.x + layout.content.width / 2), Math.floor(layout.content.y + layout.content.height / 2)],
  );
  expect(holeAlpha).toBe(0);


  // Export, watch it climb, cancel it: nothing attached, nothing left in tmp/.
  await studio.getByTestId('studio-add').click();
  const add = studio.getByTestId('studio-add');
  await expect(add).toHaveText(/^Exporting… \d+%$/);
  const percent = async () => Number(/(\d+)%/.exec((await add.textContent()) ?? '')?.[1] ?? -1);
  const first = await percent();
  await expect.poll(percent, { timeout: 10_000 }).toBeGreaterThan(first);
  await expect(studio.getByTestId('studio-export-chip')).toContainText('Export running');
  const statuses = await statusOf(studio);
  expect(statuses.ok && statuses.data.some((s) => s.id === 'studio-export' && s.label === 'Export running')).toBe(true);
  await studio.getByTestId('studio-cancel-export').click();
  await expect(studio.getByTestId('studio-notice')).toHaveText('Export canceled.');
  const canceled = readDb(userData, (db) => db.prepare('SELECT id, status FROM export_jobs ORDER BY created_at').all()) as { id: string; status: string }[];
  expect(canceled.map((j) => j.status)).toEqual(['canceled']);
  expect(readdirSync(join(userData, 'tmp')).filter((name) => name.startsWith(canceled[0]!.id))).toEqual([]);
  expect(readDb(userData, (db) => db.prepare("SELECT COUNT(*) FROM studio_exports WHERE format = 'mp4'").pluck().get())).toBe(0);

  // Export again, to the end: the Studio hides, the composer shows the MP4.
  await studio.getByTestId('studio-add').click();
  await expect.poll(() => windowVisible(app!, '/studio/'), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => windowVisible(app!, '/composer/')).toBe(true);
  const attached = readDb(userData, (db) =>
    db
      .prepare(
        `SELECT m.path, m.mime FROM draft_attachments a JOIN drafts d ON d.id = a.draft_id AND d.is_current = 1
         JOIN media m ON m.id = a.media_id WHERE a.studio_document_id = ?`,
      )
      .get(documentId),
  ) as { path: string; mime: string };
  expect(attached.mime).toBe('video/mp4');
  const file = join(userData, 'media', attached.path);

  const { streams, format } = await ffprobe(bins!.ffprobe, file);
  expect(Math.abs(Number(format.duration) - 2.9)).toBeLessThanOrEqual(0.1);
  expect(streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: layout.canvas.width, height: layout.canvas.height });
  expect(streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1);

  // The export against the renderer's own layer and the source.
  const out = await frameAt(bins!.ffmpeg, file, 1);
  backgroundPoints.forEach(([x, y], i) => expect(distance(pixel(out, x, y), previewBackground[i]!), `background at ${x},${y}`).toBeLessThanOrEqual(4));
  const { content } = layout;
  const at = (fx: number, fy: number) => pixel(out, content.x + content.width * fx, content.y + content.height * fy);
  expect(distance(at(0.5, 0.5), QUADRANTS.centre), 'centre').toBeLessThanOrEqual(8);
  // The hole and the video's box line up. At each edge the first pixel the hole fully covers is
  // already the picture: a box off by a pixel would put pad black or the layer there, which are
  // 130+ away from every quadrant colour. 4:2:0 chroma and the encoder smear a sharp edge over
  // about 3 px, so the exact colour is checked 4 px in.
  const edges: [string, (inset: number) => Rgb, readonly number[]][] = [
    ['left', (d) => pixel(out, Math.ceil(content.x) + d, content.y + content.height * 0.25), QUADRANTS.topLeft],
    ['right', (d) => pixel(out, Math.floor(content.x + content.width) - 1 - d, content.y + content.height * 0.75), QUADRANTS.bottomRight],
    ['top', (d) => pixel(out, content.x + content.width * 0.75, Math.ceil(content.y) + d), QUADRANTS.topRight],
    ['bottom', (d) => pixel(out, content.x + content.width * 0.25, Math.floor(content.y + content.height) - 1 - d), QUADRANTS.bottomLeft],
  ];
  for (const [edge, sample, colour] of edges) {
    expect(distance(sample(0), colour), `${edge} edge, first full pixel`).toBeLessThanOrEqual(64);
    expect(distance(sample(4), colour), `${edge} edge, 4 px in`).toBeLessThanOrEqual(8);
  }

  // "Edit in Studio ↗" on the MP4 reopens its document, trim and all.
  const composer = await composerPage(app);
  await expect(composer.getByTestId('attachment-card')).toHaveCount(1);
  await composer.getByTestId('attachment-card').getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await expect(panel).toHaveAttribute('data-document-id', documentId);
  await expect(studio.getByTestId('timeline-trim-start')).toHaveAttribute('aria-valuenow', '1.1');
  await expect(studio.getByTestId('timeline-trim-end')).toHaveAttribute('aria-valuenow', '4');

  // Back to the post mid-export: the job carries on, the new MP4 swaps into the same attachment,
  // and the Studio doesn't come back.
  await studio.getByTestId('timeline-trim-end').focus();
  await studio.keyboard.press('Shift+ArrowLeft');
  await stored(documentId, (c) => c.video?.trimEndMs === 3000);
  await studio.getByTestId('studio-add').click();
  await expect(add).toHaveText(/^Exporting… \d+%$/);
  await studio.getByRole('button', { name: 'Back to post' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(false);
  const mediaPath = () =>
    readDb(userData, (db) =>
      db
        .prepare(
          `SELECT m.path FROM draft_attachments a JOIN drafts d ON d.id = a.draft_id AND d.is_current = 1
           JOIN media m ON m.id = a.media_id WHERE a.studio_document_id = ?`,
        )
        .pluck()
        .get(documentId),
    );
  await expect.poll(mediaPath, { timeout: 30_000 }).not.toBe(attached.path);
  expect(await windowVisible(app, '/studio/')).toBe(false);
  await expect(composer.getByTestId('attachment-card')).toHaveCount(1);
  const swapped = await ffprobe(bins!.ffprobe, join(userData, 'media', mediaPath() as string));
  expect(Math.abs(Number(swapped.format.duration) - 1.9)).toBeLessThanOrEqual(0.1);
});

test('without FFmpeg a video opens read-only with guidance, and images still edit and export', async () => {
  test.setTimeout(90_000);
  app = await launch(userData, { XBOT_E2E_NO_FFMPEG: '1' });
  const composer = await showComposerFirstRun(app);
  const studio = await openInStudio(app, clip);

  await expect(studio.getByTestId('studio-target')).toBeVisible();
  const card = studio.getByTestId('ffmpeg-card');
  await expect(card).toContainText('Video editing needs FFmpeg');
  await expect(studio.getByTestId('tool-background')).toHaveAttribute('aria-disabled', 'true');
  const statuses = await statusOf(studio);
  expect(statuses.ok && statuses.data.some((s) => s.id === 'ffmpeg' && s.tone === 'warning')).toBe(true);
  await card.getByTestId('ffmpeg-check').click();
  await expect(card).toContainText('Still not found.');

  // An image opens as a document and goes to the post as before.
  const png = join(fixtures, 'still.png');
  writeFileSync(png, quadrantPng(400, 300));
  await stubPicker(app, png);
  await studio.getByTestId('studio-more').click();
  await studio.getByTestId('studio-more-menu').getByRole('menuitem', { name: 'Open image or video…' }).click();
  await expect(studio.getByTestId('studio-panel')).toHaveAttribute('data-document-id', /^[0-9a-f-]{36}$/);
  await expect(studio.getByTestId('ffmpeg-card')).toHaveCount(0);
  await previewDrawn(studio);
  await studio.getByTestId('studio-add').click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(false);
  await expect(composer.getByTestId('attachment-card')).toHaveCount(1);
});
