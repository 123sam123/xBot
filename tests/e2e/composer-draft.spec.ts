import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// SPEC §22 "Draft restart recovery", end to end: type, attach the fixture PNG
// through the real picker path, quit right after the last keystroke, relaunch
// on the same userData, and find the same draft and thumbnail.

const root = resolve(__dirname, '../..');
const FIXTURE = join(root, 'resources', 'fixtures', 'my-tiny-tool.png');
let userData: string;
let app: ElectronApplication | null = null;

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, XBOT_E2E: '1', XBOT_USER_DATA_DIR: userData },
  });
}

async function shownComposer(electronApp: ElectronApplication): Promise<Page> {
  const isComposer = (page: Page) => page.url().includes('/composer/');
  const page = electronApp.windows().find(isComposer) ?? (await electronApp.waitForEvent('window', { predicate: isComposer }));
  // data-ready waits for the saved draft in normal mode.
  await page.waitForSelector('html[data-ready]');
  await electronApp.evaluate(() => (globalThis as unknown as { __xbotTest: { toggleComposer(): void } }).__xbotTest.toggleComposer());
  await expect.poll(() => composerVisible(electronApp)).toBe(true);
  return page;
}

/** Width of a loaded image, 0 until it has decoded. (Tests compile without the DOM lib, hence the shape.) */
const loadedWidth = (img: unknown) => {
  const image = img as { complete: boolean; naturalWidth: number };
  return image.complete ? image.naturalWidth : 0;
};

function composerVisible(electronApp: ElectronApplication): Promise<boolean | undefined> {
  return electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('/composer/'))
      ?.isVisible(),
  );
}

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'xbot-e2e-'));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test('a typed draft and an attached PNG survive a relaunch', async () => {
  const firstPart = 'Shipped autosaved drafts today.';
  const lastPart = ' They survive a restart.';

  app = await launch();
  let page = await shownComposer(app);

  // First run: the Welcome step shows once; skip it.
  await expect(page.getByTestId('onboarding-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('onboarding-sheet')).toHaveCount(0);

  const editor = page.getByTestId('post-editor');
  await editor.click();
  await page.keyboard.type(firstPart);

  // The real picker path, with the native dialog stubbed in main. Like a real
  // picker it takes focus away (the Studio comes forward for 300 ms), so the
  // composer must stay open through it.
  await app.evaluate(
    ({ BrowserWindow, dialog }, file) => {
      dialog.showOpenDialog = (async () => {
        const studio = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/studio/'));
        studio?.show();
        studio?.focus();
        await new Promise((done) => setTimeout(done, 300));
        studio?.hide();
        return { canceled: false, filePaths: [file] };
      }) as typeof dialog.showOpenDialog;
    },
    FIXTURE,
  );
  await page.getByTestId('upload-zone').click();
  const thumbnail = page.getByTestId('attachment-thumbnail');
  await expect(thumbnail).toHaveCount(1);
  await expect.poll(() => thumbnail.evaluate(loadedWidth)).toBeGreaterThan(0);
  expect(await composerVisible(app)).toBe(true);

  // Type the rest and quit at once, inside the autosave debounce.
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(lastPart);
  await app.close();
  app = null;

  app = await launch();
  page = await shownComposer(app);
  await expect(page.getByTestId('post-editor')).toHaveValue(firstPart + lastPart);
  const restored = page.getByTestId('attachment-thumbnail');
  await expect(restored).toHaveCount(1);
  expect(await restored.getAttribute('src')).toMatch(/^xbot-media:\/\//);
  await expect.poll(() => restored.evaluate(loadedWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId('onboarding-sheet')).toHaveCount(0);

  const media = join(userData, 'media');
  expect(readdirSync(media).filter((name) => name.endsWith('.png'))).toHaveLength(1);
  expect(readdirSync(join(media, 'thumbs')).filter((name) => name.endsWith('.png'))).toHaveLength(1);
});
