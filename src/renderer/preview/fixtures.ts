// Preview mode's fixed sample content (`--preview` / XBOT_PREVIEW=1). Nothing
// here is shown outside preview mode, and nothing reads the clock, so captures
// are deterministic. T2 created this; T10 (XBOT-1DDYA1) extends it.
import myTinyToolPng from '../../../resources/fixtures/my-tiny-tool.png';
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

export const PREVIEW_OUTPUT = { width: 1920, height: 1080 };

/** The sample clip on the Studio timeline: seconds, and trim as fractions of the duration. */
export const PREVIEW_CLIP = {
  duration: 12,
  current: 4,
  trim: [0.13, 0.71] as [number, number],
  frames: Array.from({ length: 9 }, () => myTinyToolPng),
};

export const PREVIEW_ZOOM = 75;
