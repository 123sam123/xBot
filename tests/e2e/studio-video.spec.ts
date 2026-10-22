import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { videoExportLayout } from '../../src/shared/composition/layout';
import { timelineDuration } from '../../src/shared/composition/timeline';
import type { Composition } from '../../src/shared/composition/model';
import type { FfmpegBinaries } from '../../src/main/services/ffmpeg/locate';
import type { IntegrationStatus } from '../../src/shared/contracts/app';
import { distance, ffprobe, findFfmpeg, frameAt, makeQuadrantClip, pixel, quadrantPng, QUADRANTS } from '../unit/helpers/videoFixtures';
import { addToPost, composerPage, launch, previewDrawn, readDb, root, showComposerFirstRun, studioPage, stubPicker, windowVisible } from './studio-harness';

// SPEC §16 video and §21: the real Studio with a real video. It plays the
// clip, splits it at the playhead, deletes and trims clips and adds a zoom on
// the timeline. It exports (WebCodecs, in the renderer) with progress and
// Cancel, then exports again; "Add to post" puts the MP4 on the post, with the
// picture and background where the layout puts them. Without FFmpeg a video
// opens read-only with guidance, while images still edit and export. Writes
// test-results/captures/studio-video.png.

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


test('a video plays, splits, trims and zooms on the timeline, exports with progress and cancel, and lands on the post', async () => {
  test.setTimeout(150_000);
  app = await launch(userData);
  await showComposerFirstRun(app);
  const studio = await openInStudio(app, clip);
  const panel = studio.getByTestId('studio-panel');
  await expect(panel).toHaveAttribute('data-document-id', /^[0-9a-f-]{36}$/);
  const documentId = (await panel.getAttribute('data-document-id'))!;

  // The source feeds the preview canvas; the transport and the timeline show the clip.
  const video = studio.getByTestId('studio-video');
  await expect.poll(() => video.evaluate((el) => (el as unknown as { readyState: number }).readyState)).toBeGreaterThanOrEqual(2);
  await expect(studio.getByTestId('transport-time')).toHaveText(/\/ 0:06\.00$/);
  await expect(studio.getByTestId('timeline-clip-0')).toBeVisible();
  await studio.getByTestId('transport-play').click();
  await expect.poll(() => video.evaluate((el) => (el as unknown as { currentTime: number }).currentTime)).toBeGreaterThan(0.3);
  await studio.getByTestId('transport-play').click();

  // Split at the playhead (the middle of the clip), drop the first half, trim the rest.
  const track = (await studio.getByTestId('timeline-clip-0').boundingBox())!;
  await studio.mouse.click(track.x + track.width / 2, track.y + track.height / 2);
  await studio.keyboard.press('s');
  await stored(documentId, (c) => c.video?.clips.length === 2);
  await studio.getByTestId('timeline-clip-0').click({ position: { x: 20, y: 10 } });
  await studio.keyboard.press('Backspace');
  const split = await stored(documentId, (c) => c.video?.clips.length === 1);
  expect(split.video!.clips[0]!.startMs).toBeGreaterThan(2000);
  const clipBox = (await studio.getByTestId('timeline-clip-0').boundingBox())!;
  await studio.mouse.move(clipBox.x + clipBox.width - 3, clipBox.y + clipBox.height / 2);
  await studio.mouse.down();
  await studio.mouse.move(clipBox.x + clipBox.width - 3 - clipBox.width * 0.25, clipBox.y + clipBox.height / 2, { steps: 6 });
  await studio.mouse.up();
  const trimmed = await stored(documentId, (c) => (c.video?.clips[0]!.endMs ?? 6000) < 5600);

  // A zoom: click the zoom track, set it in its editor, then delete it again.
  await studio.getByTestId('timeline-zoom-track').click();
  await expect(studio.getByTestId('zoom-editor')).toBeVisible();
  await stored(documentId, (c) => c.video?.zooms.length === 1 && c.video.zooms[0]!.scale === 2);
  await studio.getByTestId('zoom-editor').getByRole('button', { name: 'Delete zoom' }).click();
  await stored(documentId, (c) => c.video?.zooms.length === 0);

  // Mute keeps or drops the sound; leave it on.
  await studio.getByTestId('sidebar-tab-audio').click();
  await studio.getByRole('switch', { name: 'Mute audio' }).click();
  await stored(documentId, (c) => c.video?.muted === true);
  await studio.getByRole('switch', { name: 'Mute audio' }).click();
  await stored(documentId, (c) => c.video?.muted === false);
  await studio.getByTestId('sidebar-tab-background').click();

  await previewDrawn(studio);
  mkdirSync(join(root, 'test-results', 'captures'), { recursive: true });
  await studio.screenshot({ path: join(root, 'test-results', 'captures', 'studio-video.png') });

  // A flat background and no shadow, so the export's pixels can be checked exactly.
  await expect(studio.getByTestId('bg-kind-none')).toHaveAttribute('aria-disabled', 'true');
  await studio.getByTestId('bg-kind-color').click();
  await studio.getByTestId('background-color').fill('#204080');
  const brightness = studio.getByTestId('background-brightness');
  await brightness.focus();
  for (let i = 0; i < 5; i++) await studio.keyboard.press('ArrowLeft');
  await studio.getByTestId('shadow').focus();
  await studio.keyboard.press('Home');
  const comp = await stored(documentId, (c) => c.background.type === 'solid' && c.background.brightness === 0.5 && c.shadow.style === 'none');

  // Export, watch it climb, cancel it: nothing attached, no export file left in tmp/.
  await studio.getByTestId('studio-export').click();
  await studio.getByTestId('export-go').click();
  const progress = studio.getByTestId('export-progress');
  await expect(progress).toBeVisible();
  await studio.getByTestId('export-cancel').click();
  await expect(studio.getByTestId('studio-notice')).toHaveText('Export canceled.');
  await expect.poll(() => readdirSync(join(userData, 'tmp')).filter((name) => name.includes('.export.'))).toEqual([]);
  expect(readDb(userData, (db) => db.prepare("SELECT COUNT(*) FROM studio_exports WHERE format = 'mp4'").pluck().get())).toBe(0);

  // Export again, to the end: the Studio hides, the composer shows the MP4.
  await addToPost(studio);
  await expect.poll(() => windowVisible(app!, '/studio/'), { timeout: 60_000 }).toBe(false);
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

  const layout = videoExportLayout(comp, '1080p');
  const { streams, format } = await ffprobe(bins!.ffprobe, file);
  expect(Math.abs(Number(format.duration) - timelineDuration(trimmed.video!) / 1000)).toBeLessThanOrEqual(0.15);
  expect(streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: layout.canvas.width, height: layout.canvas.height });
  expect(streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1);

  // The picture where the layout puts it, on the background drawn around it.
  const out = await frameAt(bins!.ffmpeg, file, 0.5);
  expect(distance(pixel(out, 8, 8), { r: 0x20, g: 0x40, b: 0x80 }), 'background').toBeLessThanOrEqual(6);
  const { content } = layout;
  expect(distance(pixel(out, content.x + content.width / 2, content.y + content.height / 2), QUADRANTS.centre), 'centre').toBeLessThanOrEqual(10);

  // "Edit in Studio ↗" on the MP4 reopens its document, clips and all.
  const composer = await composerPage(app);
  await expect(composer.getByTestId('attachment-card')).toHaveCount(1);
  await composer.getByTestId('attachment-card').getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await expect(panel).toHaveAttribute('data-document-id', documentId);
  expect(composition(documentId).video!.clips).toEqual(trimmed.video!.clips);
});

test('without FFmpeg a video opens read-only with guidance, and images still edit and export', async () => {
  test.setTimeout(90_000);
  app = await launch(userData, { XBOT_E2E_NO_FFMPEG: '1' });
  const composer = await showComposerFirstRun(app);
  const studio = await openInStudio(app, clip);

  await expect(studio.getByTestId('studio-target')).toBeVisible();
  const card = studio.getByTestId('ffmpeg-card');
  await expect(card).toContainText('Video editing needs FFmpeg');
  await expect(studio.getByTestId('studio-sidebar')).toContainText('Video editing needs FFmpeg');
  const statuses = await statusOf(studio);
  expect(statuses.ok && statuses.data.some((s) => s.id === 'ffmpeg' && s.tone === 'warning')).toBe(true);
  await card.getByTestId('ffmpeg-check').click();
  await expect(card).toContainText('Still not found.');

  // An image opens as a document and goes to the post as before.
  const png = join(fixtures, 'still.png');
  writeFileSync(png, quadrantPng(400, 300));
  await stubPicker(app, png);
  await studio.getByTestId('studio-name').click();
  await studio.getByTestId('studio-more-menu').getByRole('menuitem', { name: 'Open image or video…' }).click();
  await expect(studio.getByTestId('studio-panel')).toHaveAttribute('data-document-id', /^[0-9a-f-]{36}$/);
  await expect(studio.getByTestId('ffmpeg-card')).toHaveCount(0);
  await previewDrawn(studio);
  await addToPost(studio);
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(false);
  await expect(composer.getByTestId('attachment-card')).toHaveCount(1);
});
