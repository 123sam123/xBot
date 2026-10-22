import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// The Studio's settings popovers float over the page (portal + fixed
// position), so opening one must never move or resize the canvas. Runs in
// preview mode, where the toolbar has a sample to edit.

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

test('opening the Background popover leaves the Studio canvas rect unchanged', async () => {
  const page = await studioPage();
  await page.waitForSelector('html[data-ready]');
  await app.evaluate(() => (globalThis as unknown as { __xbotTest: { openStudio(): void } }).__xbotTest.openStudio());

  const canvas = page.getByTestId('studio-canvas');
  await expect(canvas).toBeVisible();
  const before = await canvas.boundingBox();

  await page.getByTestId('tool-background').click();
  const popover = page.getByTestId('popover-background');
  await expect(popover).toBeVisible();
  await expect(popover).toHaveAttribute('data-placed', 'true');

  expect(await canvas.boundingBox()).toEqual(before);

  // Opening another tool's popover closes this one: one at a time.
  await page.getByTestId('tool-frame').click();
  await expect(page.getByTestId('popover-frame')).toBeVisible();
  await expect(popover).toHaveCount(0);
  expect(await canvas.boundingBox()).toEqual(before);
});
