// Real macOS captures of the native glass (see docs/ARCHITECTURE.md →
// "Native material"). Run `pnpm capture:glass` (it builds first). macOS only;
// it needs Screen Recording permission for the terminal, and an unlocked,
// awake screen. What it does:
//
// 1. Launches the built app in preview mode and puts a borderless backdrop
//    window right behind the composer and the Studio, so the native
//    behind-window material blends what is really on screen. The backdrops are
//    two macOS wallpapers, a dark one, a busy high-frequency pattern and a
//    dense text page (other apps' windows usually sit behind xBot), plus solid
//    black and white for the opacity measurement. `screencapture -R` grabs the
//    screen region: the windows, their corners and shadow, and the backdrop.
//    The desktop wallpaper is never changed.
// 2. Captures Glass clarity 0, 80% and 100%, and today's look (`XBOT_GLASS=off`).
// 3. Gates, exiting 1 on any failure:
//    - contrast at the glyph edge, at the default 80%, on the five picture and
//      text backdrops: the editor ≥ 4.5:1, every other text element and icon
//      ≥ 3:1 (inactive controls excepted, as WCAG does), and Increase contrast
//      never below the default. For each element a second capture makes every
//      glyph and icon transparent; the glyph mask is what is brighter with
//      them, and the background is the 95th-percentile luminance of a ring
//      1–4 px outside the mask in the normal capture, halos included;
//    - the open glass's opacity, from a text-free gutter patch over black and
//      white: 80% is at most 0.25 × 0%, and 0% is within 0.03 of today's;
//    - the window is really in the capture (0% and 100% differ);
//    - the slider, driven with the keyboard, changes the glass live and its
//      value survives a relaunch; at 100% a real click on the open glass lands
//      in the composer instead of falling through.
//
// Outputs (PNGs and report.json) go to test-results/glass/ (git-ignored).
// Browser globals: the functions passed to page.evaluate() run in the app's pages.
/* global window, document, getComputedStyle, innerWidth, innerHeight, NodeFilter, Element */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'test-results', 'glass');
const DEFAULT = 0.8;
const CLARITIES = [0, DEFAULT, 1];
const MARGIN = 36;
/** The composer's text-free gutter (CSS px): beside the cards, below the top-left highlight, inside the bevel glow. */
const GUTTER = { x: 18, y: 300, width: 14, height: 120 };
/** The same in the Studio, left of the canvas (the Settings sheet covers the composer's). */
const STUDIO_GUTTER = { x: 16, y: 260, width: 14, height: 100 };

const DESKTOP_PICTURES = '/System/Library/Desktop Pictures';
const PICTURES = ['blue', 'light', 'dark', 'busy', 'text'];

if (process.platform !== 'darwin') {
  console.error('capture:glass: macOS only (native vibrancy and screencapture)');
  process.exit(1);
}

const failures = [];
const report = { contrast: {}, opacity: {}, checks: [] };

function check(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  report.checks.push({ ok, message });
  if (!ok) failures.push(message);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const out = (name) => join(OUT, name);

// ---------------------------------------------------------------- backdrops

const work = mkdtempSync(join(tmpdir(), 'xbot-glass-'));

/** A macOS wallpaper as a JPEG, or null where this Mac has none. */
function wallpaper(name, file) {
  const source = join(DESKTOP_PICTURES, file);
  if (!existsSync(source)) return null;
  const target = join(work, `${name}.jpg`);
  const result = spawnSync('sips', ['-s', 'format', 'jpeg', '-Z', '3024', source, '--out', target]);
  return result.status === 0 ? pathToFileURL(target).href : null;
}

function backdropHtml() {
  const blue = wallpaper('blue', 'iMac Blue.heic');
  const light = wallpaper('light', 'iMac Silver.heic');
  const words = 'the quick brown fox jumps over the lazy dog while seven tiny tools ship before lunch and nobody reads the docs'.split(' ');
  let text = '';
  for (let i = 0; i < 2400; i++) text += `${words[(i * 7) % words.length]} `;
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { background-size: cover; background-position: center; }
  .blue { background: ${blue ? `url('${blue}') center / cover` : 'linear-gradient(135deg, #3a64f0, #2347dc 35%, #2e5cf2 65%, #4f7bff)'}; }
  .light { background: ${light ? `url('${light}') center / cover` : 'linear-gradient(135deg, #f7f4ee, #e9ecf2 50%, #fbfbfd)'}; }
  .dark { background: radial-gradient(40% 35% at 70% 30%, rgb(70 74 96 / 0.7), transparent 70%), linear-gradient(135deg, #16171c, #23252c 50%, #0c0d10); }
  .busy { background:
    repeating-linear-gradient(115deg, #fff 0 9px, #111 9px 14px, #ffb000 14px 25px, #fff 25px 31px, #0a7cff 31px 42px, #e8452c 42px 50px),
    #fff; }
  .text { background: #fff; color: #111; font: 13px/1.35 -apple-system, sans-serif; padding: 8px; columns: 4; }
  .black { background: #000; }
  .white { background: #fff; }
  .text p { display: block; } p { display: none; margin: 0; }
  </style><body class="blue"><p>${text}</p></body>`;
}

// ---------------------------------------------------------------- the app

async function windowPage(app, surface) {
  const matches = (page) => page.url().includes(`/${surface}/`);
  return app.windows().find(matches) ?? app.waitForEvent('window', { predicate: matches });
}

function cleanEnv(extra) {
  const env = { ...process.env, XBOT_E2E: '1', XBOT_PREVIEW: '1', ...extra };
  // A terminal inside another Electron app may export these; they would run Electron as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

/** Launches the built app, places both windows side by side over a backdrop window, and returns the run. */
async function launch({ userData, env = {} }) {
  const app = await electron.launch({ args: ['.'], cwd: root, env: cleanEnv({ XBOT_USER_DATA_DIR: userData, ...env }) });
  const composer = await windowPage(app, 'composer');
  const studio = await windowPage(app, 'studio');
  for (const page of [composer, studio]) await page.waitForSelector('html[data-ready]');

  const display = await app.evaluate(({ screen }) => {
    const { workArea, bounds, scaleFactor } = screen.getPrimaryDisplay();
    return { workArea, bounds, scaleFactor };
  });
  const origin = { x: display.workArea.x + 60, y: display.workArea.y + 50 };
  const composerBounds = { x: origin.x + MARGIN, y: origin.y + MARGIN, width: 420 };
  const studioBounds = { x: composerBounds.x + 420 + 28, y: origin.y + MARGIN, width: 790, height: 635 };
  const region = { x: origin.x, y: origin.y, width: 420 + 28 + 790 + 2 * MARGIN, height: 635 + 2 * MARGIN };
  // Everything captured must be xBot over the backdrop, never another display.
  const fits = region.x + region.width <= display.bounds.x + display.bounds.width && region.y + region.height <= display.bounds.y + display.bounds.height;
  if (!fits) throw new Error(`the primary display (${display.workArea.width}×${display.workArea.height}) is too small for both windows side by side`);

  writeFileSync(join(work, 'backdrop.html'), backdropHtml());
  await app.evaluate(
    ({ BrowserWindow }, { display, file }) => {
      // Not focusable and shown inactive, so the composer keeps focus (it hides on blur).
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        focusable: false,
        show: false,
        hasShadow: false,
        skipTaskbar: true,
        enableLargerThanScreen: true,
        backgroundColor: '#ffffff',
      });
      win.setAlwaysOnTop(true, 'floating');
      globalThis.__glassBackdrop = win;
      return win.loadFile(file).then(() => win.showInactive());
    },
    { display, file: join(work, 'backdrop.html') },
  );

  await composer.evaluate(() => window.xbot.windows.hold());
  await app.evaluate(() => globalThis.__xbotTest.toggleComposer());
  await composer.waitForFunction(() => document.visibilityState === 'visible');
  await composer
    .waitForFunction(() => {
      const img = document.querySelector('[data-testid="attachment-thumbnail"]');
      return img !== null && img.complete && img.naturalWidth > 0;
    }, undefined, { timeout: 20_000 })
    .catch(() => console.log('note: no attachment thumbnail'));
  await app.evaluate(() => globalThis.__xbotTest.openStudio());
  await studio.waitForFunction(() => document.visibilityState === 'visible');
  await sleep(2500); // the seeded video's first frame and filmstrip

  const run = {
    app,
    composer,
    studio,
    display,
    region,
    async place() {
      await app.evaluate(
        ({ BrowserWindow }, { composerBounds, studioBounds }) => {
          for (const w of BrowserWindow.getAllWindows()) {
            const url = w.webContents.getURL();
            if (url.includes('/composer/')) {
              if (!w.isVisible()) w.showInactive();
              w.setBounds({ ...composerBounds, height: w.getBounds().height });
            } else if (url.includes('/studio/') && !w.isSimpleFullScreen()) {
              w.setBounds(studioBounds);
              w.setAlwaysOnTop(true, 'pop-up-menu');
              w.moveTop();
            }
          }
        },
        { composerBounds, studioBounds },
      );
      await sleep(500);
    },
    async backdrop(name) {
      await app.evaluate((_e, name) => globalThis.__glassBackdrop.webContents.executeJavaScript(`document.body.className = ${JSON.stringify(name)}`), name);
      await this.place();
      await sleep(400);
    },
    async setSetting(key, value) {
      const result = await composer.evaluate(([key, value]) => window.xbot.settings.set(key, value), [key, value]);
      if (!result.ok) throw new Error(`could not set ${key}: ${JSON.stringify(result)}`);
      await sleep(700);
    },
    shoot(name, rect = region) {
      const file = out(name);
      execFileSync('screencapture', ['-x', '-R', `${rect.x},${rect.y},${rect.width},${rect.height}`, file]);
      return file;
    },
    close: () => app.close(),
  };
  await run.place();
  return run;
}

// ---------------------------------------------------------------- measuring

const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const readPng = (file) => PNG.sync.read(readFileSync(file));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/** Light text runs, textareas and line icons the reader must see, in CSS px relative to the page. */
function collectElements() {
  const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e && e instanceof Element; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= Number(cs.opacity);
    }
    return o;
  };
  const items = [];
  const add = (el, rect, label, kind) => {
    if (el.closest('.tooltip, .visually-hidden, .btn-frost, .app-mark')) return;
    const cs = getComputedStyle(el);
    const [r, g, b, a = 1] = parse(cs.color);
    if (Math.min(r, g, b) < 180) return; // dark text belongs to frosted pills and media, not the glass
    const alpha = opacity(el) * a;
    if (alpha < 0.05 || rect.width < 2 || rect.height < 2) return;
    if (rect.x + rect.width < 0 || rect.y + rect.height < 0 || rect.x > innerWidth || rect.y > innerHeight) return;
    // Covered by a sheet or popover: not what the reader sees there.
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (top && !el.contains(top) && !top.contains(el)) return;
    const inactive = el.closest(':disabled, [aria-disabled="true"]') !== null;
    const editor = el.closest('[data-testid="post-editor"]') !== null;
    items.push({ label: label.slice(0, 40), kind, x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: [r, g, b], alpha, inactive, editor });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode()); ) {
    const text = node.textContent.trim();
    if (!text || !node.parentElement || node.parentElement.closest('textarea, svg')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) add(node.parentElement, rect, text, 'text');
  }
  for (const el of document.querySelectorAll('textarea')) {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const [pl, pt, pr, pb] = [cs.paddingLeft, cs.paddingTop, cs.paddingRight, cs.paddingBottom].map(parseFloat);
    add(el, { x: box.x + pl, y: box.y + pt, width: box.width - pl - pr, height: Math.min(box.height - pt - pb, el.scrollHeight - pt - pb) }, el.value || el.placeholder, 'text');
  }
  for (const el of document.querySelectorAll('svg')) {
    const host = el.closest('[aria-label], button, [title]');
    add(el, el.getBoundingClientRect(), `icon ${host?.getAttribute('aria-label') ?? host?.textContent?.trim() ?? ''}`, 'icon');
  }
  return items;
}

// Glyphs, icons and the marks drawn on icons (the Ideas dot) are the foreground.
const HIDE_GLYPHS = `*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } svg, .ideas-dot { opacity: 0 !important; filter: none !important; }`;

/** Recomputes both windows' shadows (they show through the clear glass) and lets the window server catch up. */
async function refreshShadows(run) {
  await run.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (/\/(composer|studio)\//.test(w.webContents.getURL())) w.invalidateShadow();
  });
  await sleep(300);
}

/** Captures `name` normally and with every glyph and icon hidden; returns both files and every element's screen box. */
async function captureForContrast(run, name, pages = ['composer', 'studio']) {
  const elements = [];
  for (const surface of pages) {
    const page = run[surface];
    if (!(await page.evaluate(() => document.visibilityState === 'visible'))) continue;
    const bounds = await run.app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`/${s}/`)).getContentBounds(), surface);
    for (const el of await page.evaluate(collectElements)) elements.push({ ...el, surface, x: el.x + bounds.x - run.region.x, y: el.y + bounds.y - run.region.y });
  }
  const normal = run.shoot(`${name}.png`);
  const keys = await run.app.evaluate(
    ({ BrowserWindow }, css) => Promise.all(BrowserWindow.getAllWindows().filter((w) => /\/(composer|studio)\//.test(w.webContents.getURL())).map(async (w) => [w.id, await w.webContents.insertCSS(css)])),
    HIDE_GLYPHS,
  );
  // insertCSS changes no DOM, so the page does not refresh the glass's shadow itself.
  await sleep(500);
  await refreshShadows(run);
  const hidden = run.shoot(`${name}.hidden.png`);
  await run.app.evaluate(({ BrowserWindow }, keys) => Promise.all(keys.map(([id, key]) => BrowserWindow.fromId(id)?.webContents.removeInsertedCSS(key))), keys);
  await sleep(500);
  await refreshShadows(run);
  return { normal, hidden, elements, scale: run.display.scaleFactor };
}

/** Glyph-edge contrast for every element (see the header). */
function measureContrast({ normal, hidden, elements, scale }) {
  const a = readPng(normal);
  const b = readPng(hidden);
  const lumAt = (png, i) => luminance(png.data[i], png.data[i + 1], png.data[i + 2]);
  const RING_IN = Math.ceil(scale);
  const RING_OUT = Math.ceil(4 * scale);
  const results = [];
  for (const el of elements) {
    const x0 = Math.max(0, Math.floor(el.x * scale) - RING_OUT);
    const y0 = Math.max(0, Math.floor(el.y * scale) - RING_OUT);
    const x1 = Math.min(a.width, Math.ceil((el.x + el.width) * scale) + RING_OUT);
    const y1 = Math.min(a.height, Math.ceil((el.y + el.height) * scale) + RING_OUT);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    // Glyph mask: inside the element's own box, brighter with the glyphs than without.
    const bx0 = Math.floor(el.x * scale) - x0;
    const by0 = Math.floor(el.y * scale) - y0;
    const bx1 = Math.ceil((el.x + el.width) * scale) - x0;
    const by1 = Math.ceil((el.y + el.height) * scale) - y0;
    const dist = new Int32Array(w * h).fill(-1);
    const queue = [];
    for (let y = Math.max(0, by0); y < Math.min(h, by1); y++) {
      for (let x = Math.max(0, bx0); x < Math.min(w, bx1); x++) {
        const i = ((y + y0) * a.width + (x + x0)) * 4;
        const brighter = Math.max(a.data[i] - b.data[i], a.data[i + 1] - b.data[i + 1], a.data[i + 2] - b.data[i + 2]);
        if (brighter >= 40) {
          dist[y * w + x] = 0;
          queue.push(y * w + x);
        }
      }
    }
    if (queue.length === 0) {
      results.push({ ...el, ratio: null, note: 'no glyph pixels found' });
      continue;
    }
    // Breadth-first distance from the mask, out to the ring's outer edge.
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q];
      const d = dist[p];
      if (d >= RING_OUT) continue;
      const px = p % w;
      const py = (p - px) / w;
      for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (dist[n] !== -1) continue;
        dist[n] = d + 1;
        queue.push(n);
      }
    }
    const ring = [];
    const near = [];
    for (let p = 0; p < dist.length; p++) {
      if (dist[p] > RING_IN && dist[p] <= RING_OUT) {
        const px = p % w;
        const py = (p - px) / w;
        const lum = lumAt(a, ((py + y0) * a.width + (px + x0)) * 4);
        ring.push(lum);
        if (dist[p] <= 2 * RING_IN) near.push(lum);
      }
    }
    const bg = percentile(ring, 0.95);
    const bgNear = percentile(near, 0.95);
    // The element's colour over that background, at its own alpha (in linear light, an approximation).
    const fg = el.alpha * luminance(...el.color) + (1 - el.alpha) * bg;
    const fgNear = el.alpha * luminance(...el.color) + (1 - el.alpha) * bgNear;
    const entry = { ...el, ratio: Number(ratio(fg, bg).toFixed(2)), ratioNear: Number(ratio(fgNear, bgNear).toFixed(2)) };
    if (el.editor) {
      // "Strict": the brightest 1% of the whole text box with no glyphs and no shadow.
      const box = [];
      for (let y = Math.max(0, by0); y < Math.min(h, by1); y++) for (let x = Math.max(0, bx0); x < Math.min(w, bx1); x++) box.push(lumAt(b, ((y + y0) * b.width + (x + x0)) * 4));
      entry.strict = Number(ratio(luminance(...el.color), percentile(box, 0.99)).toFixed(2));
    }
    results.push(entry);
  }
  return results;
}

/** Mean RGB of a CSS-px rect (relative to the capture region) in a capture. */
function meanRgb(file, rect, scale) {
  const png = readPng(file);
  let sum = 0;
  let n = 0;
  for (let y = Math.round(rect.y * scale); y < Math.round((rect.y + rect.height) * scale); y++) {
    for (let x = Math.round(rect.x * scale); x < Math.round((rect.x + rect.width) * scale); x++) {
      const i = (y * png.width + x) * 4;
      sum += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
      n++;
    }
  }
  return sum / n;
}

const gutterInRegion = { x: MARGIN + GUTTER.x, y: MARGIN + GUTTER.y, width: GUTTER.width, height: GUTTER.height };
const studioGutterInRegion = { x: MARGIN + 420 + 28 + STUDIO_GUTTER.x, y: MARGIN + STUDIO_GUTTER.y, width: STUDIO_GUTTER.width, height: STUDIO_GUTTER.height };

/** Opacity of the open glass: 1 − (over white − over black) / 255. */
async function opacity(run, label) {
  await run.backdrop('black');
  const black = run.shoot(`${label}-black.png`);
  await run.backdrop('white');
  const white = run.shoot(`${label}-white.png`);
  return 1 - (meanRgb(white, gutterInRegion, run.display.scaleFactor) - meanRgb(black, gutterInRegion, run.display.scaleFactor)) / 255;
}

/** A real (HID) mouse click at a global point, in screen coordinates, via JXA; the cursor goes back afterwards. */
function realClick(x, y) {
  execFileSync('osascript', [
    '-l',
    'JavaScript',
    '-e',
    `ObjC.import('CoreGraphics'); ObjC.import('AppKit');
     const h = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
     const was = $.NSEvent.mouseLocation;
     const post = (type, p) => $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, p, 0));
     post(5, { x: ${x}, y: ${y} }); delay(0.15);
     post(1, { x: ${x}, y: ${y} }); delay(0.05);
     post(2, { x: ${x}, y: ${y} }); delay(0.15);
     post(5, { x: was.x, y: h - was.y });`,
  ]);
}

// ---------------------------------------------------------------- main

mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'xbot-glass-data-'));
const baselineData = mkdtempSync(join(tmpdir(), 'xbot-glass-base-'));

try {
  // Today's look: no addon, titled windows, the old CSS.
  console.log('\n— today (XBOT_GLASS=off) —');
  const today = await launch({ userData: baselineData, env: { XBOT_GLASS: 'off' } });
  try {
    check((await today.composer.evaluate(() => document.documentElement.dataset.glass ?? null)) === null, 'XBOT_GLASS=off: the page has no data-glass');
    for (const name of PICTURES) {
      await today.backdrop(name);
      today.shoot(`today-${name}.png`);
    }
    report.opacity.today = await opacity(today, 'today');
  } finally {
    await today.close();
  }

  console.log('\n— native glass —');
  let run = await launch({ userData });
  try {
    check((await run.composer.evaluate(() => document.documentElement.dataset.glass ?? null)) === 'native', 'the page has data-glass="native"');
    for (const clarity of CLARITIES) {
      await run.setSetting('ui.glassClarity', clarity);
      const tag = `c${Math.round(clarity * 100)}`;
      for (const name of PICTURES) {
        await run.backdrop(name);
        if (clarity === DEFAULT) report.contrast[name] = measureContrast(await captureForContrast(run, `${tag}-${name}`));
        else run.shoot(`${tag}-${name}.png`);
      }
      report.opacity[tag] = await opacity(run, tag);
    }

    // The window is in the capture: the open glass differs between 0% and 100%.
    const diff = Math.abs(meanRgb(out('c0-light.png'), gutterInRegion, run.display.scaleFactor) - meanRgb(out('c100-light.png'), gutterInRegion, run.display.scaleFactor));
    check(diff > 8, `the windows are in the captures: the open glass changes between 0% and 100% (mean Δ ${diff.toFixed(1)}/255)`);

    // More states at the default, over the light backdrop.
    await run.setSetting('ui.glassClarity', DEFAULT);
    await run.backdrop('light');
    await run.studio.getByTestId('tool-background').click();
    await run.studio.waitForSelector('[data-testid="popover-background"][data-placed]');
    report.contrast['popover-light'] = measureContrast(await captureForContrast(run, 'c80-popover-light', ['studio']));
    await run.studio.keyboard.press('Escape');

    await run.setSetting('ui.increaseContrast', true);
    report.contrast['contrast-light'] = measureContrast(await captureForContrast(run, 'c80-increase-contrast-light'));
    await run.setSetting('ui.increaseContrast', false);
    await run.setSetting('ui.reduceTransparency', true);
    run.shoot('c80-reduce-transparency-light.png');
    await run.setSetting('ui.reduceTransparency', false);

    // Both windows at another size: the mask stretches with them (and the shadow follows).
    const sizes = await run.app.evaluate(({ BrowserWindow }) => {
      const find = (s) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`/${s}/`));
      const composer = find('composer');
      const height = composer.getBounds().height;
      composer.setSize(420, 470);
      find('studio').setSize(720, 560);
      return { height };
    });
    await sleep(800);
    run.shoot('c80-resized-light.png');
    await run.app.evaluate(({ BrowserWindow }, { height }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/composer/')).setSize(420, height), sizes);
    await run.place();

    // Simple full screen: the backdrop moves above the menu bar, so only xBot and the backdrop are captured.
    await run.app.evaluate(() => globalThis.__glassBackdrop.setAlwaysOnTop(true, 'status'));
    await run.studio.evaluate(() => window.xbot.studio.toggleFullscreen());
    await sleep(1500);
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/studio/')).setAlwaysOnTop(true, 'screen-saver'));
    await sleep(500);
    run.shoot('c80-studio-fullscreen-light.png', run.display.bounds);
    check((await run.studio.evaluate(() => document.documentElement.hasAttribute('data-fullscreen'))) === true, 'full screen: the Studio page has data-fullscreen (square corners)');
    await run.studio.evaluate(() => window.xbot.studio.toggleFullscreen());
    await run.app.evaluate(() => globalThis.__glassBackdrop.setAlwaysOnTop(true, 'floating'));
    await run.place();

    // The Settings sheet, open on Appearance, then the slider through the real UI.
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/composer/')).webContents.send('xbot:event', { name: 'ui:open-settings', payload: {} }));
    await run.composer.waitForSelector('[data-testid="glass-clarity"]');
    await run.composer.evaluate(() => document.querySelector('.settings-section[data-section="appearance"]')?.scrollIntoView({ block: 'start' }));
    await sleep(500);
    report.contrast['settings-light'] = measureContrast(await captureForContrast(run, 'c80-settings-light', ['composer']));
    const beforeSlide = run.shoot('slider-before.png');
    await run.composer.getByTestId('glass-clarity').focus();
    for (let i = 0; i < 30; i++) await run.composer.keyboard.press('ArrowLeft');
    await sleep(800);
    const afterSlide = run.shoot('slider-after.png');
    const saved = await run.composer.evaluate(() => window.xbot.settings.getAll().then((r) => r.ok && r.data['ui.glassClarity']));
    const slideDiff = Math.abs(meanRgb(beforeSlide, studioGutterInRegion, run.display.scaleFactor) - meanRgb(afterSlide, studioGutterInRegion, run.display.scaleFactor));
    check(Math.abs(saved - 0.5) < 0.001, `the slider, moved 30 steps with the keyboard, saves 50% (got ${saved})`);
    check(slideDiff > 3, `…and the glass changes live, in the Studio too (mean Δ ${slideDiff.toFixed(1)}/255)`);
    await run.composer.keyboard.press('Escape');
    await sleep(300);

    // At 100% a real click on the open glass lands in the composer's page, not the backdrop behind it.
    await run.setSetting('ui.glassClarity', 1);
    await run.backdrop('light');
    await run.composer.evaluate(() => {
      window.__glassClicks = 0;
      document.addEventListener('pointerdown', () => window.__glassClicks++, true);
    });
    const composerBox = await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/composer/')).getBounds());
    realClick(composerBox.x + GUTTER.x + GUTTER.width / 2, composerBox.y + GUTTER.y + GUTTER.height / 2);
    await sleep(600);
    const clicks = await run.composer.evaluate(() => window.__glassClicks);
    check(clicks === 1, `at 100%, a real click on the open glass lands in the composer (${clicks} pointerdown)`);
    await run.setSetting('ui.glassClarity', 0.5);
  } finally {
    await run.close();
  }

  // The slider's value survives a relaunch on the same userData.
  run = await launch({ userData });
  try {
    const persisted = await run.composer.evaluate(() => window.xbot.settings.getAll().then((r) => r.ok && r.data['ui.glassClarity']));
    check(persisted === 0.5, `Glass clarity persists across a relaunch (got ${persisted})`);
  } finally {
    await run.close();
  }

  // ---------------------------------------------------------------- the gate
  console.log('\n— contrast at 80% (glyph edge) —');
  for (const name of [...PICTURES, 'popover-light', 'settings-light']) {
    const rows = report.contrast[name] ?? [];
    const active = rows.filter((r) => !r.inactive && r.ratio !== null);
    const editor = active.filter((r) => r.editor);
    const other = active.filter((r) => !r.editor);
    const worst = [...other].sort((x, y) => x.ratio - y.ratio).slice(0, 3);
    const editorMin = Math.min(...editor.map((r) => r.ratio));
    if (editor.length > 0) check(editorMin >= 4.5, `${name}: editor ${editorMin.toFixed(2)}:1 ≥ 4.5:1 (strict box, no shadow: ${Math.min(...editor.map((r) => r.strict)).toFixed(2)}:1, reported only)`);
    check(other.every((r) => r.ratio >= 3), `${name}: ${other.length} other text elements and icons ≥ 3:1 (lowest: ${worst.map((r) => `${r.ratio} ${r.surface} "${r.label}"`).join(', ')})`);
    const unmeasured = rows.filter((r) => r.ratio === null).length;
    if (unmeasured) console.log(`info  ${name}: ${unmeasured} element(s) had no visible glyph pixels (clipped or covered)`);
  }
  const key = (r) => `${r.surface}|${r.kind}|${r.label}|${Math.round(r.x)}|${Math.round(r.y)}`;
  const defaults = new Map((report.contrast.light ?? []).map((r) => [key(r), r.ratio]));
  const lower = (report.contrast['contrast-light'] ?? []).filter((r) => !r.inactive && r.ratio !== null && defaults.has(key(r)) && defaults.get(key(r)) !== null && r.ratio < defaults.get(key(r)) - 0.05);
  check(lower.length === 0, `Increase contrast is never below the default (${lower.length} lower${lower.length ? `: ${lower.slice(0, 3).map((r) => `"${r.label}" ${r.ratio} < ${defaults.get(key(r))}`).join(', ')}` : ''})`);

  console.log('\n— opacity of the open glass (gutter, over black and white) —');
  const { today: o0today, c0, c80, c100 } = report.opacity;
  console.log(`info  today ${o0today.toFixed(3)}, 0% ${c0.toFixed(3)}, 80% ${c80.toFixed(3)}, 100% ${c100.toFixed(3)}`);
  check(c80 <= 0.25 * c0, `80% is about 80% less opaque: ${c80.toFixed(3)} ≤ 0.25 × ${c0.toFixed(3)} (${Math.round((1 - c80 / c0) * 100)}% less)`);
  check(Math.abs(c0 - o0today) <= 0.03, `0% matches today: ${c0.toFixed(3)} vs ${o0today.toFixed(3)} (±0.03)`);
} finally {
  writeFileSync(out('report.json'), JSON.stringify(report, null, 2));
  rmSync(work, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
  rmSync(baselineData, { recursive: true, force: true });
}

console.log(failures.length === 0 ? '\nall glass checks passed' : `\n${failures.length} glass check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
