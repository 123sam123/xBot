import { zoomedSourceCrop, type Layout } from '../../../shared/composition/layout';
import { brightnessWash, CHROME, GRADIENTS, SHADOW_COLOR, type Composition, type GradientDef, type Rect, type SceneMode } from '../../../shared/composition/model';
import type { ZoomState } from '../../../shared/composition/timeline';
import { cursorAt, type LoadedCursor } from './cursor';

// The one draw routine behind the Studio preview and every export: images,
// and each frame of a video (the preview draws the playing <video>, the MP4
// export each decoded frame). It draws only the composition, in output px
// straight from `computeLayout`: no transform is ever applied while a shadow
// is set (canvas shadows ignore the transform), and the source is drawn with
// one uniform scale, through the zoom at that moment.

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawOptions {
  /** A video's current frame; images draw `assets.source`. */
  frame?: CanvasImageSource | null;
  /** The zoom at this moment (none by default). */
  zoom?: ZoomState;
  /** Recording time of the frame, ms: where the cursor is. */
  sourceMs?: number;
  /** The camera's frame at this moment, for a recording with a camera. */
  camera?: CanvasImageSource | null;
  /** A scene segment at this moment: the camera alone, or no camera. */
  scene?: SceneMode | null;
}

export interface CompositionAssets {
  /** The decoded source image; until it loads, the frame is drawn empty. A video's frames come through `DrawOptions.frame`. */
  source: ImageBitmap | null;
  /** The decoded background image or wallpaper; without it the background falls back to the default gradient. */
  background: ImageBitmap | null;
  /** A recording's cursor track and images. */
  cursor?: LoadedCursor | null;
}

// The 24-unit icon paths from design-system/icons.tsx, drawn as vectors.
const ICONS = {
  share: 'M12 3.5v11M8 7.5l4-4 4 4M7 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1',
  plus: 'M12 5v14M5 12h14',
  tabs: 'M10.5 8h7A2.5 2.5 0 0 1 20 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 8 17.5v-7A2.5 2.5 0 0 1 10.5 8zM16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8',
  lockBody: 'M7.5 10.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
  lockShackle: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
} as const;
const ICON_STROKE = 1.75;

const paths = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = paths.get(d);
  if (!p) {
    p = new Path2D(d);
    paths.set(d, p);
  }
  return p;
}

const rgba = ([r, g, b]: readonly [number, number, number], alpha: number) => `rgba(${r},${g},${b},${alpha})`;

export function drawComposition(ctx: Ctx2D, comp: Composition, layout: Layout, assets: CompositionAssets, options: DrawOptions = {}): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layout.canvas.width, layout.canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawBackground(ctx, comp, layout, assets);
  if (options.scene === 'cameraFull' && options.camera && comp.camera) {
    drawCameraFull(ctx, comp, layout, options.camera);
    ctx.restore();
    return;
  }
  drawShadows(ctx, layout);
  drawFrame(ctx, comp, layout, assets, options);
  if (options.scene !== 'hideCamera') drawCamera(ctx, comp, layout, options.camera ?? null);
  ctx.restore();
}

/** A "camera only" scene: the camera fills the framed area, cover-fitted. */
function drawCameraFull(ctx: Ctx2D, comp: Composition, layout: Layout, frame: CanvasImageSource): void {
  const box = layout.frame;
  const source = frame as CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const fw = source.videoWidth || (source.width as number) || 1;
  const fh = source.videoHeight || (source.height as number) || 1;
  const scale = Math.max(box.width / fw, box.height / fh);
  const sw = box.width / scale;
  const sh = box.height / scale;
  drawShadows(ctx, layout);
  ctx.save();
  roundRect(ctx, box, layout.radius);
  ctx.clip();
  if (comp.camera?.mirror) {
    ctx.translate(box.x + box.width, box.y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame, (fw - sw) / 2, (fh - sh) / 2, sw, sh, 0, 0, box.width, box.height);
  } else {
    ctx.drawImage(frame, (fw - sw) / 2, (fh - sh) / 2, sw, sh, box.x, box.y, box.width, box.height);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- background

/** A CSS `linear-gradient(<angle>deg, …)` over the whole canvas. */
function linearGradient(ctx: Ctx2D, width: number, height: number, angle: number, stops: GradientDef['stops']): void {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  const gradient = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** A CSS `radial-gradient(rx ry at cx cy, color, transparent 70%)`; the end stop is the same colour at alpha 0. */
function glow(ctx: Ctx2D, width: number, height: number, def: GradientDef['glow']): void {
  const rx = def.rx * width;
  const ry = def.ry * height;
  ctx.save();
  ctx.translate(def.cx * width, def.cy * height);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(def.color, def.alpha));
  gradient.addColorStop(0.7, rgba(def.color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-(def.cx * width) / rx, -(def.cy * height) / ry, width / rx, height / ry);
  ctx.restore();
}

// The last blurred background, per bitmap: re-blurring on every slider frame is the expensive part.
const blurred = new WeakMap<ImageBitmap, { key: string; canvas: OffscreenCanvas }>();

function backgroundImage(image: ImageBitmap, width: number, height: number, blur: number): CanvasImageSource {
  const key = `${width}x${height}@${blur}`;
  const hit = blurred.get(image);
  if (hit?.key === key) return hit.canvas;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  // Cover-fit with one uniform scale, overdrawn by twice the blur so the edges stay opaque.
  const bleed = blur * 2;
  const scale = Math.max((width + 2 * bleed) / image.width, (height + 2 * bleed) / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.imageSmoothingQuality = 'high';
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  blurred.set(image, { key, canvas });
  return canvas;
}

function drawBackground(ctx: Ctx2D, comp: Composition, layout: Layout, assets: CompositionAssets): void {
  const { width, height } = layout.canvas;
  const bg = comp.background;
  if (bg.type === 'transparent') return;
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, width, height);
  } else if ((bg.type === 'image' || bg.type === 'wallpaper') && assets.background) {
    // An opaque base, so an image with alpha never turns black in a JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(backgroundImage(assets.background, width, height, layout.backgroundBlur), 0, 0);
  } else {
    const preset = bg.type === 'gradient' ? bg.preset : 'blue';
    if (preset) {
      const def = GRADIENTS[preset];
      linearGradient(ctx, width, height, def.angle, def.stops);
      glow(ctx, width, height, def.glow);
    } else if (bg.type === 'gradient') {
      linearGradient(ctx, width, height, bg.angle, [
        [0, bg.from],
        [1, bg.to],
      ]);
    }
  }
  const wash = brightnessWash(bg.brightness);
  if (wash) {
    ctx.fillStyle = wash.color === 'white' ? `rgba(255,255,255,${wash.alpha})` : `rgba(0,0,0,${wash.alpha})`;
    ctx.fillRect(0, 0, width, height);
  }
}

// ---------------------------------------------------------------- frame

function roundRect(ctx: Ctx2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, Math.max(0, radius));
}

/**
 * Only the shadow lands on the canvas: the shape itself is drawn one canvas
 * width off to the left and the shadow is offset back, so nothing opaque is
 * left under a transparent background.
 */
function drawShadows(ctx: Ctx2D, layout: Layout): void {
  const away = layout.canvas.width + layout.frame.width + 1000;
  for (const layer of layout.shadows) {
    if (layer.opacity <= 0) continue;
    ctx.save();
    ctx.shadowColor = rgba(SHADOW_COLOR, layer.opacity);
    ctx.shadowBlur = layer.blur;
    ctx.shadowOffsetX = away;
    ctx.shadowOffsetY = layer.offsetY;
    ctx.fillStyle = '#000';
    roundRect(ctx, { ...layout.frame, x: layout.frame.x - away }, layout.radius);
    ctx.fill();
    ctx.restore();
  }
}

function drawFrame(ctx: Ctx2D, comp: Composition, layout: Layout, assets: CompositionAssets, options: DrawOptions): void {
  const { frame, content, sourceCrop } = layout;
  const theme = CHROME.themes[comp.frame.theme];
  ctx.save();
  roundRect(ctx, frame, layout.radius);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
  drawChrome(ctx, comp, layout);
  const image = options.frame ?? assets.source;
  const shown = options.zoom ? zoomedSourceCrop(sourceCrop, options.zoom) : sourceCrop;
  if (image) ctx.drawImage(image, shown.x, shown.y, shown.width, shown.height, content.x, content.y, content.width, content.height);
  if (assets.cursor && comp.cursor?.show && options.sourceMs !== undefined) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(content.x, content.y, content.width, content.height);
    ctx.clip();
    drawCursor(ctx, comp, layout, assets.cursor, shown, options.sourceMs);
    ctx.restore();
  }
  ctx.restore();

  if (layout.border > 0) {
    const half = layout.border / 2;
    ctx.save();
    ctx.lineWidth = layout.border;
    ctx.strokeStyle = theme.border;
    roundRect(ctx, { x: frame.x + half, y: frame.y + half, width: frame.width - layout.border, height: frame.height - layout.border }, layout.radius - half);
    ctx.stroke();
    ctx.restore();
  }
}

/** The recorded cursor where it was, through the same crop and zoom as the picture. */
function drawCursor(ctx: Ctx2D, comp: Composition, layout: Layout, cursor: LoadedCursor, shown: Rect, ms: number): void {
  const point = cursorAt(cursor.track, ms);
  if (!point) return;
  const image = cursor.images.get(point.cursor) ?? cursor.images.values().next().value;
  if (!image) return;
  const { content } = layout;
  const k = content.width / shown.width;
  const px = point.x * comp.source.width;
  const py = point.y * comp.source.height;
  const x = content.x + (px - shown.x) * k;
  const y = content.y + (py - shown.y) * k;
  const scale = comp.source.width * k * (comp.cursor?.size ?? 1);
  const { info, bitmap } = image;
  if (comp.cursor?.type === 'circle') {
    // A touch point: about the arrow's height across, centred on the hotspot.
    const r = (info.height * scale) / 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    return;
  }
  ctx.drawImage(bitmap, x - info.hotX * scale, y - info.hotY * scale, info.width * scale, info.height * scale);
}

/** The camera bubble: a cover-fitted square of the camera in a corner or edge of the canvas. */
function drawCamera(ctx: Ctx2D, comp: Composition, layout: Layout, frame: CanvasImageSource | null): void {
  const camera = comp.camera;
  if (!camera || camera.hidden || !frame) return;
  const { width, height } = layout.canvas;
  const shortSide = Math.min(width, height);
  const size = camera.size * shortSide;
  const margin = 0.035 * shortSide;
  const [row, col] = camera.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const x = col === 'left' ? margin : col === 'right' ? width - margin - size : (width - size) / 2;
  const y = row === 'top' ? margin : height - margin - size;
  const radius = camera.shape === 'circle' ? size / 2 : camera.shape === 'rounded' ? size * 0.22 : size * 0.06;

  const source = frame as CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const fw = source.videoWidth || (source.width as number) || 1;
  const fh = source.videoHeight || (source.height as number) || 1;
  const side = Math.min(fw, fh);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.03;
  ctx.fillStyle = '#000';
  roundRect(ctx, { x, y, width: size, height: size }, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, { x, y, width: size, height: size }, radius);
  ctx.clip();
  if (camera.mirror) {
    ctx.translate(x + size, y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame, (fw - side) / 2, (fh - side) / 2, side, side, 0, 0, size, size);
  } else {
    ctx.drawImage(frame, (fw - side) / 2, (fh - side) / 2, side, side, x, y, size, size);
  }
  ctx.restore();
}

function drawIcon(ctx: Ctx2D, box: Rect, d: string, color: string, fill = false): void {
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(box.width / 24, box.height / 24);
  if (fill) {
    ctx.fillStyle = color;
    ctx.fill(path(d));
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = ICON_STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path(d));
  }
  ctx.restore();
}

/** The longest prefix of `text` that fits `max` px, with an ellipsis when cut. */
function fitText(ctx: Ctx2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

function drawChrome(ctx: Ctx2D, comp: Composition, layout: Layout): void {
  const { chrome } = layout;
  if (!chrome) return;
  const theme = CHROME.themes[comp.frame.theme];
  const bar = ctx.createLinearGradient(0, chrome.y, 0, chrome.y + chrome.height);
  bar.addColorStop(0, theme.bar[0]);
  bar.addColorStop(1, theme.bar[1]);
  ctx.fillStyle = bar;
  ctx.fillRect(chrome.x, chrome.y, chrome.width, chrome.height);
  if (theme.hairline) {
    ctx.fillStyle = theme.hairline;
    ctx.fillRect(chrome.x, chrome.y + chrome.height - layout.scale, chrome.width, layout.scale);
  }

  layout.lights.forEach((light, index) => {
    ctx.fillStyle = CHROME.light.colors[index]!;
    ctx.beginPath();
    ctx.arc(light.cx, light.cy, light.r, 0, Math.PI * 2);
    ctx.fill();
  });

  const { address } = layout;
  if (address) {
    const { pill } = address;
    ctx.fillStyle = theme.pill;
    roundRect(ctx, pill, address.radius);
    ctx.fill();

    ctx.font = `500 ${address.fontSize}px ${CHROME.font}`;
    ctx.letterSpacing = `${address.fontSize * 0.01}px`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const text = fitText(ctx, comp.frame.address.trim(), pill.width - address.lockSize - address.gap - pill.height);
    const textWidth = text ? ctx.measureText(text).width : 0;
    const group = address.lockSize + (text ? address.gap + textWidth : 0);
    const left = pill.x + (pill.width - group) / 2;
    const cy = pill.y + pill.height / 2;
    const lock = { x: left, y: cy - address.lockSize / 2, width: address.lockSize, height: address.lockSize };
    drawIcon(ctx, lock, ICONS.lockBody, theme.text, true);
    drawIcon(ctx, lock, ICONS.lockShackle, theme.text);
    if (text) {
      ctx.fillStyle = theme.text;
      ctx.fillText(text, left + address.lockSize + address.gap, cy);
    }
    ctx.letterSpacing = '0px';
  }

  const icons = [ICONS.share, ICONS.plus, ICONS.tabs];
  layout.tools.forEach((box, index) => drawIcon(ctx, box, icons[index]!, theme.icon));
}
