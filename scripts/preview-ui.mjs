// `pnpm preview:ui`: the built app in preview mode on a fresh, temporary
// userData, so every run starts from the same labelled sample (seeded by
// src/main/preview/seed.ts from resources/fixtures/). AI, X, project folders
// and reminders are off; drafts, media and the Studio work as usual. The
// folder is removed when the app quits. Extra arguments are passed to
// Electron. `--preview` / XBOT_PREVIEW=1 instead keep a persistent
// "xBot Preview" folder.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const userData = mkdtempSync(join(tmpdir(), 'xbot-preview-'));
const env = { ...process.env, XBOT_PREVIEW: '1', XBOT_USER_DATA_DIR: userData };
delete env.XBOT_E2E;

console.log(`xBot preview: sample data in ${userData} (removed on quit)`);
// Ubuntu's AppArmor blocks Chromium's sandbox for an unpackaged Electron (see docs/ARCHITECTURE.md → "On Linux CI").
const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...process.argv.slice(2)];
const child = spawn(electronPath, args, { cwd: root, env, stdio: 'inherit' });

const cleanUp = () => rmSync(userData, { recursive: true, force: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (err) => {
  console.error('xBot preview: could not start Electron', err);
  cleanUp();
  process.exit(1);
});
child.on('exit', (code, signal) => {
  cleanUp();
  process.exit(code ?? (signal ? 1 : 0));
});
