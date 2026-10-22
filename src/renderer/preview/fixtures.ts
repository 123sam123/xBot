// Preview mode's fixed sample content (`--preview` / XBOT_PREVIEW=1). Nothing
// here is shown outside preview mode, and nothing reads the clock, so captures
// are deterministic. T2 created this; T10 (XBOT-1DDYA1) extends it.
import myTinyToolPng from '../../../resources/fixtures/my-tiny-tool.png';
import { defaultComposition, type Composition } from '../../shared/composition/model';
import type { MediaItem } from '../../shared/contracts/media';
import type { CompositionSource } from '../common/CompositionPreview';

export const PREVIEW_HANDLE = '@samuelbuilds';

export const PREVIEW_DRAFT_TEXT = 'Built a tiny tool because I was tired of doing this manually. Here’s how it works.';

export const PREVIEW_REMINDER_LABEL = 'Next reminder in 30 min';

/** "My tiny tool", rendered from scripts/fixtures/my-tiny-tool.html by `pnpm fixtures`. */
export const PREVIEW_SOURCE: CompositionSource = {
  url: myTinyToolPng,
  width: 1440,
  height: 800,
  alt: 'Sample screenshot of “My tiny tool”',
};

/** A fixed id for the sample, so the Studio's media map and bitmap cache treat it like real media. */
export const PREVIEW_MEDIA_ID = '00000000-0000-4000-8000-000000000001';

export const PREVIEW_MEDIA: MediaItem = {
  id: PREVIEW_MEDIA_ID,
  kind: 'image',
  mime: 'image/png',
  width: PREVIEW_SOURCE.width,
  height: PREVIEW_SOURCE.height,
  durationMs: null,
  bytes: 0,
  name: 'my-tiny-tool.png',
  url: PREVIEW_SOURCE.url,
  thumbUrl: null,
};

export const PREVIEW_OUTPUT = { width: 1920, height: 1080 };

/** The Studio's sample composition: the reference's framing, output 1920 × 1080. */
export const PREVIEW_COMPOSITION: Composition = {
  ...defaultComposition({ mediaId: PREVIEW_MEDIA_ID, width: PREVIEW_SOURCE.width, height: PREVIEW_SOURCE.height }),
  canvas: { ratio: 'custom', ...PREVIEW_OUTPUT },
  padding: { x: 0.04, y: 0.04, linked: true },
};

/** The composer's sample thumbnail: the same look, shaped like the 154 × 100 card. */
export const PREVIEW_THUMBNAIL_COMPOSITION: Composition = {
  ...PREVIEW_COMPOSITION,
  canvas: { ratio: 'custom', width: 1540, height: 1000 },
  padding: { x: 0.1, y: 0.1, linked: true },
};

/** The sample clip on the Studio timeline: seconds, and trim as fractions of the duration. */
export const PREVIEW_CLIP = {
  duration: 12,
  current: 4,
  trim: [0.13, 0.71] as [number, number],
  frames: Array.from({ length: 7 }, () => myTinyToolPng),
};

export const PREVIEW_ZOOM = 75;
