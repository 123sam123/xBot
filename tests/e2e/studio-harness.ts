import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

// Shared by the Studio specs: launch the built app in normal mode at a device
// pixel ratio of 1, find its pages, stub the file picker, read the database.

export const root = resolve(__dirname, '../..');

/** `env` adds test seams, e.g. XBOT_E2E_NO_FFMPEG or XBOT_E2E_FFMPEG_REALTIME (T5). */
export function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', '--force-device-scale-factor=1', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, XBOT_E2E: '1', XBOT_USER_DATA_DIR: userData, ...env },
  });
}

async function page(app: ElectronApplication, path: string): Promise<Page> {
  const matches = (p: Page) => p.url().includes(path);
  const found = app.windows().find(matches) ?? (await app.waitForEvent('window', { predicate: matches }));
  await found.waitForSelector('html[data-ready]');
  return found;
}

export const composerPage = (app: ElectronApplication) => page(app, '/composer/');
export const studioPage = (app: ElectronApplication) => page(app, '/studio/');

export function windowVisible(app: ElectronApplication, path: string): Promise<boolean | undefined> {
  return app.evaluate(
    ({ BrowserWindow }, p) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes(p))
        ?.isVisible(),
    path,
  );
}

/** Shows the composer and dismisses the first-run Welcome sheet. */
export async function showComposerFirstRun(app: ElectronApplication): Promise<Page> {
  const composer = await composerPage(app);
  await app.evaluate(() => (globalThis as unknown as { __xbotTest: { toggleComposer(): void } }).__xbotTest.toggleComposer());
  await expect.poll(() => windowVisible(app, '/composer/')).toBe(true);
  await composer.getByTestId('onboarding-sheet').getByRole('button', { name: 'Skip' }).click();
  await expect(composer.getByTestId('onboarding-sheet')).toHaveCount(0);
  return composer;
}

/** Every native open dialog returns `file`, as the real picker would after a choice. */
export async function stubPicker(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, file);
}

/** Reads the app's database from the test process, read-only. */
export function readDb<T>(userData: string, read: (db: Database.Database) => T): T {
  const db = new Database(join(userData, 'xbot.db'), { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** Waits until the Studio preview canvas has drawn the current composition with every image decoded. */
export async function previewDrawn(studio: Page): Promise<void> {
  const canvas = studio.getByTestId('studio-preview-canvas');
  await expect(canvas).toHaveAttribute('data-assets-ready', 'true');
  await expect
    .poll(() => canvas.evaluate((el) => (el as unknown as { dataset: Record<string, string> }).dataset).then((d) => d.drawnKey === d.wantKey))
    .toBe(true);
}

/** Export → Add to post, as the user does it. */
export async function addToPost(studio: Page): Promise<void> {
  if ((await studio.getByTestId('export-dialog').count()) === 0) await studio.getByTestId('studio-export').click();
  await studio.getByTestId('export-destination-post').click();
  await studio.getByTestId('export-go').click();
}
