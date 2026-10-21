// Renders the preview-mode sample media from committed HTML sources:
// scripts/fixtures/my-tiny-tool.html → resources/fixtures/my-tiny-tool.png.
// Run `pnpm fixtures` after editing a source, and commit both files. It drives
// Electron itself (scripts/capture-stage.cjs), so no separate browser is needed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURES = [
  { source: 'scripts/fixtures/my-tiny-tool.html', output: 'resources/fixtures/my-tiny-tool.png', width: 1440, height: 800 },
];

/** On Linux, re-runs this script once under its own Xvfb screen. Returns only in the process that should do the work. */
function ensureDisplay(): void {
  if (process.platform !== 'linux' || process.env.XBOT_CAPTURE_CHILD === '1') return;
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

ensureDisplay();

const stage = await electron.launch({
  args: [join(root, 'scripts/capture-stage.cjs'), '--force-device-scale-factor=1', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  cwd: root,
});
try {
  for (const fixture of FIXTURES) {
    const page = await openStagePage(stage, fixture.width, fixture.height);
    await page.setContent(readFileSync(join(root, fixture.source), 'utf8'));
    await page.evaluate(() => document.fonts.ready);
    mkdirSync(dirname(join(root, fixture.output)), { recursive: true });
    await page.screenshot({ path: join(root, fixture.output), clip: { x: 0, y: 0, width: fixture.width, height: fixture.height } });
    console.log(`wrote ${fixture.output} (${fixture.width}×${fixture.height})`);
  }
} finally {
  await stage.close();
}
