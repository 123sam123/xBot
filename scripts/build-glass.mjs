// Builds the native glass addon (native/glass/glass.mm → native/glass/build/glass.node),
// see docs/ARCHITECTURE.md → "Native material". Runs from `postinstall`,
// `dev`, `build` and `package`, and as `pnpm glass`.
//
// One universal (arm64 + x86_64) clang++ call against Node-API's C headers:
// Node-API is ABI-stable, so there is no Electron headers download and no
// node-gyp or Python. It skips the compile while the binary is newer than its
// source and this script.
//
// Without the Xcode Command Line Tools (or off macOS) it prints one line and
// exits 0: xBot then runs with the system's glass. `--strict` (used by
// `pnpm package`) exits 1 on macOS unless a fresh universal binary is there.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const source = join(root, 'native', 'glass', 'glass.mm');
const output = join(root, 'native', 'glass', 'build', 'glass.node');
const strict = process.argv.includes('--strict');
const ARCHS = ['arm64', 'x86_64'];

if (process.platform !== 'darwin') {
  console.log('Native glass is macOS-only: not building it.');
  process.exit(0);
}

function fail(reason, detail) {
  if (detail) console.error(detail.trim());
  console.error(`xBot: native glass not built (${reason}). xBot will run with the system's glass (see README → "Native glass").`);
  process.exit(strict ? 1 : 0);
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function universal(file) {
  const lipo = run('xcrun', ['lipo', '-archs', file]);
  const archs = lipo.status === 0 ? lipo.stdout.trim().split(/\s+/) : [];
  return ARCHS.every((arch) => archs.includes(arch));
}

const upToDate = existsSync(output) && [source, script].every((file) => statSync(output).mtimeMs > statSync(file).mtimeMs);
if (upToDate && !strict) process.exit(0);

// `xcode-select -p` fails quietly without the tools, where the /usr/bin/xcrun
// stub would open the "install developer tools" dialog. DEVELOPER_DIR makes
// it print any path, so the directory must also exist.
const developerDir = run('xcode-select', ['-p']);
if (developerDir.status !== 0 || !existsSync(developerDir.stdout.trim())) {
  fail('no Xcode Command Line Tools; install them with `xcode-select --install`');
}
const clang = run('xcrun', ['--find', 'clang++']);
if (clang.status !== 0) fail('xcrun cannot find clang++', clang.stderr);
if (upToDate && universal(output)) process.exit(0);

let includeDir;
try {
  includeDir = createRequire(import.meta.url)('node-api-headers').include_dir;
} catch {
  fail('the node-api-headers dev dependency is missing; run `pnpm install`');
}

mkdirSync(dirname(output), { recursive: true });
// Through xcrun, so clang++ gets the macOS SDK (AppKit's headers).
const compile = run('xcrun', [
  'clang++',
  ...ARCHS.flatMap((arch) => ['-arch', arch]),
  '-std=c++17',
  '-ObjC++',
  '-fobjc-arc',
  '-O2',
  '-Wall',
  '-mmacosx-version-min=12.0',
  '-DNAPI_VERSION=8',
  `-I${includeDir}`,
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-Wl,-no_fixup_chains',
  '-framework',
  'AppKit',
  source,
  '-o',
  output,
]);
if (compile.status !== 0) fail('the compile failed', `${compile.stdout}${compile.stderr}`);
if (!universal(output)) fail(`the binary is not universal (${ARCHS.join(' + ')})`);
console.log(`Built native glass: ${output.slice(root.length + 1)}`);
