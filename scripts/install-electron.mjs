// `postinstall`: downloads Electron's binary, so a fresh clone can `pnpm dev`
// straight after `pnpm install`. Electron 45 has no install script any more:
// the download is its `install-electron` bin (install.js), which nothing runs
// on install (see docs/ARCHITECTURE.md → "Dependencies and the lockfile").
// install.js reuses @electron/get's cache, honours ELECTRON_MIRROR, and does
// nothing when this version is already in place. It ignores
// ELECTRON_SKIP_BINARY_DOWNLOAD, so that is honoured here.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installJs = join(root, 'node_modules', 'electron', 'install.js');

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log('ELECTRON_SKIP_BINARY_DOWNLOAD is set: not downloading Electron.');
  process.exit(0);
}
// `pnpm install --prod` leaves out devDependencies, Electron among them.
if (!existsSync(installJs)) {
  console.log('Electron is not installed (a production install?): nothing to download.');
  process.exit(0);
}

const { status } = spawnSync(process.execPath, [installJs], { stdio: 'inherit' });
if (status !== 0) {
  console.error(
    'xBot: Electron could not be downloaded (see above). Run `pnpm exec install-electron` once you are back online, or `ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install` to install without it.',
  );
  process.exit(status ?? 1);
}
