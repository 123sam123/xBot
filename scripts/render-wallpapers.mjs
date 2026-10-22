// Renders xBot's bundled Studio wallpapers: original, procedurally drawn
// designs (no third-party imagery) in the Studio's Wallpaper categories.
// Each is an SVG rendered by resvg at 3840×2160, then written as a q85 JPEG
// with a 384 px thumbnail by macOS `sips`. Output: resources/wallpapers/
// (<id>.jpg, thumbs/<id>.jpg, manifest.json). Run with `pnpm wallpapers`;
// the results are committed, so builds never need to run it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'resources', 'wallpapers');
const W = 3840;
const H = 2160;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grain = (opacity) => `
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="${opacity}"/>`;

const svg = (defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;

const linear = (id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

/** Sweeping layered ribbons with soft shadows between them. */
function waves({ bg, ribbons, seed }) {
  const r = rng(seed);
  let defs = linear('bg', bg, 0, 0, 1, 1);
  defs += `<filter id="shade" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="-30" stdDeviation="60" flood-color="#000" flood-opacity="0.35"/></filter>`;
  defs += `<filter id="soft"><feGaussianBlur stdDeviation="220"/></filter>`;
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  body += `<ellipse cx="${W * (0.2 + r() * 0.6)}" cy="${H * 0.15}" rx="${W * 0.45}" ry="${H * 0.35}" fill="${ribbons[0][0]}" opacity="0.55" filter="url(#soft)"/>`;
  ribbons.forEach(([a, b], i) => {
    defs += linear(`r${i}`, [a, b], 0, 0, 1, 0.4);
    const base = H * (0.3 + (i / ribbons.length) * 0.75);
    const amp = H * (0.12 + r() * 0.12);
    const p = (f) => base + Math.sin(f * Math.PI * 2 + i * 1.3 + seed) * amp;
    const d = `M -300 ${p(0)} C ${W * 0.25} ${p(0.25) - amp}, ${W * 0.55} ${p(0.55) + amp}, ${W + 300} ${p(1)} L ${W + 300} ${H + 300} L -300 ${H + 300} Z`;
    body += `<path d="${d}" fill="url(#r${i})" filter="url(#shade)"/>`;
  });
  return svg(defs, body + grain(0.05));
}

/** Overlapping petals fanned from a point below the frame. */
function petals({ bg, colors, seed, cx = 0.5, count = 9 }) {
  const r = rng(seed);
  let defs = linear('bg', bg, 0, 0, 0, 1);
  defs += `<filter id="shade" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="50" flood-color="#000" flood-opacity="0.4"/></filter>`;
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  const px = W * cx;
  const py = H * 1.25;
  for (let i = 0; i < count; i++) {
    const [a, b] = colors[i % colors.length];
    defs += `<linearGradient id="p${i}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient>`;
    const angle = -80 + (160 * i) / (count - 1) + (r() - 0.5) * 8;
    const len = H * (1.15 + r() * 0.35);
    const wid = W * (0.11 + r() * 0.05);
    body += `<g transform="translate(${px} ${py}) rotate(${angle})"><ellipse cx="0" cy="${-len / 2}" rx="${wid}" ry="${len / 2}" fill="url(#p${i})" filter="url(#shade)"/></g>`;
  }
  return svg(defs, body + grain(0.04));
}

/** Large blurred colour fields over a base: an aurora mesh. */
function aurora({ base, blobs, seed }) {
  const r = rng(seed);
  let defs = `<filter id="blur" filterUnits="userSpaceOnUse" x="${-W}" y="${-H}" width="${3 * W}" height="${3 * H}"><feGaussianBlur stdDeviation="320"/></filter>`;
  let body = `<rect width="${W}" height="${H}" fill="${base}"/><g filter="url(#blur)">`;
  for (const color of blobs) {
    body += `<ellipse cx="${W * r()}" cy="${H * r()}" rx="${W * (0.22 + r() * 0.2)}" ry="${H * (0.25 + r() * 0.25)}" fill="${color}" opacity="${0.75 + r() * 0.25}"/>`;
  }
  body += '</g>';
  return svg(defs, body + grain(0.06));
}

/** Curved bands sweeping across a dark field, lit along one edge. */
function bands({ base, colors, seed }) {
  const r = rng(seed);
  let defs = `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="40"/></filter>`;
  let body = `<rect width="${W}" height="${H}" fill="${base}"/>`;
  colors.forEach(([a, b], i) => {
    defs += linear(`b${i}`, [a, b], 0, 0, 1, 1);
    const x0 = W * (0.05 + i * 0.16 + r() * 0.05);
    const d = `M ${x0} -200 C ${x0 + W * 0.35} ${H * 0.3}, ${x0 - W * 0.15} ${H * 0.7}, ${x0 + W * 0.45} ${H + 200}`;
    const width = W * (0.07 + r() * 0.06);
    body += `<path d="${d}" stroke="url(#b${i})" stroke-width="${width}" fill="none" stroke-linecap="round" opacity="0.95"/>`;
    body += `<path d="${d}" stroke="${a}" stroke-width="${width * 0.12}" fill="none" stroke-linecap="round" opacity="0.6" filter="url(#glow)" transform="translate(${-width * 0.4} 0)"/>`;
  });
  return svg(defs, body + grain(0.05));
}

/** Layered rolling hills under a sky gradient. */
function dunes({ sky, layers, seed }) {
  const r = rng(seed);
  let defs = linear('sky', sky, 0, 0, 0, 1);
  defs += `<filter id="haze"><feGaussianBlur stdDeviation="6"/></filter>`;
  let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  layers.forEach(([a, b], i) => {
    defs += linear(`d${i}`, [a, b], 0, 0, 0, 1);
    const y = H * (0.42 + i * 0.13);
    const amp = H * (0.05 + r() * 0.06);
    const k = 1 + r() * 1.5;
    let d = `M 0 ${H}`;
    for (let x = 0; x <= W; x += W / 48) d += ` L ${x} ${y - Math.sin((x / W) * Math.PI * k + i * 2 + seed) * amp}`;
    d += ` L ${W} ${H} Z`;
    body += `<path d="${d}" fill="url(#d${i})" filter="url(#haze)"/>`;
  });
  return svg(defs, body + grain(0.04));
}

const WALLPAPERS = [
  // macOS: bright, layered, system-like.
  { id: 'macos-tide', name: 'Tide', category: 'macOS', draw: () => waves({ seed: 1, bg: ['#2b5cd8', '#7a3fd0'], ribbons: [['#5fb8ff', '#3a6df0'], ['#2ee6c8', '#1b9df0'], ['#86f0a8', '#2cc4a0'], ['#c6f78a', '#4fd27a']] }) },
  { id: 'macos-bloom', name: 'Bloom', category: 'macOS', draw: () => petals({ seed: 2, bg: ['#ffcf7a', '#ff6a3d'], colors: [['#ffb347', '#ff5e2b'], ['#ff8a3d', '#e8341f'], ['#ffd26b', '#ff7a2f']] }) },
  { id: 'macos-meadow', name: 'Meadow', category: 'macOS', draw: () => dunes({ seed: 3, sky: ['#9fd3ff', '#f4f0d0'], layers: [['#8fd17a', '#5aa85a'], ['#4caf6a', '#2f8a52'], ['#2f8a52', '#1d6a3f'], ['#1d6a3f', '#0f4a2c']] }) },
  { id: 'macos-sunrise', name: 'Sunrise', category: 'macOS', draw: () => waves({ seed: 4, bg: ['#ffb36b', '#ff4f7a'], ribbons: [['#ffd36b', '#ff8f3d'], ['#ff7a59', '#ff3d6e'], ['#c44bd8', '#7a3fe0'], ['#5a4bf0', '#2b3fd0']] }) },
  { id: 'macos-glow', name: 'Glow', category: 'macOS', draw: () => aurora({ seed: 5, base: '#1d2a8a', blobs: ['#ff6ad5', '#5ac8ff', '#7cf0b0', '#8a5cff', '#ffb35a'] }) },

  // Dark.
  { id: 'dark-carbon', name: 'Carbon', category: 'Dark', draw: () => bands({ seed: 11, base: '#08090c', colors: [['#3a3f4b', '#121418'], ['#e9ecf2', '#3b4150'], ['#2a6cff', '#0b1a4a'], ['#1b1d23', '#05060a']] }) },
  { id: 'dark-ember', name: 'Ember', category: 'Dark', draw: () => bands({ seed: 12, base: '#050506', colors: [['#ff7a3a', '#3a0a04'], ['#2a2a30', '#0a0a0c'], ['#ffd0a0', '#a83a1a'], ['#1a1a1e', '#050506']] }) },
  { id: 'dark-midnight', name: 'Midnight', category: 'Dark', draw: () => waves({ seed: 13, bg: ['#05060c', '#141a33'], ribbons: [['#1a2350', '#0b0f24'], ['#26306a', '#10153a'], ['#334090', '#141a48'], ['#0e1230', '#05060c']] }) },
  { id: 'dark-onyx', name: 'Onyx', category: 'Dark', draw: () => petals({ seed: 14, bg: ['#121318', '#030304'], colors: [['#3a3d48', '#101116'], ['#26282f', '#08090c'], ['#4a4e5c', '#15171d']] }) },
  { id: 'dark-ridge', name: 'Ridge', category: 'Dark', draw: () => dunes({ seed: 15, sky: ['#0b1020', '#2a2f45'], layers: [['#262b3d', '#1a1e2c'], ['#1a1e2c', '#11141e'], ['#11141e', '#0a0c13'], ['#0a0c13', '#040509']] }) },

  // Blue.
  { id: 'blue-lagoon', name: 'Lagoon', category: 'Blue', draw: () => waves({ seed: 21, bg: ['#0a2a6a', '#0a6aa8'], ribbons: [['#3ad0ff', '#0a7ad8'], ['#1aa8f0', '#0a4ab8'], ['#0a7ad8', '#082a8a'], ['#5ae0ff', '#1a90e0']] }) },
  { id: 'blue-arc', name: 'Arc', category: 'Blue', draw: () => bands({ seed: 22, base: '#020818', colors: [['#4aa8ff', '#0a2a7a'], ['#ffffff', '#5a8aff'], ['#1a5aff', '#020a3a'], ['#8ac8ff', '#1a3aa8']] }) },
  { id: 'blue-frost', name: 'Frost', category: 'Blue', draw: () => aurora({ seed: 23, base: '#2a6aff', blobs: ['#9ad8ff', '#ffffff', '#1a3ad8', '#5ae0ff', '#0a2a9a'] }) },
  { id: 'blue-iris', name: 'Iris', category: 'Blue', draw: () => petals({ seed: 24, bg: ['#7ac0ff', '#1a3ab8'], colors: [['#5ab0ff', '#1a4ad8'], ['#8ad0ff', '#2a6af0'], ['#3a8aff', '#0a2a9a']] }) },
  { id: 'blue-depths', name: 'Depths', category: 'Blue', draw: () => dunes({ seed: 25, sky: ['#5ab8ff', '#0a3a8a'], layers: [['#1a6ad8', '#0a4aa8'], ['#0a4aa8', '#08347a'], ['#08347a', '#06204e'], ['#06204e', '#030f2a']] }) },

  // Purple.
  { id: 'purple-nebula', name: 'Nebula', category: 'Purple', draw: () => aurora({ seed: 31, base: '#14062e', blobs: ['#8a2be2', '#ff4fd8', '#3a1a8a', '#5a8aff', '#c05aff'] }) },
  { id: 'purple-orchid', name: 'Orchid', category: 'Purple', draw: () => petals({ seed: 32, bg: ['#e0a8ff', '#5a1ab8'], colors: [['#c88aff', '#7a2ad8'], ['#f0a8ff', '#a83ad8'], ['#9a5aff', '#4a1aa8']] }) },
  { id: 'purple-velvet', name: 'Velvet', category: 'Purple', draw: () => waves({ seed: 33, bg: ['#2a0a5a', '#7a1a8a'], ribbons: [['#a85aff', '#5a1ad8'], ['#ff6ad5', '#a82ab8'], ['#7a3aff', '#3a1a9a'], ['#d88aff', '#8a3ad8']] }) },
  { id: 'purple-prism', name: 'Prism', category: 'Purple', draw: () => bands({ seed: 34, base: '#0c0418', colors: [['#c05aff', '#3a0a6a'], ['#ff8ae0', '#8a2ab8'], ['#6a4aff', '#1a0a4a'], ['#f0d0ff', '#8a5ad8']] }) },
  { id: 'purple-dusk', name: 'Dusk', category: 'Purple', draw: () => dunes({ seed: 35, sky: ['#ff9ad0', '#5a2aa8'], layers: [['#8a4ad8', '#6a2ab8'], ['#6a2ab8', '#4a1a8a'], ['#4a1a8a', '#2e0e5e'], ['#2e0e5e', '#160628']] }) },

  // Warm.
  { id: 'warm-desert', name: 'Desert', category: 'Warm', draw: () => dunes({ seed: 41, sky: ['#ffd8a0', '#ff9a5a'], layers: [['#f0a860', '#d8803a'], ['#d8803a', '#b8602a'], ['#b8602a', '#8a401a'], ['#8a401a', '#5a2a10']] }) },
  { id: 'warm-coral', name: 'Coral', category: 'Warm', draw: () => waves({ seed: 42, bg: ['#ff8a5a', '#ff3a6a'], ribbons: [['#ffb07a', '#ff6a4a'], ['#ff7a8a', '#e83a5a'], ['#ffd07a', '#ff8a3a'], ['#ff5a7a', '#c82a5a']] }) },
  { id: 'warm-marigold', name: 'Marigold', category: 'Warm', draw: () => petals({ seed: 43, bg: ['#fff0b0', '#ffb030'], colors: [['#ffd04a', '#ff9a1a'], ['#ffb03a', '#f0700a'], ['#ffe07a', '#ffb02a']] }) },
  { id: 'warm-solar', name: 'Solar', category: 'Warm', draw: () => aurora({ seed: 44, base: '#3a0a08', blobs: ['#ff6a1a', '#ffc04a', '#e8341a', '#ff8a5a', '#8a1a1a'] }) },
  { id: 'warm-copper', name: 'Copper', category: 'Warm', draw: () => bands({ seed: 45, base: '#140804', colors: [['#ffb07a', '#6a2a0a'], ['#fff0d8', '#d8803a'], ['#d8602a', '#3a1004'], ['#ffd0a0', '#a8501a']] }) },
];

function sips(args) {
  const result = spawnSync('sips', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`sips ${args.join(' ')} failed: ${result.stderr}`);
}

if (process.platform !== 'darwin') {
  console.error('render-wallpapers needs macOS (sips).');
  process.exit(1);
}

const only = process.argv.slice(2);
if (only.length === 0) rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'thumbs'), { recursive: true });
const scratch = join(tmpdir(), `xbot-wallpapers-${process.pid}`);
mkdirSync(scratch, { recursive: true });

const manifest = [];
for (const wallpaper of WALLPAPERS) {
  manifest.push({ id: wallpaper.id, name: wallpaper.name, category: wallpaper.category });
  if (only.length > 0 && !only.includes(wallpaper.id)) continue;
  const started = Date.now();
  const png = new Resvg(wallpaper.draw(), { fitTo: { mode: 'original' } }).render().asPng();
  const pngPath = join(scratch, `${wallpaper.id}.png`);
  writeFileSync(pngPath, png);
  sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', pngPath, '--out', join(out, `${wallpaper.id}.jpg`)]);
  sips(['-Z', '384', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', pngPath, '--out', join(out, 'thumbs', `${wallpaper.id}.jpg`)]);
  console.log(`${wallpaper.id} (${Date.now() - started} ms)`);
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(scratch, { recursive: true, force: true });
