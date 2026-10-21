// Captures both xBot surfaces and compares them with the reference image
// (SPEC §21). Run `pnpm capture` (it builds first). On Linux it runs itself
// under its own Xvfb screen. What it does:
//
// 1. Launches the built app in preview mode at 2× with `XBOT_MATERIAL=vibrancy`,
//    so the page draws the macOS layers on a transparent window, and captures
//    each window with its alpha channel. Variants: reduced transparency,
//    increase contrast, the CSS-only material, and normal (non-preview) mode.
// 2. Asserts geometry, honesty (sample data only in labelled preview mode),
//    the glass (neutral, takes its colour from the backdrop), contrast, the
//    Studio at its minimum size, Escape, live fallbacks and the CSP.
// 3. In a separate bare Electron process (scripts/capture-stage.cjs) it
//    composites the captures over generated wallpapers and builds side-by-side
//    and overlay images against docs/reference/xbot-final-ui.png.
//
// Outputs go to test-results/captures/ (git-ignored, never packaged); the
// comparison images the PR carries are also written to docs/reference/captures/.
//
// The behind-window blur is SIMULATED (24 px, saturate 1.3): Linux has no
// native vibrancy. `--desktop` (macOS only) takes real `screencapture` shots
// over the same wallpapers; it needs Screen Recording permission for the
// terminal and has not been run on macOS by the ticket that added it.
//
// The script exits non-zero if any assertion fails.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'test-results', 'captures');
const DOCS = join(root, 'docs', 'reference', 'captures');
const REFERENCE = join(root, 'docs', 'reference', 'xbot-final-ui.png');
const LINUX = process.platform === 'linux';

/** Device pixels per CSS px in the app captures. */
const SCALE = 2;
/** Reference image px per CSS px, and where each panel sits in it. */
const REF_SCALE = 1.483;
const REF_SIZE = { width: 1900, height: 1046 };
const REF_CROPS = {
  composer: { x: 44, y: 54, width: 623, height: 949 },
  studio: { x: 684, y: 54, width: 1168, height: 949 },
} as const;

/** The simulated native material: blur and saturation of the backdrop, and an approximate dark tint. */
const SIM_BLUR = 24;
const SIM_SATURATE = 1.3;
const SIM_TINT = 'rgb(30 30 34 / 0.35)';
const NATIVE_RADIUS = 10;

/** The composer's empty left gutter, CSS px: where the glass is sampled. */
const GUTTER = { x: 6, y: 140, width: 24, height: 280 };

const WALLPAPERS = {
  blue:
    'radial-gradient(30% 45% at 0% 0%, #efe8d4 0%, rgb(239 232 212 / 0) 70%),' +
    'radial-gradient(55% 35% at 30% 72%, rgb(150 185 255 / 0.85) 0%, rgb(150 185 255 / 0) 70%),' +
    'radial-gradient(45% 30% at 78% 30%, rgb(120 160 255 / 0.7) 0%, rgb(120 160 255 / 0) 70%),' +
    'radial-gradient(70% 60% at 90% 95%, #1430b8 0%, rgb(20 48 184 / 0) 70%),' +
    'linear-gradient(135deg, #3a64f0 0%, #2347dc 35%, #2e5cf2 65%, #4f7bff 100%)',
  orange:
    'radial-gradient(45% 35% at 25% 70%, rgb(255 214 150 / 0.8) 0%, rgb(255 214 150 / 0) 70%),' +
    'radial-gradient(60% 50% at 85% 20%, #ff4f6d 0%, rgb(255 79 109 / 0) 70%),' +
    'linear-gradient(135deg, #ffb347 0%, #ff7a33 45%, #e8452c 75%, #b5203f 100%)',
  light:
    'radial-gradient(50% 40% at 30% 70%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 70%),' +
    'linear-gradient(135deg, #f7f4ee 0%, #e9ecf2 50%, #fbfbfd 100%)',
  dark:
    'radial-gradient(50% 40% at 70% 30%, rgb(70 74 86 / 0.6) 0%, rgb(70 74 86 / 0) 70%),' +
    'linear-gradient(135deg, #1a1b20 0%, #24262c 50%, #0f1012 100%)',
} as const;
type WallpaperId = keyof typeof WALLPAPERS;
const WALLPAPER_IDS = Object.keys(WALLPAPERS) as WallpaperId[];

type Surface = 'composer' | 'studio';
type Box = { x: number; y: number; width: number; height: number };

// ---------------------------------------------------------------- plumbing

/** On Linux, re-runs this script once under its own big Xvfb screen (3200×2000 = 1600×1000 CSS px at 2×). */
function ensureDisplay(): void {
  if (!LINUX || process.env.XBOT_CAPTURE_CHILD === '1') return;
  const result = spawnSync(
    'xvfb-run',
    ['-a', '-s', '-screen 0 3200x2000x24', process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, XBOT_CAPTURE_CHILD: '1' } },
  );
  if (result.error) {
    console.error('capture: xvfb-run is required on Linux', result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

const out = (name: string) => join(OUT, name);

// ---------------------------------------------------------------- the app

interface AppRun {
  app: ElectronApplication;
  composer: Page;
  studio: Page;
  cspProblems: string[];
  close(): Promise<void>;
}

async function windowPage(app: ElectronApplication, surface: Surface): Promise<Page> {
  const matches = (page: Page) => page.url().includes(`/${surface}/`);
  return app.windows().find(matches) ?? app.waitForEvent('window', { predicate: matches });
}

/** Resolves once the page has its settings, fonts and images: `html[data-ready]`. */
async function settle(page: Page): Promise<void> {
  await page.waitForSelector('html[data-ready]');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
  });
}

/** Launches the built app with a fresh userData folder, so no setting carries over between variants. */
async function launch(env: Record<string, string>): Promise<AppRun> {
  const userData = mkdtempSync(join(tmpdir(), 'xbot-capture-'));
  const app = await electron.launch({
    args: ['.', `--force-device-scale-factor=${SCALE}`, ...(LINUX ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, XBOT_E2E: '1', XBOT_USER_DATA_DIR: userData, ...env },
  });
  // Registered for every page load, so it survives the reload below.
  await app.context().addInitScript(() => {
    const record = (window as unknown as { __csp: string[] }).__csp = [] as string[];
    document.addEventListener('securitypolicyviolation', (event) => record.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  const cspProblems: string[] = [];
  const composer = await windowPage(app, 'composer');
  const studio = await windowPage(app, 'studio');
  for (const page of [composer, studio]) {
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) cspProblems.push(message.text());
    });
    await page.reload();
    await settle(page);
  }
  return {
    app,
    composer,
    studio,
    cspProblems,
    async close() {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

async function windowState(app: ElectronApplication, surface: Surface) {
  return app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`/${s}/`));
    return win ? { visible: win.isVisible(), bounds: win.getBounds() } : null;
  }, surface);
}

async function showComposer(run: AppRun): Promise<void> {
  await run.app.evaluate(() => (globalThis as unknown as { __xbotTest: { toggleComposer(): void } }).__xbotTest.toggleComposer());
  await run.composer.waitForFunction(() => document.visibilityState === 'visible');
  await run.composer.getByTestId('post-editor').focus();
  await run.composer.waitForTimeout(300);
}

async function showStudio(run: AppRun): Promise<void> {
  await run.app.evaluate(() => (globalThis as unknown as { __xbotTest: { openStudio(): void } }).__xbotTest.openStudio());
  await run.studio.waitForFunction(() => document.visibilityState === 'visible');
  await run.studio.waitForTimeout(300);
}

async function openBackgroundPopover(studio: Page): Promise<void> {
  await studio.getByTestId('tool-background').click();
  await studio.waitForSelector('[data-testid="popover-background"][data-placed]');
}

async function shoot(page: Page, name: string): Promise<string> {
  const file = out(name);
  await page.screenshot({ path: file, omitBackground: true, animations: 'disabled', caret: 'initial' });
  return file;
}

async function box(page: Page, testId: string): Promise<Box> {
  const found = await page.getByTestId(testId).first().boundingBox();
  if (!found) throw new Error(`no box for ${testId}`);
  return found;
}

/** Sets an app setting through the real bridge, then waits for the root attribute to follow. */
async function setSetting(page: Page, key: string, value: boolean, attribute: string, expected: string | null): Promise<boolean> {
  await page.evaluate(
    ([k, v]) => (window as unknown as { xbot: { settings: { set(key: string, value: unknown): Promise<unknown> } } }).xbot.settings.set(k as string, v),
    [key, value] as const,
  );
  try {
    await page.waitForFunction(
      ([attr, want]) => document.documentElement.getAttribute(attr as string) === want,
      [attribute, expected] as const,
      { timeout: 3000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Hides the editor's text, caret and text-shadow (CSSOM, so the CSP allows it), to sample what is behind it. */
async function hideEditorText(composer: Page): Promise<Box> {
  return composer.getByTestId('post-editor').evaluate((el: HTMLElement) => {
    el.style.color = 'transparent';
    el.style.caretColor = 'transparent';
    el.style.textShadow = 'none';
    el.blur();
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const px = (v: string) => Number.parseFloat(v) || 0;
    return {
      x: rect.x + px(style.paddingLeft),
      y: rect.y + px(style.paddingTop),
      width: rect.width - px(style.paddingLeft) - px(style.paddingRight),
      height: rect.height - px(style.paddingTop) - px(style.paddingBottom),
    };
  });
}

async function fontCheck(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return false;
    const sample = 'Write Post · Media Studio';
    ctx.font = '20px monospace';
    const fallback = ctx.measureText(sample).width;
    ctx.font = '20px Inter, monospace';
    return ctx.measureText(sample).width !== fallback;
  });
}

// ---------------------------------------------------------------- the stage

interface Stage {
  render(html: string, width: number, height: number, file: string): Promise<string>;
  sample(file: string, rect: Box): Promise<{ r: number; g: number; b: number; a: number; chroma: number; maxLuminance: number }>;
  close(): Promise<void>;
}

async function openStage(): Promise<Stage> {
  const stage = await electron.launch({
    args: [join(root, 'scripts', 'capture-stage.cjs'), '--force-device-scale-factor=1', ...(LINUX ? ['--no-sandbox'] : [])],
    cwd: root,
  });
  const opened = stage.waitForEvent('window');
  await stage.evaluate(({ BrowserWindow }) => {
    const win = new BrowserWindow({ width: 800, height: 600, x: 0, y: 0, frame: false, useContentSize: true, show: true });
    void win.loadURL('about:blank');
  });
  const page = await opened;
  await page.waitForLoadState();

  return {
    async render(html, width, height, file) {
      await stage.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), {
        width,
        height,
      });
      await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const);
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #fff;
          font-family: -apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif; color: #111; }
        .abs { position: absolute; }
      </style></head><body>${html}</body></html>`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
      });
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
      return file;
    },
    async sample(file, rect) {
      return page.evaluate(
        async ([src, r]) => {
          const img = new Image();
          img.src = src as string;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const { x, y, width, height } = r as { x: number; y: number; width: number; height: number };
          // getImageData returns straight (not premultiplied) alpha.
          const data = ctx.getImageData(Math.round(x), Math.round(y), Math.round(width), Math.round(height)).data;
          let red = 0, green = 0, blue = 0, alpha = 0, chroma = 0, maxLuminance = 0;
          const n = data.length / 4;
          const linear = (c: number) => {
            const v = c / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          };
          for (let i = 0; i < data.length; i += 4) {
            const [pr, pg, pb, pa] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
            red += pr;
            green += pg;
            blue += pb;
            alpha += pa;
            chroma += Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
            maxLuminance = Math.max(maxLuminance, 0.2126 * linear(pr) + 0.7152 * linear(pg) + 0.0722 * linear(pb));
          }
          return { r: red / n, g: green / n, b: blue / n, a: alpha / n / 255, chroma: chroma / n, maxLuminance };
        },
        [dataUrl(file), rect] as const,
      );
    },
    close: () => stage.close(),
  };
}

/** The window over a wallpaper: simulated native blur (vibrancy) or straight through (CSS-only, transparent window). */
function compositeHtml(capture: string, size: { width: number; height: number }, wallpaper: WallpaperId, mode: 'vibrancy' | 'css', tint: boolean, margin: number): string {
  const blur = mode === 'vibrancy'
    ? `<div class="abs" style="left:${margin}px; top:${margin}px; width:${size.width}px; height:${size.height}px;
         border-radius:${NATIVE_RADIUS * SCALE}px; overflow:hidden; backdrop-filter: blur(${SIM_BLUR * SCALE}px) saturate(${SIM_SATURATE});
         box-shadow: 0 ${22 * SCALE}px ${50 * SCALE}px rgb(0 0 0 / 0.3);">
         ${tint ? `<div class="abs" style="inset:0; background:${SIM_TINT}"></div>` : ''}</div>`
    : '';
  return `<div class="abs" style="inset:0; background:${WALLPAPERS[wallpaper]}"></div>${blur}
    <img class="abs" src="${dataUrl(capture)}" style="left:${margin}px; top:${margin}px; width:${size.width}px; height:${size.height}px">`;
}

function caption(text: string, x: number, y: number, width: number): string {
  return `<div class="abs" style="left:${x}px; top:${y}px; width:${width}px; font-size:13px; line-height:16px; color:#333">${text}</div>`;
}

/** The reference panel, cropped and scaled to 1 CSS px = 1 image px. */
function referenceHtml(surface: Surface, x: number, y: number, opacity = 1): string {
  const crop = REF_CROPS[surface];
  const width = crop.width / REF_SCALE;
  const height = crop.height / REF_SCALE;
  return `<div class="abs" style="left:${x}px; top:${y}px; width:${width}px; height:${height}px; overflow:hidden; opacity:${opacity}">
    <img class="abs" src="${dataUrl(REFERENCE)}" style="left:${-crop.x / REF_SCALE}px; top:${-crop.y / REF_SCALE}px;
      width:${REF_SIZE.width / REF_SCALE}px; height:${REF_SIZE.height / REF_SCALE}px"></div>`;
}

// ---------------------------------------------------------------- runs

interface PreviewResults {
  composer: string;
  studio: string;
  composerSize: { width: number; height: number };
  studioSize: { width: number; height: number };
  editorBox: Box;
  composerNoText: string;
  composerContrastNoText: string;
}

async function capturePreview(): Promise<PreviewResults> {
  console.log('\n— preview mode, vibrancy layers —');
  const run = await launch({ XBOT_PREVIEW: '1', XBOT_MATERIAL: 'vibrancy' });
  const { app, composer, studio } = run;
  try {
    for (const page of [composer, studio]) {
      check(await page.evaluate(() => window.devicePixelRatio) === SCALE, `${page === composer ? 'composer' : 'studio'}: device pixel ratio is ${SCALE}`);
      if (LINUX) check(await fontCheck(page), `${page === composer ? 'composer' : 'studio'}: Inter is installed (Linux captures stand in for SF Pro)`);
    }

    // Composer.
    await showComposer(run);
    const composerWindow = await windowState(app, 'composer');
    check(composerWindow?.bounds.width === 420, `composer window is 420 wide (got ${composerWindow?.bounds.width})`);
    const panel = await box(composer, 'composer-panel');
    check(near(panel.height, 638, 12), `composer height ≈ 638 ±12 (got ${panel.height})`);
    check(composerWindow !== null && near(composerWindow.bounds.height, panel.height, 1), `composer window fits its content (window ${composerWindow?.bounds.height}, panel ${panel.height})`);
    const editor = await composer.locator('.post-editor-card').boundingBox();
    check(editor !== null && near(editor.width, 348, 6) && near(editor.height, 128, 6), `editor card ≈ 348×128 ±6 (got ${editor?.width}×${editor?.height})`);
    const post = await box(composer, 'post-button');
    check(near(post.width, 137, 4) && near(post.height, 42, 4), `Post ≈ 137×42 ±4 (got ${post.width}×${post.height})`);
    check(await composer.locator('.badge', { hasText: 'Preview' }).isVisible(), 'composer: the sample handle carries a visible "Preview" label');
    const composerFile = await shoot(composer, 'composer.png');

    // Live fallbacks: the app settings, through the real bridge.
    check(await setSetting(composer, 'ui.reduceTransparency', true, 'data-reduce-transparency', 'on'), 'reduce transparency switches live (setting → data-reduce-transparency)');
    await shoot(composer, 'composer-reduced.png');
    check(await setSetting(composer, 'ui.reduceTransparency', false, 'data-reduce-transparency', null), 'reduce transparency switches back live');
    check(await setSetting(composer, 'ui.increaseContrast', true, 'data-contrast', 'more'), 'increase contrast switches live (setting → data-contrast)');
    await shoot(composer, 'composer-contrast.png');
    const editorBox = await hideEditorText(composer);
    const composerContrastNoText = await shoot(composer, 'composer-contrast-notext.png');
    check(await setSetting(composer, 'ui.increaseContrast', false, 'data-contrast', null), 'increase contrast switches back live');
    const composerNoText = await shoot(composer, 'composer-notext.png');

    // The OS preferences reach the page through CSS media queries.
    const panelPaint = () => composer.getByTestId('composer-panel').evaluate((el) => getComputedStyle(el).backgroundImage);
    const basePaint = await panelPaint();
    await composer.emulateMedia({ contrast: 'more' });
    check((await panelPaint()) !== basePaint, 'prefers-contrast: more changes the panel paint');
    await composer.emulateMedia({ contrast: 'no-preference' });
    const cdp = await app.context().newCDPSession(composer);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    check((await panelPaint()) !== basePaint, 'prefers-reduced-transparency: reduce changes the panel paint');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    // Studio.
    await showStudio(run);
    const studioWindow = await windowState(app, 'studio');
    check(studioWindow?.bounds.width === 790 && studioWindow.bounds.height === 635, `studio window is 790×635 (got ${studioWindow?.bounds.width}×${studioWindow?.bounds.height})`);
    check(await studio.locator('.badge', { hasText: 'Preview' }).isVisible(), 'studio: the sample media carries a visible "Preview" label');
    const canvasBefore = await box(studio, 'studio-canvas');
    await openBackgroundPopover(studio);
    const canvasAfter = await box(studio, 'studio-canvas');
    check(JSON.stringify(canvasBefore) === JSON.stringify(canvasAfter), 'opening the Background popover leaves the canvas rect unchanged');
    check(near(canvasAfter.width, 712, 10) && near(canvasAfter.height, 346, 10), `canvas ≈ 712×346 ±10 (got ${canvasAfter.width}×${canvasAfter.height})`);
    const toolbar = await box(studio, 'studio-toolbar');
    check(near(toolbar.width, 583, 8) && near(toolbar.height, 72, 8), `toolbar ≈ 583×72 ±8 (got ${toolbar.width}×${toolbar.height})`);
    check(near(toolbar.y, canvasAfter.y + canvasAfter.height - 9, 2), 'toolbar overlaps the canvas bottom by about 9 px');
    const popover = await box(studio, 'popover-background');
    check(near(popover.width, 196, 8) && near(popover.height, 118, 8), `Background popover ≈ 196×118 ±8 (got ${popover.width}×${popover.height})`);
    const studioFile = await shoot(studio, 'studio.png');

    // Escape closes the popover, not the window.
    await studio.keyboard.press('Escape');
    check((await studio.getByTestId('popover-background').count()) === 0, 'Escape closes the open popover');
    check((await windowState(app, 'studio'))?.visible === true, 'that Escape leaves the Studio window open');

    // The minimum size: nothing overflows, the toolbar stays within the canvas column.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/studio/'))!.setSize(720, 560));
    await studio.waitForFunction(() => window.innerWidth === 720 && window.innerHeight === 560);
    const fit = await studio.evaluate(() => {
      const panelRect = document.querySelector('[data-testid="studio-panel"]')!.getBoundingClientRect();
      const outside = [...document.querySelectorAll<HTMLElement>('[data-testid]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.left < panelRect.left - 0.5 || r.top < panelRect.top - 0.5 || r.right > panelRect.right + 0.5 || r.bottom > panelRect.bottom + 0.5);
        })
        .map((el) => el.dataset.testid);
      const doc = document.documentElement;
      const canvas = document.querySelector('[data-testid="studio-canvas"]')!.getBoundingClientRect();
      const bar = document.querySelector('[data-testid="studio-toolbar"]')!.getBoundingClientRect();
      return {
        outside,
        scrolls: doc.scrollWidth > doc.clientWidth || doc.scrollHeight > doc.clientHeight,
        toolbarInColumn: bar.left >= canvas.left - 0.5 && bar.right <= canvas.right + 0.5,
      };
    });
    check(fit.outside.length === 0, `at 720×560 every [data-testid] stays inside the panel${fit.outside.length ? ` (outside: ${fit.outside.join(', ')})` : ''}`);
    check(!fit.scrolls, 'at 720×560 the page does not scroll');
    check(fit.toolbarInColumn, 'at 720×560 the toolbar stays within the canvas column');
    await shoot(studio, 'studio-720x560.png');

    for (const surface of ['composer', 'studio'] as const) {
      const page = surface === 'composer' ? composer : studio;
      const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
      check(violations.length === 0, `${surface}: no CSP violations${violations.length ? ` (${violations.join('; ')})` : ''}`);
    }
    check(run.cspProblems.length === 0, `no CSP console errors${run.cspProblems.length ? ` (${run.cspProblems.join('; ')})` : ''}`);

    return {
      composer: composerFile,
      studio: studioFile,
      composerSize: pngSize(composerFile),
      studioSize: pngSize(studioFile),
      editorBox,
      composerNoText,
      composerContrastNoText,
    };
  } finally {
    await run.close();
  }
}

async function captureCssMaterial(): Promise<{ composer: string; studio: string }> {
  console.log('\n— preview mode, CSS-only material —');
  const run = await launch({ XBOT_PREVIEW: '1', XBOT_MATERIAL: 'css' });
  try {
    check((await run.composer.evaluate(() => document.documentElement.dataset.material)) === 'css', 'XBOT_MATERIAL=css reaches the page');
    await showComposer(run);
    const composer = await shoot(run.composer, 'composer-css.png');
    await showStudio(run);
    await openBackgroundPopover(run.studio);
    const studio = await shoot(run.studio, 'studio-css.png');
    return { composer, studio };
  } finally {
    await run.close();
  }
}

async function captureNormalMode(): Promise<void> {
  console.log('\n— normal mode (no preview) —');
  const run = await launch({ XBOT_MATERIAL: 'vibrancy' });
  try {
    await showComposer(run);
    const { composer, studio } = run;
    // A fresh userData shows the one-time Welcome sheet over the composer; skip it.
    await composer.getByTestId('onboarding-sheet').getByRole('button', { name: 'Skip' }).click();
    check((await composer.getByTestId('account-trigger').innerText()).includes('Connect X'), 'normal mode: the header says "Connect X"');
    for (const [name, page] of [['composer', composer], ['studio', studio]] as const) {
      check(!(await page.locator('body').innerText()).includes('@samuelbuilds'), `normal mode: no sample handle in the ${name}`);
      check((await page.locator('img[src*="my-tiny-tool"]').count()) === 0, `normal mode: no sample media in the ${name}`);
      check((await page.locator('.badge', { hasText: 'Preview' }).count()) === 0, `normal mode: no "Preview" label in the ${name}`);
    }
    // Without X, Post opens the publish-options sheet (T3); with an empty draft it is disabled and says why.
    const post = composer.getByTestId('post-button');
    check((await post.getAttribute('aria-disabled')) === 'true', 'normal mode: Post is disabled for an empty draft');
    const describedBy = await post.getAttribute('aria-describedby');
    const reason = describedBy ? await composer.locator(`[id="${describedBy}"]`).innerText() : '';
    check(reason === 'Write something or add media first', `normal mode: Post explains "Write something or add media first" (got "${reason}")`);
    await shoot(composer, 'composer-normal.png');
    await showStudio(run);
    check((await studio.getByTestId('studio-add').getAttribute('aria-disabled')) === 'true', 'normal mode: Add to post is disabled');
    await shoot(studio, 'studio-normal.png');
  } finally {
    await run.close();
  }
}

// ---------------------------------------------------------------- comparisons

async function buildComparisons(stage: Stage, preview: PreviewResults, css: { composer: string; studio: string }): Promise<void> {
  console.log('\n— composites and comparisons —');
  const margin = 40 * SCALE;
  const composite = async (surface: Surface, capture: string, size: { width: number; height: number }, wallpaper: WallpaperId, mode: 'vibrancy' | 'css', tint: boolean) => {
    const name = `${surface}-${mode}-${wallpaper}${tint ? '-tint' : ''}.png`;
    return stage.render(compositeHtml(capture, size, wallpaper, mode, tint, margin), size.width + 2 * margin, size.height + 2 * margin, out(name));
  };

  const sizes = { composer: preview.composerSize, studio: preview.studioSize };
  const captures = { composer: preview.composer, studio: preview.studio };
  const tiles: Record<Surface, Record<string, string>> = { composer: {}, studio: {} };
  for (const surface of ['composer', 'studio'] as const) {
    for (const wallpaper of WALLPAPER_IDS) {
      for (const tint of [false, true]) {
        tiles[surface][`${wallpaper}${tint ? '-tint' : ''}`] = await composite(surface, captures[surface], sizes[surface], wallpaper, 'vibrancy', tint);
      }
    }
    tiles[surface]['css-blue'] = await composite(surface, surface === 'composer' ? css.composer : css.studio, sizes[surface], 'blue', 'css', false);
  }

  // The glass is neutral and takes its colour from the backdrop.
  const gutter = { x: GUTTER.x * SCALE, y: GUTTER.y * SCALE, width: GUTTER.width * SCALE, height: GUTTER.height * SCALE };
  const raw = await stage.sample(preview.composer, gutter);
  check(raw.a < 0.5 && raw.chroma < 24, `composer gutter on a transparent background: alpha ${raw.a.toFixed(2)} < 0.5, chroma ${raw.chroma.toFixed(1)} < 24 (not painted blue)`);
  const inComposite = { ...gutter, x: gutter.x + margin, y: gutter.y + margin };
  const onBlue = await stage.sample(tiles.composer.blue!, inComposite);
  const onOrange = await stage.sample(tiles.composer.orange!, inComposite);
  const delta = Math.hypot(onBlue.r - onOrange.r, onBlue.g - onOrange.g, onBlue.b - onOrange.b);
  check(delta > 40, `the glass over blue vs. orange (simulated, no tint) differs by ΔRGB ${delta.toFixed(1)} > 40`);
  const reduced = await stage.sample(out('composer-reduced.png'), gutter);
  check(reduced.a >= 0.98 && reduced.chroma < 24, `reduced transparency: gutter alpha ${reduced.a.toFixed(2)} ≥ 0.98, chroma ${reduced.chroma.toFixed(1)} < 24 (graphite, never navy)`);

  // Contrast of white text against what is behind it, on the light wallpaper.
  const textBox = {
    x: preview.editorBox.x * SCALE + margin,
    y: preview.editorBox.y * SCALE + margin,
    width: preview.editorBox.width * SCALE,
    height: preview.editorBox.height * SCALE,
  };
  const ratio = (luminance: number) => 1.05 / (luminance + 0.05);
  const strong = await stage.sample(
    await stage.render(compositeHtml(preview.composerContrastNoText, sizes.composer, 'light', 'vibrancy', false, margin), sizes.composer.width + 2 * margin, sizes.composer.height + 2 * margin, out('contrast-more-light.png')),
    textBox,
  );
  check(ratio(strong.maxLuminance) >= 4.5, `increase contrast, light wallpaper, no tint: editor text ${ratio(strong.maxLuminance).toFixed(2)}:1 ≥ 4.5:1`);
  const normal = await stage.sample(
    await stage.render(compositeHtml(preview.composerNoText, sizes.composer, 'light', 'vibrancy', true, margin), sizes.composer.width + 2 * margin, sizes.composer.height + 2 * margin, out('contrast-default-light-tint.png')),
    textBox,
  );
  check(ratio(normal.maxLuminance) >= 3, `default, light wallpaper, dark tint: editor text ${ratio(normal.maxLuminance).toFixed(2)}:1 ≥ 3:1`);
  const normalNoTint = await stage.sample(
    await stage.render(compositeHtml(preview.composerNoText, sizes.composer, 'light', 'vibrancy', false, margin), sizes.composer.width + 2 * margin, sizes.composer.height + 2 * margin, out('contrast-default-light.png')),
    textBox,
  );
  console.log(`info  default, light wallpaper, no tint (worst case): editor text ${ratio(normalNoTint.maxLuminance).toFixed(2)}:1`);

  mkdirSync(DOCS, { recursive: true });
  const expected: Record<string, { width: number; height: number }> = {};
  for (const surface of ['composer', 'studio'] as const) {
    const size = sizes[surface];
    const w = size.width / SCALE;
    const h = size.height / SCALE;
    const refW = Math.round(REF_CROPS[surface].width / REF_SCALE);
    const refH = Math.round(REF_CROPS[surface].height / REF_SCALE);
    const ours = (file: string, x: number, y: number) =>
      `<div class="abs" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px; overflow:hidden">
        <img class="abs" src="${dataUrl(file)}" style="left:${-margin / SCALE}px; top:${-margin / SCALE}px; width:${w + (2 * margin) / SCALE}px; height:${h + (2 * margin) / SCALE}px"></div>`;
    const gap = 24;
    const top = 44;
    const colW = Math.max(refW, w);
    const height = top + Math.max(refH, h) + 16;

    // Side by side: the reference, then ours with the simulated native material, then the CSS-only fallback.
    const sbsWidth = gap + 3 * (colW + gap);
    const sbs = [
      caption('<b>Reference</b> (docs/reference/xbot-final-ui.png, 1 CSS px = 1 px)', gap, 10, colW),
      referenceHtml(surface, gap, top),
      caption(`<b>xBot, native vibrancy</b> — simulated: blur ${SIM_BLUR} px, saturate ${SIM_SATURATE}, no tint; ${NATIVE_RADIUS} px system corners`, gap * 2 + colW, 10, colW),
      ours(tiles[surface].blue!, gap * 2 + colW, top),
      caption('<b>xBot, CSS-only fallback</b> (transparent window, no blur; 40 px corners)', gap * 3 + 2 * colW, 10, colW),
      ours(tiles[surface]['css-blue']!, gap * 3 + 2 * colW, top),
    ].join('');
    const sbsFile = await stage.render(`<div class="abs" style="inset:0; background:#f2f2f4"></div>${sbs}`, sbsWidth, height, out(`${surface}-side-by-side.png`));
    expected[`${surface}-side-by-side.png`] = { width: sbsWidth, height };

    // Overlay: ours with the reference at 50% on top.
    const ovWidth = colW + 2 * gap;
    const overlay = `<div class="abs" style="inset:0; background:#f2f2f4"></div>
      ${caption('<b>Overlay</b>: xBot (simulated vibrancy) with the reference at 50% on top', gap, 10, colW)}
      ${ours(tiles[surface].blue!, gap, top)}${referenceHtml(surface, gap, top, 0.5)}`;
    const ovFile = await stage.render(overlay, ovWidth, height, out(`${surface}-overlay.png`));
    expected[`${surface}-overlay.png`] = { width: ovWidth, height };

    // Wallpapers: the same capture over four backdrops, without and with the approximate dark tint (half size).
    const tileW = Math.round(w / 2);
    const tileH = Math.round(h / 2);
    const wpWidth = gap + WALLPAPER_IDS.length * (tileW + gap);
    const header = 48;
    const wpHeight = header + 2 * (tileH + 30) + 10;
    const cells = WALLPAPER_IDS.flatMap((wallpaper, col) =>
      [false, true].map((tint, row) => {
        const x = gap + col * (tileW + gap);
        const y = header + row * (tileH + 30) + 18;
        const file = tiles[surface][`${wallpaper}${tint ? '-tint' : ''}`]!;
        return `${caption(`${wallpaper}${tint ? ' + dark tint' : ''}`, x, y - 17, tileW)}
          <div class="abs" style="left:${x}px; top:${y}px; width:${tileW}px; height:${tileH}px; overflow:hidden">
            <img class="abs" src="${dataUrl(file)}" style="left:${-margin / (2 * SCALE)}px; top:${-margin / (2 * SCALE)}px; width:${tileW + margin / SCALE}px; height:${tileH + margin / SCALE}px"></div>`;
      }),
    );
    const wpFile = await stage.render(
      `<div class="abs" style="inset:0; background:#f2f2f4"></div>
       ${caption(`<b>${surface}</b> over four wallpapers — simulated native material (blur ${SIM_BLUR} px, saturate ${SIM_SATURATE}); second row adds an approximate dark tint (${SIM_TINT}). Not a macOS capture.`, gap, 8, wpWidth - 2 * gap)}
       ${cells.join('')}`,
      wpWidth,
      wpHeight,
      out(`wallpapers-${surface}.png`),
    );
    expected[`wallpapers-${surface}.png`] = { width: wpWidth, height: wpHeight };

    for (const file of [sbsFile, ovFile, wpFile]) copyFileSync(file, join(DOCS, file.split('/').pop()!));
  }

  for (const [name, size] of Object.entries(expected)) {
    let actual = { width: 0, height: 0 };
    try {
      actual = pngSize(join(DOCS, name));
    } catch {
      // missing: reported below
    }
    check(actual.width === size.width && actual.height === size.height, `docs/reference/captures/${name} exists at ${size.width}×${size.height}`);
  }
}

// ---------------------------------------------------------------- macOS desktop captures

async function desktopCaptures(stage: Stage): Promise<void> {
  console.log('\n— macOS desktop captures (real native material) —');
  const folder = mkdtempSync(join(tmpdir(), 'xbot-wallpapers-'));
  const stamp = Date.now();
  const wallpaperFiles: Record<string, string> = {};
  for (const id of WALLPAPER_IDS) {
    // macOS caches wallpapers by path, so every run uses new file names.
    wallpaperFiles[id] = await stage.render(`<div class="abs" style="inset:0; background:${WALLPAPERS[id]}"></div>`, 2880, 1800, join(folder, `${id}-${stamp}.png`));
  }
  const osascript = (script: string) => execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
  const original = osascript('tell application "System Events" to get picture of current desktop');
  const setWallpaper = (file: string) => osascript(`tell application "System Events" to tell every desktop to set picture to POSIX file "${file}"`);
  const materials = (process.env.XBOT_CAPTURE_MATERIALS ?? 'under-window,hud,none').split(',');
  try {
    for (const material of materials) {
      for (const surface of ['composer', 'studio'] as const) {
        const run = await launch({ XBOT_PREVIEW: '1', XBOT_VIBRANCY: material });
        try {
          if (surface === 'composer') await showComposer(run);
          else {
            await showStudio(run);
            await openBackgroundPopover(run.studio);
          }
          const sourceId = await run.app.evaluate(({ BrowserWindow }, s) => {
            const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`/${s}/`));
            return win?.getMediaSourceId() ?? '';
          }, surface);
          const windowId = sourceId.split(':')[1]; // "window:<CGWindowID>:0"
          if (!windowId) throw new Error(`no window id for ${surface} (${sourceId})`);
          for (const id of WALLPAPER_IDS) {
            setWallpaper(wallpaperFiles[id]!);
            await new Promise((done) => setTimeout(done, 1500));
            const file = out(`desktop-${surface}-${material}-${id}.png`);
            execFileSync('screencapture', ['-x', `-l${windowId}`, file]);
            console.log(`wrote ${file}`);
          }
        } finally {
          await run.close();
        }
      }
    }
  } finally {
    if (original) setWallpaper(original);
    rmSync(folder, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- main

ensureDisplay();
mkdirSync(OUT, { recursive: true });
const desktop = process.argv.includes('--desktop');
if (desktop && process.platform !== 'darwin') {
  console.error('capture: --desktop needs macOS (native vibrancy and screencapture)');
  process.exit(1);
}

const preview = await capturePreview();
const cssCaptures = await captureCssMaterial();
await captureNormalMode();
const stage = await openStage();
try {
  await buildComparisons(stage, preview, cssCaptures);
  if (desktop) await desktopCaptures(stage);
} finally {
  await stage.close();
}

writeFileSync(out('summary.json'), JSON.stringify({ failures }, null, 2));
console.log(failures.length === 0 ? '\nall capture checks passed' : `\n${failures.length} capture check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
