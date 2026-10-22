import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Composition } from '../../src/shared/composition/model';
import { PREVIEW_DRAFT_TEXT, PREVIEW_VIDEO_DRAFT_TEXT } from '../../src/shared/previewSample';
import { findFfmpeg, quadrantPng } from '../unit/helpers/videoFixtures';
import { composerPage, launch, previewDrawn, readDb, studioPage, stubPicker, windowVisible } from './studio-harness';

// The whole user journey (SPEC §21–§23), in preview mode's seeded userData:
// write and attach, polish a screenshot in Media Studio and add it to the
// post, reopen the same document, restore the video draft and export it
// through FFmpeg, quit and relaunch with everything still there, then try
// to post: preview mode only offers post-it-yourself, and nothing reaches X.
// Needs FFmpeg (the seeded video and its export); XBOT_REQUIRE_FFMPEG=1 turns
// the skip into a failure.

let userData: string;
let sources: string;
let app: ElectronApplication | null = null;
let ffmpeg = false;

test.beforeAll(async () => {
  ffmpeg = (await findFfmpeg()) !== null;
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-journey-'));
  sources = mkdtempSync(join(tmpdir(), 'xbot-e2e-journey-src-'));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(sources, { recursive: true, force: true });
});

interface Counts {
  drafts: number;
  media: number;
  ideas: number;
}

const counts = (): Counts =>
  readDb(userData, (db) => ({
    drafts: db.prepare('SELECT COUNT(*) FROM drafts').pluck().get() as number,
    media: db.prepare('SELECT COUNT(*) FROM media').pluck().get() as number,
    ideas: db.prepare('SELECT COUNT(*) FROM suggestions').pluck().get() as number,
  }));

interface AttachmentRow {
  id: string;
  media_id: string;
  studio_document_id: string | null;
  mime: string;
  exported: number;
}

/** A draft's attachments in order, with whether each one's media is a Studio export. */
const attachments = (draftId: string): AttachmentRow[] =>
  readDb(userData, (db) =>
    db
      .prepare(
        `SELECT a.id, a.media_id, a.studio_document_id, m.mime,
                EXISTS (SELECT 1 FROM studio_exports e WHERE e.media_id = a.media_id) AS exported
         FROM draft_attachments a JOIN media m ON m.id = a.media_id WHERE a.draft_id = ? ORDER BY a.position`,
      )
      .all(draftId),
  ) as AttachmentRow[];

const currentDraft = () => readDb(userData, (db) => db.prepare('SELECT id, text FROM drafts WHERE is_current = 1').get()) as { id: string; text: string };

const documentRow = (id: string) =>
  readDb(userData, (db) => db.prepare('SELECT composition_json, revision FROM studio_documents WHERE id = ?').get(id)) as { composition_json: string; revision: number };

/** Launches preview mode on `userData` with `shell.openExternal` recording instead of opening a browser. */
async function start(): Promise<{ composer: Page; studio: Page }> {
  app = await launch(userData, { XBOT_PREVIEW: '1' });
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    shell.openExternal = (async (url: string) => {
      opened.push(url);
    }) as typeof shell.openExternal;
  });
  const composer = await composerPage(app);
  await app.evaluate(() => (globalThis as unknown as { __xbotTest: { toggleComposer(): void } }).__xbotTest.toggleComposer());
  await expect.poll(() => windowVisible(app!, '/composer/')).toBe(true);
  return { composer, studio: await studioPage(app) };
}

async function addToPostAndReturn(studio: Page, composer: Page): Promise<void> {
  await expect(studio.getByTestId('studio-add')).not.toHaveAttribute('aria-disabled', 'true');
  await studio.getByTestId('studio-add').click();
  await expect.poll(() => windowVisible(app!, '/studio/'), { timeout: 60_000 }).toBe(false);
  await expect.poll(() => windowVisible(app!, '/composer/')).toBe(true);
  await expect(composer.getByTestId('composer-panel')).toBeVisible();
}

test('the full journey works in preview mode, and nothing is posted', async () => {
  test.setTimeout(180_000);
  test.skip(!ffmpeg, 'FFmpeg not found');

  // 1. Launch: the labelled sample, then write and attach.
  const opened = await start();
  const { studio } = opened;
  let { composer } = opened;
  await expect(composer.locator('.badge', { hasText: 'Preview' })).toBeVisible();
  await expect(composer.getByTestId('post-editor')).toHaveValue(PREVIEW_DRAFT_TEXT);
  await expect(composer.getByTestId('attachment-thumbnail')).toHaveCount(1);
  expect(counts()).toMatchObject({ drafts: 2, ideas: 1 });
  const imageDraft = currentDraft();
  const seeded = attachments(imageDraft.id);
  expect(seeded).toMatchObject([{ exported: 1, mime: 'image/png' }]);

  // The Ideas popover lists the stored sample, labelled, and finds nothing new.
  await composer.getByTestId('ideas-trigger').click();
  await expect(composer.getByTestId('idea-card')).toHaveCount(1);
  await expect(composer.getByTestId('ideas-preview-note')).toBeVisible();
  await expect(composer.getByTestId('ideas-refresh')).toHaveCount(0);
  await composer.keyboard.press('Escape');

  const typed = ' Now with a second screenshot.';
  const editor = composer.getByTestId('post-editor');
  await editor.click();
  // End would stop at the end of the wrapped line: put the caret after the last character.
  await editor.evaluate((el) => {
    const area = el as unknown as { value: string; setSelectionRange(start: number, end: number): void };
    area.setSelectionRange(area.value.length, area.value.length);
  });
  await composer.keyboard.type(typed);
  const screenshot = join(sources, 'second-screenshot.png');
  writeFileSync(screenshot, quadrantPng(960, 600));
  await stubPicker(app!, screenshot);
  await composer.getByTestId('upload-zone').click();
  await expect(composer.getByTestId('attachment-thumbnail')).toHaveCount(2);
  const text = PREVIEW_DRAFT_TEXT + typed;

  // 2. Media Studio: polish the new screenshot and add it to the post.
  await composer.getByTestId('attachment-card').nth(1).getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  const panel = studio.getByTestId('studio-panel');
  const newAttachment = attachments(imageDraft.id)[1]!;
  await expect.poll(() => attachments(imageDraft.id)[1]?.studio_document_id ?? null).not.toBeNull();
  const imageDocument = attachments(imageDraft.id)[1]!.studio_document_id!;
  await expect(panel).toHaveAttribute('data-document-id', imageDocument);
  await previewDrawn(studio);

  await studio.getByTestId('tool-background').click();
  await studio.getByTestId('popover-background').getByRole('radio', { name: 'Violet' }).click();
  await studio.keyboard.press('Escape');
  await studio.getByTestId('tool-frame').click();
  await studio.getByTestId('frame-style-minimal').click();
  await studio.getByTestId('frame-theme-light').click();
  await studio.keyboard.press('Escape');
  await studio.getByTestId('tool-crop').click();
  await studio.getByTestId('crop-aspect-1:1').click();
  await studio.getByTestId('crop-apply').click();
  await previewDrawn(studio);
  await addToPostAndReturn(studio, composer);

  await expect(composer.getByTestId('post-editor')).toHaveValue(text);
  await expect(composer.getByTestId('attachment-thumbnail')).toHaveCount(2);
  const afterAdd = attachments(imageDraft.id);
  expect(afterAdd.map((a) => a.id)).toEqual([seeded[0]!.id, newAttachment.id]);
  expect(afterAdd[0]).toEqual(seeded[0]);
  const newestExport = readDb(userData, (db) =>
    db.prepare('SELECT media_id FROM studio_exports WHERE document_id = ? ORDER BY created_at DESC, rowid DESC').pluck().get(imageDocument),
  );
  expect(afterAdd[1]).toMatchObject({ media_id: newestExport, studio_document_id: imageDocument, exported: 1 });
  const saved = documentRow(imageDocument);
  const comp = JSON.parse(saved.composition_json) as Composition;
  expect(comp).toMatchObject({ cropAspect: '1:1', frame: { style: 'minimal', theme: 'light' }, background: { type: 'gradient', preset: 'violet' } });

  // 3. Edit in Studio reopens the same document, unchanged; then the video draft.
  await composer.getByTestId('attachment-card').nth(1).getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await expect(panel).toHaveAttribute('data-document-id', imageDocument);
  await expect(panel).toHaveAttribute('data-revision', String(saved.revision));
  await previewDrawn(studio);
  expect(documentRow(imageDocument)).toEqual(saved);
  await studio.getByRole('button', { name: 'Back to post' }).click();
  await expect.poll(() => windowVisible(app!, '/composer/')).toBe(true);

  await composer.getByTestId('app-menu-trigger').click();
  await composer.getByRole('menuitem', { name: 'Draft history…' }).click();
  await composer.getByTestId('history-sheet').getByRole('button', { name: new RegExp(`^${PREVIEW_VIDEO_DRAFT_TEXT.slice(0, 20)}`) }).click();
  await expect(composer.getByTestId('post-editor')).toHaveValue(PREVIEW_VIDEO_DRAFT_TEXT);
  const videoDraft = currentDraft();
  const [videoAttachment] = attachments(videoDraft.id);
  expect(videoAttachment).toMatchObject({ mime: 'video/mp4', exported: 0 });
  const videoDocument = videoAttachment!.studio_document_id;
  expect(videoDocument).not.toBeNull();

  await composer.getByTestId('attachment-card').first().getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await expect(panel).toHaveAttribute('data-document-id', videoDocument!);
  await expect(studio.getByTestId('studio-video')).toBeVisible();
  await previewDrawn(studio);
  await addToPostAndReturn(studio, composer);
  const job = readDb(userData, (db) => db.prepare('SELECT status FROM export_jobs WHERE document_id = ?').pluck().get(videoDocument)) as string;
  expect(job).toBe('succeeded');
  const exportedVideo = attachments(videoDraft.id);
  expect(exportedVideo).toHaveLength(1);
  expect(exportedVideo[0]).toMatchObject({ id: videoAttachment!.id, mime: 'video/mp4', exported: 1, studio_document_id: videoDocument });
  const mp4Export = readDb(userData, (db) => db.prepare("SELECT media_id FROM studio_exports WHERE document_id = ? AND format = 'mp4'").pluck().get(videoDocument));
  expect(exportedVideo[0]!.media_id).toBe(mp4Export);
  const before = counts();

  // 4. Relaunch: everything is back, and nothing is seeded twice.
  await app!.close();
  app = null;
  ({ composer } = await start());
  await expect(composer.getByTestId('post-editor')).toHaveValue(PREVIEW_VIDEO_DRAFT_TEXT);
  await expect(composer.getByTestId('attachment-thumbnail')).toHaveCount(1);
  expect(currentDraft().id).toBe(videoDraft.id);
  expect(attachments(videoDraft.id)).toEqual(exportedVideo);
  expect(counts()).toEqual(before);
  const history = readDb(userData, (db) => db.prepare('SELECT text FROM drafts WHERE id = ?').pluck().get(imageDraft.id));
  expect(history).toBe(text);
  expect(attachments(imageDraft.id)).toEqual(afterAdd);

  // 5. Post: preview mode offers only post-it-yourself, and nothing reaches X.
  await composer.getByTestId('post-button').click();
  const sheet = composer.getByTestId('publish-sheet');
  await expect(sheet).toContainText('Posting to X is off in preview. You can post it yourself.');
  await expect(sheet.getByTestId('publish-connect-x')).toHaveCount(0);
  await sheet.getByTestId('publish-copy').click();
  await expect(sheet.getByTestId('publish-copy')).toContainText('Copied');
  expect(await app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(PREVIEW_VIDEO_DRAFT_TEXT);
  const posted = await composer.evaluate(
    ([draftId, body, ids]) =>
      (globalThis as unknown as { xbot: { x: { post(p: unknown): Promise<{ ok: boolean; error?: { code: string } }> } } }).xbot.x.post({
        draftId,
        text: body,
        attachmentIds: ids,
      }),
    [videoDraft.id, PREVIEW_VIDEO_DRAFT_TEXT, exportedVideo.map((a) => a.id)] as const,
  );
  expect(posted).toMatchObject({ ok: false, error: { code: 'preview_mode' } });
  expect(await app!.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([]);
  expect(readDb(userData, (db) => db.prepare('SELECT COUNT(*) FROM publish_jobs').pluck().get())).toBe(0);
});
