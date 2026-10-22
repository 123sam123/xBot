// Renders resources/tray.svg into the macOS template PNGs the tray loads:
// trayTemplate.png (18×18) and trayTemplate@2x.png (36×36). Run `pnpm icons`
// after editing the SVG and commit the PNGs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const svg = readFileSync(join(resources, 'tray.svg'));

for (const [file, width] of [
  ['trayTemplate.png', 18],
  ['trayTemplate@2x.png', 36],
]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(join(resources, file), png);
  console.log(`wrote resources/${file} (${width}×${width})`);
}
