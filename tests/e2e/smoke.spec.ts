import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Smoke test against the built app (`pnpm test:e2e` builds first). It drives
// the real toggle path through the unpackaged-only `__xbotTest` seam.

const root = resolve(__dirname, '../..');
let userData: string;
let app: ElectronApplication;

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-'));
  app = await electron.launch({
    // '.' keeps the app path at the repo root, as in `pnpm dev`. Linux CI
    // boxes block the Chromium sandbox for unpackaged Electron (AppArmor).
    args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, XBOT_E2E: '1', XBOT_USER_DATA_DIR: userData },
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

async function composerPage(): Promise<Page> {
  const isComposer = (page: Page) => page.url().includes('/composer/');
  return app.windows().find(isComposer) ?? app.waitForEvent('window', { predicate: isComposer });
}

function composerState() {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/composer/'));
    return win ? { visible: win.isVisible(), bounds: win.getBounds() } : null;
  });
}

test('the tray toggle shows a 420 px composer that hides on Escape', async () => {
  const page = await composerPage();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Write Post' })).toBeVisible();

  await app.evaluate(() => (globalThis as unknown as { __xbotTest: { toggleComposer(): void } }).__xbotTest.toggleComposer());
  await expect.poll(async () => (await composerState())?.visible).toBe(true);
  expect((await composerState())?.bounds.width).toBe(420);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await composerState())?.visible).toBe(false);
});
