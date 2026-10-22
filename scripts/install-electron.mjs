// `postinstall`: downloads Electron's binary, so a fresh clone can `pnpm dev`
// straight after `pnpm install`. Electron 45 has no install script any more:
// the download is its `install-electron` bin (install.js), which nothing runs
// on install (see docs/ARCHITECTURE.md → "Dependencies and the lockfile").
// install.js reuses @electron/get's cache, honours ELECTRON_MIRROR, and does
// nothing when this version is already in place. It ignores
// ELECTRON_SKIP_BINARY_DOWNLOAD, so that is honoured here.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log('ELECTRON_SKIP_BINARY_DOWNLOAD is set: not downloading Electron.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { status } = spawnSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });
if (status !== 0) {
  console.error('xBot: Electron could not be downloaded (see above). If you are offline, run `pnpm exec install-electron` once you are back online.');
  process.exit(status ?? 1);
}
