import { zoomedSourceCrop, type Layout } from '../../../shared/composition/layout';
import { brightnessWash, CHROME, GRADIENTS, SHADOW_COLOR, type Composition, type GradientDef, type Rect } from '../../../shared/composition/model';
import type { SceneState, ZoomState } from '../../../shared/composition/timeline';
import { cursorFrame, focusAt } from '../../../shared/recording/motion';
import type { LoadedCursor } from './cursor';

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
  /** A scene segment at this moment (camera only, or no camera) and how far it has eased in. */
  scene?: SceneState | null;
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
  drawShadows(ctx, layout);
  drawFrame(ctx, comp, layout, assets, options);
  drawCamera(ctx, comp, layout, options.camera ?? null, options.scene ?? null);
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
  let zoom = options.zoom;
  // An automatic zoom looks where the cursor is (through a slow spring), in fractions of the crop.
  if (zoom && zoom.mode === 'auto' && zoom.scale > 1 && assets.cursor && options.sourceMs !== undefined) {
    const focus = focusAt(assets.cursor.motion, options.sourceMs);
    zoom = { ...zoom, x: (focus.x - comp.crop.x) / comp.crop.width, y: (focus.y - comp.crop.y) / comp.crop.height };
  }
  const shown = zoom ? zoomedSourceCrop(sourceCrop, zoom) : sourceCrop;
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

/** The recorded cursor, as the cursor settings draw it, through the same crop and zoom as the picture. */
function drawCursor(ctx: Ctx2D, comp: Composition, layout: Layout, cursor: LoadedCursor, shown: Rect, ms: number): void {
  const settings = comp.cursor;
  if (!settings) return;
  const frame = cursorFrame(cursor.motion, ms, settings);
  if (!frame) return;
  const image = cursor.images.get(frame.cursor) ?? cursor.images.values().next().value;
  if (!image) return;
  const { content } = layout;
  const k = content.width / shown.width;
  const place = (fx: number, fy: number) => ({ x: content.x + (fx * comp.source.width - shown.x) * k, y: content.y + (fy * comp.source.height - shown.y) * k });
  const scale = comp.source.width * k * settings.size;
  const { info, bitmap } = image;
  const height = info.height * scale;

  for (const ripple of frame.ripples) {
    const at = place(ripple.x, ripple.y);
    const eased = 1 - (1 - ripple.progress) ** 3;
    ctx.save();
    ctx.globalAlpha = (1 - ripple.progress) * 0.85;
    ctx.beginPath();
    ctx.arc(at.x, at.y, height * (0.35 + 1.1 * eased), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, height * 0.07);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.restore();
  }
  if (frame.opacity <= 0) return;

  const at = place(frame.x, frame.y);
  ctx.save();
  ctx.globalAlpha = frame.opacity;
  ctx.translate(at.x, at.y);
  ctx.rotate(frame.rotation);
  ctx.scale(frame.scale, frame.scale);
  if (settings.type === 'circle') {
    // A touch point: about the arrow's height across, centred on the hotspot.
    const r = height / 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = height * 0.18;
    ctx.shadowOffsetY = height * 0.06;
    ctx.drawImage(bitmap, -info.hotX * scale, -info.hotY * scale, info.width * scale, height);
  }
  ctx.restore();
}

/** Where the camera bubble sits, and its corner radius. */
function bubble(comp: Composition, layout: Layout): { rect: Rect; radius: number } {
  const camera = comp.camera!;
  const { width, height } = layout.canvas;
  const shortSide = Math.min(width, height);
  const size = camera.size * shortSide;
  const margin = 0.035 * shortSide;
  const [row, col] = camera.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const x = col === 'left' ? margin : col === 'right' ? width - margin - size : (width - size) / 2;
  const y = row === 'top' ? margin : height - margin - size;
  const radius = camera.shape === 'circle' ? size / 2 : camera.shape === 'rounded' ? size * 0.22 : size * 0.06;
  return { rect: { x, y, width: size, height: size }, radius };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * The camera: the bubble, or for a scene on its way to "camera only" a rect
 * growing from the bubble to the whole frame, or for "hide camera" a bubble
 * shrinking away. The camera is cover-fitted into whichever rect it fills.
 */
function drawCamera(ctx: Ctx2D, comp: Composition, layout: Layout, frame: CanvasImageSource | null, scene: SceneState | null): void {
  const camera = comp.camera;
  if (!camera || !frame) return;
  const full = scene?.mode === 'cameraFull' ? scene.amount : 0;
  const hide = scene?.mode === 'hideCamera' ? scene.amount : camera.hidden ? 1 : 0;
  if (camera.hidden && full === 0) return;
  if (hide >= 1) return;

  const start = bubble(comp, layout);
  const target = layout.frame;
  let rect: Rect = {
    x: lerp(start.rect.x, target.x, full),
    y: lerp(start.rect.y, target.y, full),
    width: lerp(start.rect.width, target.width, full),
    height: lerp(start.rect.height, target.height, full),
  };
  let radius = lerp(start.radius, layout.radius, full);
  if (hide > 0) {
    const k = 1 - 0.35 * hide;
    rect = { x: rect.x + (rect.width * (1 - k)) / 2, y: rect.y + (rect.height * (1 - k)) / 2, width: rect.width * k, height: rect.height * k };
    radius *= k;
  }

  const source = frame as CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const fw = source.videoWidth || (source.width as number) || 1;
  const fh = source.videoHeight || (source.height as number) || 1;
  const scale = Math.max(rect.width / fw, rect.height / fh);
  const sw = rect.width / scale;
  const sh = rect.height / scale;

  ctx.save();
  ctx.globalAlpha = 1 - hide;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = Math.min(rect.width, rect.height) * 0.12;
  ctx.shadowOffsetY = Math.min(rect.width, rect.height) * 0.03;
  ctx.fillStyle = '#000';
  roundRect(ctx, rect, radius);
  ctx.fill();
  ctx.restore();
  roundRect(ctx, rect, radius);
  ctx.clip();
  if (camera.mirror) {
    ctx.translate(rect.x + rect.width, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame, (fw - sw) / 2, (fh - sh) / 2, sw, sh, 0, 0, rect.width, rect.height);
  } else {
    ctx.drawImage(frame, (fw - sw) / 2, (fh - sh) / 2, sw, sh, rect.x, rect.y, rect.width, rect.height);
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
