import { CHROME, frameSize, MAX_OUTPUT_SIDE, MAX_VIDEO_OUTPUT, outputSize, paddedSize, SHADOWS, type Composition, type Rect } from './model';

// The one geometry the preview and the export share. Pure and zod-free: the
// renderer draws with it and main checks an export's size against it.

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface ShadowLayer {
  blur: number;
  offsetY: number;
  opacity: number;
}

export interface AddressLayout {
  pill: Rect;
  radius: number;
  fontSize: number;
  lockSize: number;
  /** Between the lock and the text; draw centres lock + gap + text in the pill. */
  gap: number;
}

export interface Layout {
  /** Output px per 1× px after the cap. */
  scale: number;
  /** True when the requested size was scaled down to `maxSide`. */
  capped: boolean;
  canvas: { width: number; height: number };
  /** The framed picture: chrome plus content. */
  frame: Rect;
  chrome: Rect | null;
  content: Rect;
  /** The part of the source shown, in source px. */
  sourceCrop: Rect;
  lights: Circle[];
  address: AddressLayout | null;
  /** Share, new tab and tabs icon boxes, left to right. */
  tools: Rect[];
  radius: number;
  border: number;
  /** Key layer first; empty for no shadow. */
  shadows: ShadowLayer[];
  backgroundBlur: number;
}

export interface LayoutOptions {
  /** Output px per 1× px (1 or 2 for exports; zoom × devicePixelRatio for the preview). */
  scale: number;
  maxSide?: number;
  /** A cap on the shorter side too (video's 1080p box). */
  maxShortSide?: number;
}

/** To the nearest even number: H.264's 4:2:0 frames need even sides. */
const roundEven = (value: number) => 2 * Math.round(value / 2);

/**
 * Lays out `comp` at `scale`. Every length is in output px. The padded frame
 * is fitted uniformly into the integer canvas and centred, so the content
 * keeps the crop's aspect exactly: the source is never distorted. A video's
 * canvas has even sides.
 */
export function computeLayout(comp: Composition, { scale, maxSide = MAX_OUTPUT_SIDE, maxShortSide }: LayoutOptions): Layout {
  const { source, crop, frame: frameStyle } = comp;
  const sourceCrop = { x: crop.x * source.width, y: crop.y * source.height, width: crop.width * source.width, height: crop.height * source.height };
  const sizes = frameSize(comp);
  const padded = paddedSize(comp);
  const out = outputSize(comp);

  let effective = scale;
  let capped = false;
  const longest = Math.max(out.width, out.height) * scale;
  if (longest > maxSide) {
    effective = (scale * maxSide) / longest;
    capped = true;
  }
  const shortest = Math.min(out.width, out.height) * effective;
  if (maxShortSide !== undefined && shortest > maxShortSide) {
    effective = (effective * maxShortSide) / shortest;
    capped = true;
  }
  const video = comp.video !== undefined;
  const side = (length: number, cap: number) => {
    const rounded = video ? Math.max(2, roundEven(length)) : Math.max(1, Math.round(length));
    return Math.min(video ? cap - (cap % 2) : cap, rounded);
  };
  const landscape = out.width >= out.height;
  const shortCap = maxShortSide ?? maxSide;
  const canvas = {
    width: side(out.width * effective, landscape ? maxSide : shortCap),
    height: side(out.height * effective, landscape ? shortCap : maxSide),
  };

  // px per 1× px for the picture itself (equals `effective` unless the canvas is custom).
  const k = Math.min(canvas.width / padded.width, canvas.height / padded.height);
  const frame: Rect = {
    x: (canvas.width - sizes.width * k) / 2,
    y: (canvas.height - sizes.height * k) / 2,
    width: sizes.width * k,
    height: sizes.height * k,
  };
  const chromeHeight = sizes.chrome * k;
  const chrome = chromeHeight > 0 ? { x: frame.x, y: frame.y, width: frame.width, height: chromeHeight } : null;
  const content: Rect = { x: frame.x, y: frame.y + chromeHeight, width: sizes.cropWidth * k, height: sizes.cropHeight * k };

  // Chrome parts, in fractions of the frame width.
  const w = frame.width;
  const lights: Circle[] = [];
  const tools: Rect[] = [];
  let address: AddressLayout | null = null;
  if (chrome) {
    const cy = chrome.y + chrome.height / 2;
    if (frameStyle.showLights) {
      const r = (CHROME.light.diameter * w) / 2;
      for (let i = 0; i < 3; i++) {
        lights.push({ cx: chrome.x + CHROME.inset * w + r + i * (CHROME.light.diameter + CHROME.light.gap) * w, cy, r });
      }
    }
    if (frameStyle.style === 'browser') {
      if (frameStyle.showAddress) {
        const pill = { width: CHROME.pill.width * w, height: CHROME.pill.height * w };
        address = {
          pill: { x: chrome.x + (chrome.width - pill.width) / 2, y: cy - pill.height / 2, ...pill },
          radius: CHROME.pill.radius * w,
          fontSize: CHROME.pill.font * w,
          lockSize: CHROME.pill.lock * w,
          gap: CHROME.pill.gap * w,
        };
      }
      const size = CHROME.tool.size * w;
      const gap = CHROME.tool.gap * w;
      const first = chrome.x + chrome.width - CHROME.inset * w - 3 * size - 2 * gap;
      for (let i = 0; i < 3; i++) tools.push({ x: first + i * (size + gap), y: cy - size / 2, width: size, height: size });
    }
  }

  const shadows: ShadowLayer[] = [];
  if (comp.shadow.style !== 'none') {
    const { key, contact } = SHADOWS[comp.shadow.style];
    const ratio = (part: 'blur' | 'distance' | 'opacity') => (key[part] === 0 ? 0 : contact[part] / key[part]);
    shadows.push({ blur: comp.shadow.blur * w, offsetY: comp.shadow.distance * w, opacity: comp.shadow.opacity });
    shadows.push({
      blur: comp.shadow.blur * ratio('blur') * w,
      offsetY: comp.shadow.distance * ratio('distance') * w,
      opacity: comp.shadow.opacity * ratio('opacity'),
    });
  }

  return {
    scale: effective,
    capped,
    canvas,
    frame,
    chrome,
    content,
    sourceCrop,
    lights,
    address,
    tools,
    radius: Math.min(comp.frame.radius * w, frame.width / 2, frame.height / 2),
    border: comp.frame.border ? effective : 0,
    shadows,
    backgroundBlur: comp.background.type === 'image' ? comp.background.blur * Math.min(canvas.width, canvas.height) : 0,
  };
}

/**
 * The layout an export renders: images at their 1× / 2× scale (capped at
 * MAX_OUTPUT_SIDE), video at 1× inside the 1080p box. The footer, the Output
 * popover, the renderers and main's checks all use this one.
 */
export function exportLayout(comp: Composition): Layout {
  if (comp.video) return computeLayout(comp, { scale: 1, maxSide: MAX_VIDEO_OUTPUT.long, maxShortSide: MAX_VIDEO_OUTPUT.short });
  return computeLayout(comp, { scale: comp.output.scale });
}

export interface VideoPlacement {
  /** Where the scaled video goes on the canvas: the content rect rounded outward, inside the canvas. */
  box: Rect;
  /** The part of the (display-oriented) source shown, whole source px, inside the source. */
  crop: Rect;
}

/** Float slack, so an edge at 1919.9999999 doesn't spill into an extra pixel. */
const EDGE_EPSILON = 1e-6;

/**
 * How FFmpeg places a video in `layout`: whole pixels only. The box covers the
 * anti-aliased hole the frame layer leaves, so no pad colour shows at its edge.
 */
export function videoPlacement(layout: Layout, source: { width: number; height: number }): VideoPlacement {
  const { content, canvas, sourceCrop } = layout;
  const x0 = Math.max(0, Math.floor(content.x + EDGE_EPSILON));
  const y0 = Math.max(0, Math.floor(content.y + EDGE_EPSILON));
  const x1 = Math.min(canvas.width, Math.ceil(content.x + content.width - EDGE_EPSILON));
  const y1 = Math.min(canvas.height, Math.ceil(content.y + content.height - EDGE_EPSILON));

  const cropX = Math.min(source.width - 1, Math.max(0, Math.round(sourceCrop.x)));
  const cropY = Math.min(source.height - 1, Math.max(0, Math.round(sourceCrop.y)));
  return {
    box: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) },
    crop: {
      x: cropX,
      y: cropY,
      width: Math.max(1, Math.min(Math.round(sourceCrop.width), source.width - cropX)),
      height: Math.max(1, Math.min(Math.round(sourceCrop.height), source.height - cropY)),
    },
  };
}
