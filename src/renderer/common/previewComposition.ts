// The Studio's composition, as the preview renders it. A renderer-local
// placeholder: T4 (XBOT-1N58PP) replaces it with the shared composition model
// in src/shared and keeps CompositionPreview's props additive.

export type BackgroundId = 'blue' | 'violet' | 'lilac' | 'cream' | 'graphite';
export type FrameStyle = 'browser' | 'minimal' | 'none';
export type FrameTheme = 'dark' | 'light';
export type ShadowLevel = 'none' | 'soft' | 'elevated';
export type CropAspect = 'original' | '16:9' | '1:1' | '4:5';

export interface PreviewComposition {
  background: BackgroundId;
  /** 0–1: how light the background is, around its preset. */
  backgroundLight: number;
  frame: { style: FrameStyle; theme: FrameTheme; address: string };
  /** 0–0.3: space around the framed media, as a fraction of the canvas height. */
  padding: number;
  shadow: ShadowLevel;
  crop: CropAspect;
}

export const DEFAULT_COMPOSITION: PreviewComposition = {
  background: 'blue',
  backgroundLight: 0.55,
  frame: { style: 'browser', theme: 'dark', address: 'mytool.app' },
  padding: 0.058,
  shadow: 'soft',
  crop: 'original',
};

/** The swatch for each background (a lit sphere), and the canvas paint it stands for. */
export const BACKGROUNDS: Record<BackgroundId, { label: string; swatch: string; canvas: string }> = {
  blue: {
    label: 'Blue',
    swatch: 'radial-gradient(circle at 35% 30%, #6f9bff, #2f63f0 60%, #1f47c8)',
    canvas:
      'radial-gradient(60% 90% at 88% 18%, rgb(98 128 255 / 0.85), transparent 70%), linear-gradient(112deg, #8b7df3 0%, #7b8ef6 38%, #6a7ff2 62%, #5867ec 100%)',
  },
  violet: {
    label: 'Violet',
    swatch: 'radial-gradient(circle at 35% 30%, #a98bff, #6a45ec 60%, #4c2bc4)',
    canvas: 'radial-gradient(70% 90% at 85% 15%, rgb(150 110 255 / 0.8), transparent 70%), linear-gradient(115deg, #6b4fe6, #8e6cf2 55%, #5a3fd4)',
  },
  lilac: {
    label: 'Lilac',
    swatch: 'radial-gradient(circle at 35% 30%, #f0d4ff, #c99af5 60%, #a879dd)',
    canvas: 'radial-gradient(70% 90% at 85% 15%, rgb(248 220 255 / 0.85), transparent 70%), linear-gradient(115deg, #c9a6f2, #e3c6fa 55%, #b48ee6)',
  },
  cream: {
    label: 'Cream',
    swatch: 'radial-gradient(circle at 35% 30%, #fffaf0, #efe1c4 60%, #d8c49c)',
    canvas: 'radial-gradient(70% 90% at 85% 15%, rgb(255 251 240 / 0.9), transparent 70%), linear-gradient(115deg, #eadbbd, #f6ecd8 55%, #e0cda8)',
  },
  graphite: {
    label: 'Graphite',
    swatch: 'radial-gradient(circle at 35% 30%, #5a5c63, #26272c 60%, #121316)',
    canvas: 'radial-gradient(70% 90% at 85% 15%, rgb(90 92 100 / 0.7), transparent 70%), linear-gradient(115deg, #1c1d21, #2c2e34 55%, #16171a)',
  },
};

export const BACKGROUND_IDS = Object.keys(BACKGROUNDS) as BackgroundId[];

export const CROP_ASPECTS: Record<CropAspect, number | null> = {
  original: null,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
};

/** Browser chrome height as a fraction of the frame's width, per frame style. */
export const CHROME_RATIO: Record<FrameStyle, number> = { browser: 0.0725, minimal: 0.045, none: 0 };
