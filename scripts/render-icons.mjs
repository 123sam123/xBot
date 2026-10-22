// Renders xBot's icons from their SVG sources. Run `pnpm icons` after editing
// an SVG and commit the PNGs:
// - resources/tray.svg → the macOS template PNGs the tray loads:
//   trayTemplate.png (18×18) and trayTemplate@2x.png (36×36);
// - resources/icon.svg → build/icon.png (1024×1024), which electron-builder
//   turns into the app's .icns.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ICONS = [
  { svg: 'resources/tray.svg', png: 'resources/trayTemplate.png', width: 18 },
  { svg: 'resources/tray.svg', png: 'resources/trayTemplate@2x.png', width: 36 },
  { svg: 'resources/icon.svg', png: 'build/icon.png', width: 1024 },
];

for (const { svg, png, width } of ICONS) {
  const rendered = new Resvg(readFileSync(join(root, svg)), { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' }).render().asPng();
  mkdirSync(dirname(join(root, png)), { recursive: true });
  writeFileSync(join(root, png), rendered);
  console.log(`wrote ${png} (${width}×${width})`);
}
