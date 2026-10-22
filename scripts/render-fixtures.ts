// Renders preview mode's sample media into resources/fixtures/ (all committed):
//
// 1. my-tiny-tool.png from scripts/fixtures/my-tiny-tool.html, in a bare
//    Electron (scripts/capture-stage.cjs), so no separate browser is needed;
// 2. my-tiny-tool.mp4 from that PNG with FFmpeg: 12.0 s at 30 fps, a cursor
//    dot moving over the tool, H.264 yuv420p, faststart, no audio, bit-exact
//    flags on one thread;
// 3. my-tiny-tool-framed.png: the built app in preview mode, on a temporary
//    userData, opens the seeded screenshot in Media Studio and runs its own
//    Add to post; the export it stores is copied out. The preview seed
//    (src/main/preview/seed.ts) hands those bytes to the same Add to post.
//
// Run `pnpm fixtures` (it builds first) after editing a source or the preview
// compositions in src/shared/previewSample.ts, and commit the results. Needs
// FFmpeg with libx264 on PATH; on Linux it runs itself under Xvfb.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LINUX = process.platform === 'linux';
const FIXTURES = join(root, 'resources', 'fixtures');
const SCREENSHOT = { source: 'scripts/fixtures/my-tiny-tool.html', output: join(FIXTURES, 'my-tiny-tool.png'), width: 1440, height: 800 };
const VIDEO = join(FIXTURES, 'my-tiny-tool.mp4');
const FRAMED = join(FIXTURES, 'my-tiny-tool-framed.png');
/** previewThumbnailComposition's export size. */
const FRAMED_SIZE = { width: 1540, height: 1000 };

/** On Linux, re-runs this script once under its own Xvfb screen. Returns only in the process that should do the work. */
function ensureDisplay(): void {
  if (!LINUX || process.env.XBOT_CAPTURE_CHILD === '1') return;
  const result = spawnSync(
    'xvfb-run',
    ['-a', '-s', '-screen 0 3200x2000x24', process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, XBOT_CAPTURE_CHILD: '1' } },
  );
  if (result.error && process.env.DISPLAY) return; // no xvfb-run, but a display exists: use it
  if (result.error) {
    console.error('render-fixtures: xvfb-run is required on Linux without a display');
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

const kb = (file: string) => `${Math.round(statSync(file).size / 1024)} KB`;

async function openStagePage(stage: ElectronApplication, width: number, height: number): Promise<Page> {
  const opened = stage.waitForEvent('window');
  await stage.evaluate(
    ({ BrowserWindow }, size) => {
      const win = new BrowserWindow({ ...size, x: 0, y: 0, frame: false, useContentSize: true, show: true });
      void win.loadURL('about:blank');
    },
    { width, height },
  );
  const page = await opened;
  await page.waitForLoadState();
  return page;
}

/** 1. The screenshot, from its HTML source. */
async function renderScreenshot(): Promise<void> {
  const stage = await electron.launch({
    args: [join(root, 'scripts/capture-stage.cjs'), '--force-device-scale-factor=1', ...(LINUX ? ['--no-sandbox'] : [])],
    cwd: root,
  });
  try {
    const page = await openStagePage(stage, SCREENSHOT.width, SCREENSHOT.height);
    await page.setContent(readFileSync(join(root, SCREENSHOT.source), 'utf8'));
    await page.evaluate(() => document.fonts.ready);
    mkdirSync(FIXTURES, { recursive: true });
    await page.screenshot({ path: SCREENSHOT.output, clip: { x: 0, y: 0, width: SCREENSHOT.width, height: SCREENSHOT.height } });
    console.log(`wrote resources/fixtures/my-tiny-tool.png (${SCREENSHOT.width}×${SCREENSHOT.height}, ${kb(SCREENSHOT.output)})`);
  } finally {
    await stage.close();
  }
}

/** 2. The sample clip: the screenshot with a cursor dot that passes the Process button. */
function renderVideo(): void {
  const size = 36;
  const centre = (size - 1) / 2;
  const dist = `hypot(X-${centre},Y-${centre})`;
  // A dark dot with a white ring; transparent outside it.
  const dot =
    `color=c=black:s=${size}x${size}:r=30:d=12,format=rgba,` +
    `geq=r='if(lte(${dist},11),28,255)':g='if(lte(${dist},11),30,255)':b='if(lte(${dist},11),40,255)':a='if(lte(${dist},15),230,0)'`;
  // A smooth loop over the tool: at t = 3 s it sits on the Process button (≈ 1140, 470).
  const path = `x=720+420*sin(2*PI*t/12)-${size / 2}:y=470+160*sin(PI*t/3)-${size / 2}`;
  try {
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-filter_threads', '1', '-filter_complex_threads', '1',
        '-loop', '1', '-framerate', '30', '-i', SCREENSHOT.output,
        '-f', 'lavfi', '-i', dot,
        '-filter_complex', `[0:v][1:v]overlay=${path}:eval=frame:shortest=1,format=yuv420p[v]`,
        '-map', '[v]', '-t', '12', '-r', '30', '-an',
        '-c:v', 'libx264', '-threads', '1', '-preset', 'slow', '-tune', 'stillimage', '-crf', '30', '-pix_fmt', 'yuv420p',
        '-flags:v', '+bitexact', '-fflags', '+bitexact', '-map_metadata', '-1',
        '-movflags', '+faststart',
        VIDEO,
      ],
      { stdio: 'inherit' },
    );
  } catch (err) {
    console.error('render-fixtures: FFmpeg with libx264 is required (macOS: brew install ffmpeg)');
    throw err;
  }
  console.log(`wrote resources/fixtures/my-tiny-tool.mp4 (1440×800, 12 s, ${kb(VIDEO)})`);
}

/** 3. The framed screenshot: the app's own Studio "Add to post" on the seeded screenshot. */
async function renderFramed(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'xbot-fixtures-'));
  const app = await electron.launch({
    args: ['.', '--force-device-scale-factor=1', ...(LINUX ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, XBOT_E2E: '1', XBOT_PREVIEW: '1', XBOT_USER_DATA_DIR: userData },
  });
  const db = () => new Database(join(userData, 'xbot.db'), { readonly: true, fileMustExist: true });
  const read = <T>(fn: (conn: Database.Database) => T): T => {
    const conn = db();
    try {
      return fn(conn);
    } finally {
      conn.close();
    }
  };
  const page = async (surface: 'composer' | 'studio'): Promise<Page> => {
    const matches = (p: Page) => p.url().includes(`/${surface}/`);
    const found = app.windows().find(matches) ?? (await app.waitForEvent('window', { predicate: matches }));
    await found.waitForSelector('html[data-ready]');
    return found;
  };
  const exports = () => read((conn) => conn.prepare("SELECT COUNT(*) FROM studio_exports WHERE format = 'png'").pluck().get() as number);
  try {
    const composer = await page('composer');
    await app.evaluate(() => (globalThis as unknown as { __xbotTest: { toggleComposer(): void } }).__xbotTest.toggleComposer());
    await composer.waitForFunction(() => document.visibilityState === 'visible');
    const documentId = read(
      (conn) =>
        conn
          .prepare(
            `SELECT a.studio_document_id FROM draft_attachments a JOIN drafts d ON d.id = a.draft_id
             WHERE d.is_current = 1 ORDER BY a.position LIMIT 1`,
          )
          .pluck()
          .get() as string | null,
    );
    if (!documentId) throw new Error('the preview seed made no Studio document for the screenshot (see the app log)');
    const before = exports();

    await composer.getByRole('button', { name: 'Edit in Studio' }).first().click();
    const studio = await page('studio');
    await studio.waitForSelector(`[data-testid="studio-panel"][data-document-id="${documentId}"]`);
    await studio.waitForFunction(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="studio-preview-canvas"]');
      const add = document.querySelector('[data-testid="studio-add"]');
      return canvas?.dataset.assetsReady === 'true' && canvas.dataset.drawnKey === canvas.dataset.wantKey && add?.getAttribute('aria-disabled') !== 'true';
    });
    await studio.getByTestId('studio-add').click();

    const deadline = Date.now() + 30_000;
    while (exports() === before) {
      if (Date.now() > deadline) throw new Error('Add to post stored no export within 30 s');
      await new Promise((done) => setTimeout(done, 200));
    }
    const path = read(
      (conn) =>
        conn
          .prepare("SELECT m.path FROM studio_exports e JOIN media m ON m.id = e.media_id WHERE e.document_id = ? AND e.format = 'png' ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1")
          .pluck()
          .get(documentId) as string,
    );
    copyFileSync(join(userData, 'media', path), FRAMED);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const size = pngSize(FRAMED);
  if (size.width !== FRAMED_SIZE.width || size.height !== FRAMED_SIZE.height) {
    throw new Error(`my-tiny-tool-framed.png is ${size.width}×${size.height}, expected ${FRAMED_SIZE.width}×${FRAMED_SIZE.height}`);
  }
  console.log(`wrote resources/fixtures/my-tiny-tool-framed.png (${size.width}×${size.height}, ${kb(FRAMED)})`);
}

ensureDisplay();
await renderScreenshot();
renderVideo();
await renderFramed();
