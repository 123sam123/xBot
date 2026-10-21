import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launch, previewDrawn, readDb, root, showComposerFirstRun, studioPage, stubPicker, windowVisible } from './studio-harness';

// SPEC §16/§22 "Composer/Studio round trip": attach a screenshot, edit it in
// the Studio, Add to post, and come back to the same editable document — the
// draft's text untouched and the attachment now the rendered export.

const FIXTURE = join(root, 'resources', 'fixtures', 'my-tiny-tool.png');
let userData: string;
let app: ElectronApplication | null = null;

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-'));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

type DocumentRow = { id: string; composition_json: string; revision: number };
type AttachmentRow = { id: string; media_id: string; studio_document_id: string | null };

test('Add to post attaches the export and Edit in Studio reopens the same document', async () => {
  const text = 'Polished the screenshot in Media Studio.';
  app = await launch(userData);
  const composer = await showComposerFirstRun(app);

  await composer.getByTestId('post-editor').click();
  await composer.keyboard.type(text);
  await stubPicker(app, FIXTURE);
  await composer.getByTestId('upload-zone').click();
  await expect(composer.getByTestId('attachment-thumbnail')).toHaveCount(1);

  // Edit in Studio: a new document for the attachment.
  await composer.getByRole('button', { name: 'Edit in Studio' }).click();
  const studio = await studioPage(app);
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  const panel = studio.getByTestId('studio-panel');
  await expect(panel).toHaveAttribute('data-document-id', /^[0-9a-f-]{36}$/);
  const documentId = (await panel.getAttribute('data-document-id'))!;
  await previewDrawn(studio);

  // Change the background and the frame.
  await studio.getByTestId('tool-background').click();
  await studio.getByTestId('popover-background').getByRole('radio', { name: 'Violet' }).click();
  await studio.keyboard.press('Escape');
  await studio.getByTestId('tool-frame').click();
  await studio.getByTestId('frame-style-minimal').click();
  await studio.getByTestId('frame-theme-light').click();
  await studio.keyboard.press('Escape');
  await previewDrawn(studio);

  await studio.getByTestId('studio-add').click();
  await expect.poll(() => windowVisible(app!, '/composer/')).toBe(true);
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(false);

  // The text is untouched; the one attachment is now the export, linked to its document.
  await expect(composer.getByTestId('post-editor')).toHaveValue(text);
  await expect(composer.getByTestId('attachment-thumbnail')).toHaveCount(1);
  const after = readDb(userData, (db) => {
    const draftId = db.prepare('SELECT id FROM drafts WHERE is_current = 1').pluck().get() as string;
    return {
      text: db.prepare('SELECT text FROM drafts WHERE id = ?').pluck().get(draftId) as string,
      attachments: db.prepare('SELECT id, media_id, studio_document_id FROM draft_attachments WHERE draft_id = ?').all(draftId) as AttachmentRow[],
      exportMedia: db.prepare('SELECT media_id FROM studio_exports WHERE document_id = ? ORDER BY created_at DESC, rowid DESC').pluck().get(documentId) as string,
      exportMime: db
        .prepare('SELECT m.mime FROM studio_exports e JOIN media m ON m.id = e.media_id WHERE e.document_id = ? ORDER BY e.created_at DESC, e.rowid DESC')
        .pluck()
        .get(documentId) as string,
      document: db.prepare('SELECT id, composition_json, revision FROM studio_documents WHERE id = ?').get(documentId) as DocumentRow,
    };
  });
  expect(after.text).toBe(text);
  expect(after.attachments).toHaveLength(1);
  expect(after.attachments[0]!.media_id).toBe(after.exportMedia);
  expect(after.attachments[0]!.studio_document_id).toBe(documentId);
  expect(after.exportMime).toBe('image/png');
  const saved = JSON.parse(after.document.composition_json) as { background: { preset: string }; frame: { style: string; theme: string } };
  expect(saved.background.preset).toBe('violet');
  expect(saved.frame).toMatchObject({ style: 'minimal', theme: 'light' });

  // Edit in Studio on the export reopens the original editable document, unchanged.
  await composer.getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await expect(panel).toHaveAttribute('data-document-id', documentId);
  await previewDrawn(studio);
  const reopened = readDb(userData, (db) => db.prepare('SELECT id, composition_json, revision FROM studio_documents WHERE id = ?').get(documentId) as DocumentRow);
  expect(JSON.parse(reopened.composition_json)).toEqual(JSON.parse(after.document.composition_json));
  expect(reopened.revision).toBe(after.document.revision);

  await studio.getByTestId('tool-background').click();
  await expect(studio.getByTestId('popover-background').getByRole('radio', { name: 'Violet' })).toHaveAttribute('aria-checked', 'true');
  await studio.keyboard.press('Escape');
  await studio.getByTestId('tool-frame').click();
  await expect(studio.getByTestId('frame-style-minimal')).toHaveAttribute('aria-checked', 'true');
  await expect(studio.getByTestId('frame-theme-light')).toHaveAttribute('aria-checked', 'true');
});
