// Preview mode's sample content (`pnpm preview:ui`, `--preview`, XBOT_PREVIEW=1).
// Main seeds it into a fresh preview userData (src/main/preview/seed.ts), from
// the fixtures in resources/fixtures/; the app then runs its normal code paths
// on it. Nothing here reads the clock, so captures are deterministic. Pure and
// zod-free, so main and the renderer can both import it.
import { defaultComposition, type Composition, type SourceRef } from './composition/model';
import type { IdeaClaim, IdeaKind, IdeaSource } from './contracts/projects';

/** The fixtures, by file name, in resources/fixtures/ (packaged: Contents/Resources/fixtures/). */
export const PREVIEW_FIXTURES = {
  screenshot: 'my-tiny-tool.png',
  /** The screenshot rendered through the Studio with `previewThumbnailComposition` (`pnpm fixtures`). */
  framed: 'my-tiny-tool-framed.png',
  /** 12 s of the screenshot with a moving cursor (`pnpm fixtures`). */
  video: 'my-tiny-tool.mp4',
} as const;

/** The current draft: the reference's text, with the framed screenshot. */
export const PREVIEW_DRAFT_TEXT = 'Built a tiny tool because I was tired of doing this manually. Here’s how it works.';

/** The older draft in history, with the video (X takes a video only on its own). */
export const PREVIEW_VIDEO_DRAFT_TEXT = 'Quick demo of the tiny tool: the boring part now takes one click.';

/** The Ideas popover's one stored idea, labelled as a sample. */
export const PREVIEW_IDEA: { kind: IdeaKind; text: string; sources: IdeaSource[]; claims: IdeaClaim[] } = {
  kind: 'demo',
  text: 'Show the before and after: the steps I used to do by hand, then the one click that does them now.',
  sources: [{ kind: 'note', label: 'Preview sample' }],
  claims: [],
};

/** The sample clip's trim on the Studio timeline: the reference's 0.13–0.71 of 12 s. */
export const PREVIEW_VIDEO_TRIM = { trimStartMs: 1560, trimEndMs: 8520 } as const;

/** The Studio's look in the reference: output 1920 × 1080, a little padding. A video source keeps the sample trim. */
export function previewStudioComposition(source: SourceRef, video?: { durationMs: number }): Composition {
  const base = defaultComposition(source, video);
  return {
    ...base,
    canvas: { ratio: 'custom', width: 1920, height: 1080 },
    padding: { x: 0.04, y: 0.04, linked: true },
    ...(base.video && video
      ? { video: { ...base.video, trimStartMs: Math.min(PREVIEW_VIDEO_TRIM.trimStartMs, video.durationMs), trimEndMs: Math.min(PREVIEW_VIDEO_TRIM.trimEndMs, video.durationMs) } }
      : {}),
  };
}

/** The composer card's framed screenshot: the same look, shaped like the 154 × 100 card. */
export function previewThumbnailComposition(source: SourceRef): Composition {
  return {
    ...previewStudioComposition(source),
    canvas: { ratio: 'custom', width: 1540, height: 1000 },
    padding: { x: 0.1, y: 0.1, linked: true },
  };
}
