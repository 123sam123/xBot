import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { computeLayout } from '../../src/shared/composition/layout';
import type { Composition, Rect } from '../../src/shared/composition/model';
import { addToPost as exportToPost, launch, previewDrawn, readDb, showComposerFirstRun, studioPage, stubPicker, windowVisible } from './studio-harness';

// SPEC §16 "Test preview/export agreement" and §22 "Non-destructive edits":
// a quadrant-coloured screenshot is exported at 1× and 2×. The 1× export is
// exactly what the preview canvas shows at 100 % (pixelmatch), and pixels sampled at
// computeLayout's rects are the background, the chrome and the four
// quadrants. After edits, a crop and three exports, the source file is
// byte-for-byte the one imported, and a transparent export is transparent.

const BACKGROUND = [0x20, 0x40, 0x80] as const;
const QUADRANTS = {
  topLeft: [255, 0, 0],
  topRight: [0, 255, 0],
  bottomLeft: [0, 0, 255],
  bottomRight: [255, 255, 0],
} as const;
/** The dark chrome bar runs #2b2c31 → #222327 top to bottom; this is its middle. */
const CHROME_MIDDLE = [(0x2b + 0x22) / 2, (0x2c + 0x23) / 2, (0x31 + 0x27) / 2] as const;
const TOLERANCE = 3;
const MAX_DIFF = 0.005;

let userData: string;
let fixtures: string;
let app: ElectronApplication | null = null;

function quadrantPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = y < height / 2 ? (x < width / 2 ? QUADRANTS.topLeft : QUADRANTS.topRight) : x < width / 2 ? QUADRANTS.bottomLeft : QUADRANTS.bottomRight;
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function pixel(png: PNG, x: number, y: number): [number, number, number, number] {
  const i = (Math.floor(y) * png.width + Math.floor(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
}

function expectColour(png: PNG, x: number, y: number, rgb: readonly number[], what: string): void {
  const [r, g, b, a] = pixel(png, x, y);
  for (const [index, value] of [r, g, b].entries()) {
    expect(Math.abs(value - rgb[index]!), `${what} at (${Math.floor(x)}, ${Math.floor(y)}) is rgb(${r} ${g} ${b})`).toBeLessThanOrEqual(TOLERANCE);
  }
  expect(a, `${what} is opaque`).toBe(255);
}

/** The latest export of the document on the current draft, and the composition it was made from. */
function latestExport(documentId: string): { png: PNG; bytes: Buffer; composition: Composition } {
  const { path, json } = readDb(userData, (db) => ({
    path: db
      .prepare(
        `SELECT m.path FROM draft_attachments a JOIN drafts d ON d.id = a.draft_id AND d.is_current = 1
         JOIN media m ON m.id = a.media_id WHERE a.studio_document_id = ?`,
      )
      .pluck()
      .get(documentId) as string,
    json: db.prepare('SELECT composition_json FROM studio_documents WHERE id = ?').pluck().get(documentId) as string,
  }));
  const bytes = readFileSync(join(userData, 'media', path));
  return { png: PNG.sync.read(bytes), bytes, composition: JSON.parse(json) as Composition };
}

/** The preview canvas's pixels, as the page shows them. */
async function previewPixels(studio: Page): Promise<PNG> {
  await previewDrawn(studio);
  const url = await studio.getByTestId('studio-preview-canvas').evaluate((el) => (el as unknown as { toDataURL(type: string): string }).toDataURL('image/png'));
  return PNG.sync.read(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}

function centre(r: Rect, fx: number, fy: number): [number, number] {
  return [r.x + r.width * fx, r.y + r.height * fy];
}

/** The export against the layout's rects, and against the preview when it shows the export's pixels (1×). */
function expectAgreement(preview: PNG | null, exported: PNG, composition: Composition, scale: 1 | 2): void {
  const layout = computeLayout(composition, { scale });
  expect({ width: exported.width, height: exported.height }).toEqual(layout.canvas);

  expectColour(exported, 2, 2, BACKGROUND, 'the background');
  const chrome = layout.chrome!;
  expectColour(exported, chrome.x + 4 * scale, chrome.y + chrome.height / 2, CHROME_MIDDLE, 'the chrome bar');
  expectColour(exported, ...centre(layout.content, 0.25, 0.25), QUADRANTS.topLeft, 'the top-left quadrant');
  expectColour(exported, ...centre(layout.content, 0.75, 0.25), QUADRANTS.topRight, 'the top-right quadrant');
  expectColour(exported, ...centre(layout.content, 0.25, 0.75), QUADRANTS.bottomLeft, 'the bottom-left quadrant');
  expectColour(exported, ...centre(layout.content, 0.75, 0.75), QUADRANTS.bottomRight, 'the bottom-right quadrant');

  if (!preview) return;
  expect({ width: preview.width, height: preview.height }).toEqual(layout.canvas);
  const differing = pixelmatch(preview.data, exported.data, null, exported.width, exported.height, { threshold: 0.1 });
  expect(differing / (exported.width * exported.height)).toBeLessThanOrEqual(MAX_DIFF);
}

async function addToPost(studio: Page): Promise<void> {
  await exportToPost(studio);
  await expect.poll(() => windowVisible(app!, '/composer/')).toBe(true);
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(false);
}

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-'));
  fixtures = mkdtempSync(join(tmpdir(), 'xbot-fixtures-'));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(fixtures, { recursive: true, force: true });
});

test('exports match the preview at 1× and 2× and never touch the source', async () => {
  const fixture = join(fixtures, 'quadrants.png');
  const fixtureBytes = quadrantPng(800, 600);
  writeFileSync(fixture, fixtureBytes);

  app = await launch(userData);
  const composer = await showComposerFirstRun(app);

  // Open the fixture in the Studio from its own picker.
  await stubPicker(app, fixture);
  await app.evaluate(() => (globalThis as unknown as { __xbotTest: { openStudio(): void } }).__xbotTest.openStudio());
  const studio = await studioPage(app);
  await studio.getByTestId('studio-choose').click();
  const panel = studio.getByTestId('studio-panel');
  await expect(panel).toHaveAttribute('data-document-id', /^[0-9a-f-]{36}$/);
  const documentId = (await panel.getAttribute('data-document-id'))!;
  const source = readDb(userData, (db) =>
    db
      .prepare('SELECT m.id, m.path, m.bytes, m.width, m.height, m.sha256 FROM studio_documents d JOIN media m ON m.id = d.source_media_id WHERE d.id = ?')
      .get(documentId),
  ) as { id: string; path: string; bytes: number; width: number; height: number; sha256: string };
  expect(source).toMatchObject({ bytes: fixtureBytes.length, width: 800, height: 600, sha256: sha256(fixtureBytes) });

  // A solid background at neutral brightness, no shadow, a 640 × 400 output.
  await studio.getByTestId('bg-kind-color').click();
  await studio.getByTestId('background-color').fill('#204080');
  const brightness = studio.getByTestId('background-brightness');
  await brightness.focus();
  for (let i = 0; i < 5; i++) await studio.keyboard.press('ArrowLeft');
  await expect(brightness).toHaveValue('0.5');
  await studio.getByTestId('shadow').focus();
  await studio.keyboard.press('Home');
  await expect(studio.getByTestId('shadow')).toHaveValue('0');
  await studio.getByTestId('preview-aspect').click();
  await studio.getByTestId('aspect-menu').getByRole('menuitemradio', { name: 'Custom size…' }).click();
  await studio.getByTestId('output-width').fill('640');
  await studio.getByTestId('output-width').press('Enter');
  await studio.getByTestId('output-height').fill('400');
  await studio.getByTestId('output-height').press('Enter');
  await studio.keyboard.press('Escape');

  // 1×: the preview at 100 % on a 1× display is the export, pixel for pixel.
  const preview1 = await previewPixels(studio);
  await addToPost(studio);
  const export1 = latestExport(documentId);
  expect(export1.composition.output.scale).toBe(1);
  expectAgreement(preview1, export1.png, export1.composition, 1);

  // 2×: reopen from the attachment, export at 2×, preview at 200 %.
  await composer.getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await expect(panel).toHaveAttribute('data-document-id', documentId);
  await studio.getByTestId('studio-export').click();
  await studio.getByTestId('output-scale-2').click();
  await studio.keyboard.press('Escape');
  await previewDrawn(studio);
  await addToPost(studio);
  const export2 = latestExport(documentId);
  expect(export2.composition.output.scale).toBe(2);
  expectAgreement(null, export2.png, export2.composition, 2);

  // Third export: crop, then a transparent background.
  await composer.getByRole('button', { name: 'Edit in Studio' }).click();
  await expect.poll(() => windowVisible(app!, '/studio/')).toBe(true);
  await studio.getByTestId('preview-crop').click();
  const handle = (await studio.getByTestId('crop-handle-se').boundingBox())!;
  await studio.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await studio.mouse.down();
  await studio.mouse.move(handle.x + handle.width / 2 - 120, handle.y + handle.height / 2 - 120, { steps: 6 });
  await studio.mouse.up();
  await studio.getByTestId('crop-apply').click();
  await expect(studio.getByTestId('popover-crop')).toHaveCount(0);
  await studio.getByTestId('bg-kind-none').click();
  await previewDrawn(studio);
  await addToPost(studio);
  const export3 = latestExport(documentId);
  expect(export3.composition.crop.width).toBeLessThan(1);
  expect(export3.composition.crop.height).toBeLessThan(1);
  expect(export3.composition.background.type).toBe('transparent');
  expect(export3.bytes[25], 'PNG colour type 6 (RGBA)').toBe(6);
  expect(pixel(export3.png, 2, 2)[3], 'alpha at a background pixel').toBe(0);
  const content = computeLayout(export3.composition, { scale: 2 }).content;
  expect(pixel(export3.png, ...centre(content, 0.5, 0.5))[3], 'the content stays opaque').toBe(255);

  // The source is untouched: the same bytes on disk and the same media row.
  expect(sha256(readFileSync(join(userData, 'media', source.path)))).toBe(sha256(fixtureBytes));
  const after = readDb(userData, (db) => db.prepare('SELECT bytes, width, height, sha256 FROM media WHERE id = ?').get(source.id));
  expect(after).toEqual({ bytes: source.bytes, width: source.width, height: source.height, sha256: source.sha256 });
});
