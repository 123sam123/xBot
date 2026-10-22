import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// The Studio's popovers float over the page (portal + fixed position) and the
// inspector swaps its tabs in place, so neither may move or resize the canvas.
// Runs in preview mode, where there is a sample to edit.

const root = resolve(__dirname, '../..');
let userData: string;
let app: ElectronApplication;

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-'));
  app = await electron.launch({
    args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, XBOT_E2E: '1', XBOT_PREVIEW: '1', XBOT_USER_DATA_DIR: userData },
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

async function studioPage(): Promise<Page> {
  const isStudio = (page: Page) => page.url().includes('/studio/');
  return app.windows().find(isStudio) ?? app.waitForEvent('window', { predicate: isStudio });
}

test('the inspector and the popovers never move the Studio canvas, and one popover is open at a time', async () => {
  const page = await studioPage();
  await page.waitForSelector('html[data-ready]');
  await app.evaluate(() => (globalThis as unknown as { __xbotTest: { openStudio(): void } }).__xbotTest.openStudio());

  const canvas = page.getByTestId('studio-canvas');
  await expect(canvas).toBeVisible();
  const before = await canvas.boundingBox();

  // The inspector's tabs swap in place.
  await page.getByTestId('sidebar-tab-audio').click();
  await page.getByTestId('sidebar-tab-background').click();
  await expect(page.getByTestId('bg-kind-wallpaper')).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(before);

  await page.getByTestId('preview-frame').click();
  const frame = page.getByTestId('popover-frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-placed', 'true');
  expect(await canvas.boundingBox()).toEqual(before);

  // Opening another popover closes this one: one at a time.
  await page.getByTestId('studio-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(frame).toHaveCount(0);
  expect(await canvas.boundingBox()).toEqual(before);
});
