// Builds xBot's native addons (see docs/ARCHITECTURE.md → "Native material"
// and "Recording"):
//   native/glass/glass.mm     → native/glass/build/glass.node     (AppKit)
//   native/capture/capture.mm → native/capture/build/capture.node (ScreenCaptureKit, AVFoundation)
// Runs from `postinstall`, `dev`, `build` and `package`, and as `pnpm native`.
//
// One universal (arm64 + x86_64) clang++ call per addon against Node-API's C
// headers: Node-API is ABI-stable, so there is no Electron headers download
// and no node-gyp or Python. An addon is skipped while its binary is newer
// than its source and this script.
//
// Without the Xcode Command Line Tools (or off macOS) it prints one line and
// exits 0: xBot then runs with the system's glass and without recording.
// `--strict` (used by `pnpm package`) exits 1 on macOS unless every addon has
// a fresh universal binary.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const strict = process.argv.includes('--strict');
const ARCHS = ['arm64', 'x86_64'];

const ADDONS = [
  {
    name: 'glass',
    what: "xBot will run with the system's glass",
    min: '12.0',
    frameworks: ['AppKit'],
    weak: [],
  },
  {
    name: 'capture',
    what: 'screen recording will be unavailable',
    // ScreenCaptureKit is weak-linked: the addon loads on macOS 12, and recording checks for 13+ at runtime.
    min: '12.3',
    frameworks: ['AppKit', 'AVFoundation', 'CoreMedia', 'CoreVideo', 'QuartzCore', 'CoreGraphics'],
    weak: ['ScreenCaptureKit'],
  },
];

if (process.platform !== 'darwin') {
  console.log('Native addons are macOS-only: not building them.');
  process.exit(0);
}

let failed = false;
function fail(addon, reason, detail) {
  if (detail) console.error(detail.trim());
  console.error(`xBot: native ${addon.name} not built (${reason}); ${addon.what} (see README → "Native addons").`);
  failed = true;
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function universal(file) {
  const lipo = run('xcrun', ['lipo', '-archs', file]);
  const archs = lipo.status === 0 ? lipo.stdout.trim().split(/\s+/) : [];
  return ARCHS.every((arch) => archs.includes(arch));
}

function toolsReady() {
  // `xcode-select -p` fails quietly without the tools, where the /usr/bin/xcrun
  // stub would open the "install developer tools" dialog. DEVELOPER_DIR makes
  // it print any path, so the directory must also exist.
  const developerDir = run('xcode-select', ['-p']);
  if (developerDir.status !== 0 || !existsSync(developerDir.stdout.trim())) return 'no Xcode Command Line Tools; install them with `xcode-select --install`';
  if (run('xcrun', ['--find', 'clang++']).status !== 0) return 'xcrun cannot find clang++';
  return null;
}

let includeDir = null;
let tools;

for (const addon of ADDONS) {
  const source = join(root, 'native', addon.name, `${addon.name}.mm`);
  const output = join(root, 'native', addon.name, 'build', `${addon.name}.node`);
  const upToDate = existsSync(output) && [source, script].every((file) => statSync(output).mtimeMs > statSync(file).mtimeMs);
  if (upToDate && !strict) continue;

  tools ??= toolsReady() ?? 'ok';
  if (tools !== 'ok') {
    fail(addon, tools);
    continue;
  }
  if (upToDate && universal(output)) continue;
  try {
    includeDir ??= createRequire(import.meta.url)('node-api-headers').include_dir;
  } catch {
    fail(addon, 'the node-api-headers dev dependency is missing; run `pnpm install`');
    continue;
  }

  mkdirSync(dirname(output), { recursive: true });
  // Through xcrun, so clang++ gets the macOS SDK.
  const compile = run('xcrun', [
    'clang++',
    ...ARCHS.flatMap((arch) => ['-arch', arch]),
    '-std=c++17',
    '-ObjC++',
    '-fobjc-arc',
    '-O2',
    '-Wall',
    `-mmacosx-version-min=${addon.min}`,
    '-DNAPI_VERSION=8',
    `-I${includeDir}`,
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-Wl,-no_fixup_chains',
    ...addon.frameworks.flatMap((framework) => ['-framework', framework]),
    ...addon.weak.flatMap((framework) => ['-weak_framework', framework]),
    source,
    '-o',
    output,
  ]);
  if (compile.status !== 0) {
    fail(addon, 'the compile failed', `${compile.stdout}${compile.stderr}`);
    continue;
  }
  if (!universal(output)) {
    fail(addon, `the binary is not universal (${ARCHS.join(' + ')})`);
    continue;
  }
  console.log(`Built native ${addon.name}: ${output.slice(root.length + 1)}`);
}

process.exit(failed && strict ? 1 : 0);
