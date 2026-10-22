// The Studio's composition: everything that turns one source image into the
// framed, padded, shadowed picture that is previewed and exported. Zod-free,
// so the renderer imports these values without bundling zod; `schema.ts`
// validates the same shape in main.
//
// Units are resolution-independent (see ARCHITECTURE.md → "Studio"): W is the
// cropped source width at 1×, H the frame height (cropped source height plus
// the chrome bar) and S = max(W, H). Padding is a fraction of S; radius and
// shadow sizes are fractions of W.

export type FrameStyle = 'browser' | 'minimal' | 'none';
export type FrameTheme = 'dark' | 'light';
export type CanvasRatio = 'original' | '16:9' | '4:3' | '1:1' | '4:5' | '9:16' | 'custom';
export type CropAspect = 'free' | 'original' | '16:9' | '1:1' | '4:5';
export type ShadowStyle = 'none' | 'soft' | 'elevated';
export type GradientPreset = 'blue' | 'violet' | 'lilac' | 'cream' | 'black' | 'sequoia' | 'sonoma' | 'ventura' | 'monterey' | 'aurora' | 'desert';
export type ExportFormat = 'png' | 'jpeg';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceRef {
  mediaId: string;
  width: number;
  height: number;
}

export type Background =
  | { type: 'gradient'; preset: GradientPreset | null; from: string; to: string; angle: number; brightness: number }
  | { type: 'solid'; color: string; brightness: number }
  | { type: 'image'; mediaId: string; blur: number; brightness: number }
  | { type: 'wallpaper'; id: string; blur: number; brightness: number }
  | { type: 'transparent' };

export interface Frame {
  style: FrameStyle;
  theme: FrameTheme;
  /** The decorative address in the browser chrome; it is not a browser. */
  address: string;
  showAddress: boolean;
  showLights: boolean;
  /** Corner radius, a fraction of W. */
  radius: number;
  /** A 1 px (at 1×) hairline around the frame. */
  border: boolean;
}

export interface CanvasSettings {
  ratio: CanvasRatio;
  /** Output size at 1× for `custom`, px. */
  width: number;
  height: number;
}

export interface Padding {
  /** Fractions of S. `linked` uses `x` for both. */
  x: number;
  y: number;
  linked: boolean;
}

export interface Shadow {
  style: ShadowStyle;
  /** The key layer: blur and drop distance as fractions of W, opacity 0–1. */
  blur: number;
  distance: number;
  opacity: number;
}

export interface Output {
  format: ExportFormat;
  scale: 1 | 2;
}

/** One stretch of the source on the timeline, source ms. Clips play back to back. */
export interface Clip {
  startMs: number;
  endMs: number;
}

export type ZoomMode = 'auto' | 'manual';

/** A zoom on the timeline, output ms. `x`/`y` are the focus, fractions of the content. */
export interface ZoomSegment {
  id: string;
  startMs: number;
  endMs: number;
  scale: number;
  mode: ZoomMode;
  x: number;
  y: number;
}

export type SceneMode = 'cameraFull' | 'hideCamera';

/** A camera scene on the timeline, output ms. */
export interface SceneSegment {
  id: string;
  startMs: number;
  endMs: number;
  mode: SceneMode;
}

/** A video source's edit. Present exactly when the source is a video. */
export interface VideoSettings {
  clips: Clip[];
  zooms: ZoomSegment[];
  scenes: SceneSegment[];
  /** Drop the audio from the export (and the preview). */
  muted: boolean;
}

export interface Composition {
  v: 2;
  source: SourceRef;
  /** Fractions of the source. */
  crop: Rect;
  cropAspect: CropAspect;
  frame: Frame;
  canvas: CanvasSettings;
  padding: Padding;
  shadow: Shadow;
  background: Background;
  output: Output;
  video?: VideoSettings;
}

/** What a preset carries: no source, crop, output or video. */
export interface Style {
  frame: Frame;
  canvas: CanvasSettings;
  padding: Padding;
  shadow: Shadow;
  background: Background;
}

/** Output sides are capped here; the Studio warns when it applies. */
export const MAX_OUTPUT_SIDE = 8192;
/** The smallest crop side, source px (or the whole side when the source is smaller). */
export const MIN_CROP_PX = 16;
/** Sources larger than this are not decoded for editing. */
export const MAX_EDIT_PIXELS = 50_000_000;
/** A custom canvas, px at 1×. */
export const CANVAS_LIMITS = { min: 64, max: MAX_OUTPUT_SIDE } as const;
/** An export is imported as media, whose image limit is 20 MB. */
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
/**
 * Video exports fit the 1080p box (1920 × 1080, or 1080 × 1920 upright), at 1×:
 * the class X plays back. X validates dimensions itself when it processes an
 * upload (T9 reports its answer).
 */
export const MAX_VIDEO_OUTPUT = { long: 1920, short: 1080 } as const;
export type VideoResolution = '720p' | '1080p' | '4k';
/** The boxes a video export fits (landscape; an upright canvas swaps them). 1080p is what X plays back. */
export const VIDEO_RESOLUTIONS: Record<VideoResolution, { long: number; short: number; label: string }> = {
  '720p': { long: 1280, short: 720, label: '720p' },
  '1080p': { long: 1920, short: 1080, label: '1080p' },
  '4k': { long: 3840, short: 2160, label: '4K' },
};
/** The shortest clip, or the whole source when it is shorter. */
export const MIN_TRIM_MS = 500;
/** The zoom slider's range. */
export const ZOOM_LIMITS = { min: 1.1, max: 4.5 } as const;

export const RATIOS: Record<Exclude<CanvasRatio, 'original' | 'custom'>, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
};

// ---------------------------------------------------------------- backgrounds

export interface GradientDef {
  label: string;
  /** CSS angle: 0° points up, clockwise. */
  angle: number;
  stops: readonly (readonly [offset: number, color: string])[];
  /** A soft elliptical highlight; position and radii are fractions of the canvas. */
  glow: { color: readonly [number, number, number]; alpha: number; cx: number; cy: number; rx: number; ry: number };
  /** The swatch: a lit sphere, as CSS. */
  swatch: string;
}

/** The curated gradients (the reference's swatches), ported stop for stop from T2's CSS. */
export const GRADIENTS: Record<GradientPreset, GradientDef> = {
  blue: {
    label: 'Blue',
    angle: 112,
    stops: [
      [0, '#8b7df3'],
      [0.38, '#7b8ef6'],
      [0.62, '#6a7ff2'],
      [1, '#5867ec'],
    ],
    glow: { color: [98, 128, 255], alpha: 0.85, cx: 0.88, cy: 0.18, rx: 0.6, ry: 0.9 },
    swatch: 'radial-gradient(circle at 35% 30%, #6f9bff, #2f63f0 60%, #1f47c8)',
  },
  violet: {
    label: 'Violet',
    angle: 115,
    stops: [
      [0, '#6b4fe6'],
      [0.55, '#8e6cf2'],
      [1, '#5a3fd4'],
    ],
    glow: { color: [150, 110, 255], alpha: 0.8, cx: 0.85, cy: 0.15, rx: 0.7, ry: 0.9 },
    swatch: 'radial-gradient(circle at 35% 30%, #a98bff, #6a45ec 60%, #4c2bc4)',
  },
  lilac: {
    label: 'Lilac',
    angle: 115,
    stops: [
      [0, '#c9a6f2'],
      [0.55, '#e3c6fa'],
      [1, '#b48ee6'],
    ],
    glow: { color: [248, 220, 255], alpha: 0.85, cx: 0.85, cy: 0.15, rx: 0.7, ry: 0.9 },
    swatch: 'radial-gradient(circle at 35% 30%, #f0d4ff, #c99af5 60%, #a879dd)',
  },
  cream: {
    label: 'Cream',
    angle: 115,
    stops: [
      [0, '#eadbbd'],
      [0.55, '#f6ecd8'],
      [1, '#e0cda8'],
    ],
    glow: { color: [255, 251, 240], alpha: 0.9, cx: 0.85, cy: 0.15, rx: 0.7, ry: 0.9 },
    swatch: 'radial-gradient(circle at 35% 30%, #fffaf0, #efe1c4 60%, #d8c49c)',
  },
  black: {
    label: 'Black',
    angle: 115,
    stops: [
      [0, '#1c1d21'],
      [0.55, '#2c2e34'],
      [1, '#16171a'],
    ],
    glow: { color: [90, 92, 100], alpha: 0.7, cx: 0.85, cy: 0.15, rx: 0.7, ry: 0.9 },
    swatch: 'radial-gradient(circle at 35% 30%, #5a5c63, #26272c 60%, #121316)',
  },
  sequoia: {
    label: 'Sequoia',
    angle: 135,
    stops: [
      [0, '#e84430'],
      [0.3, '#f06838'],
      [0.6, '#d94080'],
      [1, '#3028a0'],
    ],
    glow: { color: [255, 120, 60], alpha: 0.9, cx: 0.3, cy: 0.2, rx: 0.8, ry: 0.7 },
    swatch: 'radial-gradient(circle at 35% 30%, #ff7844, #e04030 50%, #6020a0)',
  },
  sonoma: {
    label: 'Sonoma',
    angle: 160,
    stops: [
      [0, '#48b060'],
      [0.35, '#3898d0'],
      [0.65, '#d04080'],
      [1, '#f08030'],
    ],
    glow: { color: [80, 200, 120], alpha: 0.85, cx: 0.2, cy: 0.3, rx: 0.6, ry: 0.8 },
    swatch: 'radial-gradient(circle at 30% 35%, #60d880, #3090d0 50%, #d04888)',
  },
  ventura: {
    label: 'Ventura',
    angle: 180,
    stops: [
      [0, '#f09838'],
      [0.4, '#e86040'],
      [0.7, '#d03870'],
      [1, '#3840c8'],
    ],
    glow: { color: [255, 160, 60], alpha: 0.9, cx: 0.5, cy: 0.15, rx: 0.7, ry: 0.5 },
    swatch: 'radial-gradient(circle at 35% 30%, #ffa844, #e06040 50%, #5038c0)',
  },
  monterey: {
    label: 'Monterey',
    angle: 140,
    stops: [
      [0, '#1a0a38'],
      [0.3, '#2818a0'],
      [0.6, '#6048d0'],
      [1, '#c060e0'],
    ],
    glow: { color: [160, 100, 255], alpha: 0.85, cx: 0.7, cy: 0.25, rx: 0.6, ry: 0.8 },
    swatch: 'radial-gradient(circle at 35% 30%, #b080ff, #5030d0 55%, #180840)',
  },
  aurora: {
    label: 'Aurora',
    angle: 170,
    stops: [
      [0, '#0a2848'],
      [0.3, '#106878'],
      [0.6, '#30b880'],
      [1, '#80f0a0'],
    ],
    glow: { color: [60, 220, 140], alpha: 0.85, cx: 0.6, cy: 0.2, rx: 0.7, ry: 0.8 },
    swatch: 'radial-gradient(circle at 35% 30%, #60e8a0, #2090a0 55%, #0a2040)',
  },
  desert: {
    label: 'Desert',
    angle: 150,
    stops: [
      [0, '#e8c070'],
      [0.35, '#d09048'],
      [0.65, '#b86030'],
      [1, '#783820'],
    ],
    glow: { color: [240, 200, 120], alpha: 0.9, cx: 0.3, cy: 0.2, rx: 0.7, ry: 0.7 },
    swatch: 'radial-gradient(circle at 35% 30%, #f0d080, #c88040 55%, #683018)',
  },
};

export const GRADIENT_PRESETS = Object.keys(GRADIENTS) as GradientPreset[];

/** A preset as a background: `from`/`to`/`angle` mirror it for the editor. */
export function gradientBackground(preset: GradientPreset, brightness = DEFAULT_BRIGHTNESS): Background {
  const def = GRADIENTS[preset];
  return { type: 'gradient', preset, from: def.stops[0]![1], to: def.stops.at(-1)![1], angle: def.angle, brightness };
}

/** 0.5 is neutral; T2's slider sat at 0.55. */
export const DEFAULT_BRIGHTNESS = 0.55;

/** The wash over the background: white above 0.5, black below. */
export function brightnessWash(brightness: number): { color: 'white' | 'black'; alpha: number } | null {
  if (brightness > 0.5) return { color: 'white', alpha: (brightness - 0.5) * 0.7 };
  if (brightness < 0.5) return { color: 'black', alpha: (0.5 - brightness) * 0.8 };
  return null;
}

// ---------------------------------------------------------------- shadows

export const SHADOW_COLOR = [16, 18, 40] as const;

type ShadowLayer = { blur: number; distance: number; opacity: number };

/** Each preset is a key layer (what the sliders set) plus a contact layer that follows it. */
export const SHADOWS: Record<Exclude<ShadowStyle, 'none'>, { key: ShadowLayer; contact: ShadowLayer }> = {
  soft: { key: { blur: 0.06, distance: 0.024, opacity: 0.3 }, contact: { blur: 0.01, distance: 0.004, opacity: 0.18 } },
  elevated: { key: { blur: 0.11, distance: 0.05, opacity: 0.42 }, contact: { blur: 0.024, distance: 0.01, opacity: 0.24 } },
};

export function shadowPreset(style: ShadowStyle, current?: Shadow): Shadow {
  if (style === 'none') return { style, blur: current?.blur ?? 0, distance: current?.distance ?? 0, opacity: current?.opacity ?? 0 };
  return { style, ...SHADOWS[style].key };
}

// ---------------------------------------------------------------- chrome

/**
 * The decorative window chrome, as fractions of the frame width W, ported
 * from T2's composition.css. Minimal draws the bar and the lights only.
 */
export const CHROME = {
  height: { browser: 0.0725, minimal: 0.045, none: 0 } satisfies Record<FrameStyle, number>,
  inset: 0.03,
  light: { diameter: 0.0225, gap: 0.015, colors: ['#ff5f57', '#febc2e', '#28c840'] },
  pill: { width: 0.58, height: 0.046, radius: 0.012, font: 0.025, lock: 0.021, gap: 0.009 },
  tool: { size: 0.032, gap: 0.026 },
  font: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif",
  themes: {
    dark: {
      bar: ['#2b2c31', '#222327'],
      hairline: null,
      pill: 'rgba(255,255,255,0.07)',
      text: 'rgba(255,255,255,0.88)',
      icon: 'rgba(255,255,255,0.82)',
      border: 'rgba(255,255,255,0.18)',
    },
    light: {
      bar: ['#f4f5f7', '#e9eaee'],
      hairline: 'rgba(0,0,0,0.08)',
      pill: 'rgba(0,0,0,0.05)',
      text: 'rgba(20,22,30,0.7)',
      icon: 'rgba(20,22,30,0.7)',
      border: 'rgba(0,0,0,0.14)',
    },
  },
} as const;

// ---------------------------------------------------------------- compositions

export const DEFAULT_ADDRESS = 'mytool.app';

export function defaultStyle(): Style {
  return {
    frame: { style: 'browser', theme: 'dark', address: DEFAULT_ADDRESS, showAddress: true, showLights: true, radius: 0.019, border: false },
    canvas: { ratio: '16:9', width: 1920, height: 1080 },
    padding: { x: 0.06, y: 0.06, linked: true },
    shadow: shadowPreset('soft'),
    background: gradientBackground('blue'),
  };
}

/** A new document's composition; a video source (with its duration) also gets the whole clip, with sound. */
export function defaultComposition(source: SourceRef, video?: { durationMs: number }): Composition {
  return {
    v: 2,
    source: { ...source },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    cropAspect: 'original',
    ...defaultStyle(),
    output: { format: 'png', scale: 1 },
    ...(video ? { video: { clips: [{ startMs: 0, endMs: video.durationMs }], zooms: [], scenes: [], muted: false } } : {}),
  };
}

/** The shortest clip a source of `durationMs` allows. */
export function minTrimMs(durationMs: number): number {
  return Math.min(MIN_TRIM_MS, durationMs);
}

/** A stored composition in the current shape: v1's single trim becomes one clip. Anything else passes through for validation. */
export function upgradeComposition(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return raw;
  const { video, ...rest } = raw as Record<string, unknown> & { video?: { trimStartMs: number; trimEndMs: number; muted: boolean } };
  return {
    ...rest,
    v: 2,
    ...(video ? { video: { clips: [{ startMs: video.trimStartMs, endMs: video.trimEndMs }], zooms: [], scenes: [], muted: video.muted } } : {}),
  };
}

/** Just the style fields (a Composition is a Style plus source, crop, output and video). */
export function styleOf(comp: Style): Style {
  const { frame, canvas, padding, shadow, background } = comp;
  return { frame, canvas, padding, shadow, background };
}

export function applyStyle(comp: Composition, style: Style): Composition {
  return { ...comp, ...styleOf(style) };
}

/** The default style; source, crop, output and video stay. */
export function resetStyle(comp: Composition): Composition {
  return applyStyle(comp, defaultStyle());
}

/** The aspect a crop lock asks for, or null for free. */
export function cropAspectRatio(aspect: CropAspect, source: Pick<SourceRef, 'width' | 'height'>): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return source.width / source.height;
  return RATIOS[aspect];
}

/** The largest centred crop of `ratio` (source px aspect) inside the whole source, as fractions. */
export function centredCrop(ratio: number | null, source: Pick<SourceRef, 'width' | 'height'>): Rect {
  if (ratio === null) return { x: 0, y: 0, width: 1, height: 1 };
  const sourceRatio = source.width / source.height;
  if (ratio >= sourceRatio) {
    const height = sourceRatio / ratio;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  const width = ratio / sourceRatio;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

/** Keeps a crop inside the source and at least MIN_CROP_PX a side. */
export function clampCrop(crop: Rect, source: Pick<SourceRef, 'width' | 'height'>): Rect {
  const minW = Math.min(MIN_CROP_PX, source.width) / source.width;
  const minH = Math.min(MIN_CROP_PX, source.height) / source.height;
  const width = Math.min(1, Math.max(minW, crop.width));
  const height = Math.min(1, Math.max(minH, crop.height));
  const x = Math.min(1 - width, Math.max(0, crop.x));
  const y = Math.min(1 - height, Math.max(0, crop.y));
  return { x, y, width, height };
}

/** A new source keeps the style; the crop stays only when the aspect is unchanged. */
export function replaceSource(comp: Composition, source: SourceRef): Composition {
  const before = comp.source.width / comp.source.height;
  const after = source.width / source.height;
  const sameAspect = Math.abs(after - before) / before <= 0.005;
  return {
    ...comp,
    source: { ...source },
    crop: sameAspect ? clampCrop(comp.crop, source) : { x: 0, y: 0, width: 1, height: 1 },
    cropAspect: sameAspect ? comp.cropAspect : 'original',
  };
}

/** JPEG has no alpha and a GIF exports its first frame: both export as PNG. */
export function effectiveFormat(comp: Composition, sourceIsGif: boolean): ExportFormat {
  if (comp.background.type === 'transparent' || sourceIsGif) return 'png';
  return comp.output.format;
}

/** The cropped source size and the frame around it, at 1×. */
export function frameSize(comp: Composition): { cropWidth: number; cropHeight: number; chrome: number; width: number; height: number } {
  const cropWidth = comp.crop.width * comp.source.width;
  const cropHeight = comp.crop.height * comp.source.height;
  const chrome = CHROME.height[comp.frame.style] * cropWidth;
  return { cropWidth, cropHeight, chrome, width: cropWidth, height: cropHeight + chrome };
}

/** The frame plus its padding at 1×. */
export function paddedSize(comp: Composition): { width: number; height: number } {
  const frame = frameSize(comp);
  const side = Math.max(frame.width, frame.height);
  const padX = comp.padding.x * side;
  const padY = (comp.padding.linked ? comp.padding.x : comp.padding.y) * side;
  return { width: frame.width + 2 * padX, height: frame.height + 2 * padY };
}

/** The output size at 1×, before rounding and the cap. */
export function outputSize(comp: Composition): { width: number; height: number } {
  const padded = paddedSize(comp);
  const { ratio } = comp.canvas;
  if (ratio === 'custom') return { width: comp.canvas.width, height: comp.canvas.height };
  if (ratio === 'original') return padded;
  const r = RATIOS[ratio];
  return padded.width / padded.height > r ? { width: padded.width, height: padded.width / r } : { width: padded.height * r, height: padded.height };
}
