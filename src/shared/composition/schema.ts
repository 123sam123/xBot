import { z } from 'zod';
import { CANVAS_LIMITS, MIN_CROP_PX, upgradeComposition, ZOOM_LIMITS, type Composition, type Style } from './model';

// The composition as main validates it: every stored document, every save and
// every export. Main and the studio contract import this; the renderer never
// does (ESLint), so zod stays out of its bundle.

/** Float slack for crops that come out of pointer maths. */
const EPSILON = 1e-6;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const fraction = z.number().min(0).max(1);
const side = z.number().int().min(1).max(16_384);

const frameSchema = z.strictObject({
  style: z.enum(['browser', 'minimal', 'none']),
  theme: z.enum(['dark', 'light']),
  address: z.string().max(120),
  showAddress: z.boolean(),
  showLights: z.boolean(),
  radius: z.number().min(0).max(0.08),
  border: z.boolean(),
});

const canvasSchema = z.strictObject({
  ratio: z.enum(['original', '16:9', '4:3', '1:1', '4:5', '9:16', 'custom']),
  width: z.number().int().min(CANVAS_LIMITS.min).max(CANVAS_LIMITS.max),
  height: z.number().int().min(CANVAS_LIMITS.min).max(CANVAS_LIMITS.max),
});

const paddingSchema = z.strictObject({
  x: z.number().min(0).max(0.5),
  y: z.number().min(0).max(0.5),
  linked: z.boolean(),
});

const shadowSchema = z.strictObject({
  style: z.enum(['none', 'soft', 'elevated']),
  blur: z.number().min(0).max(0.25),
  distance: z.number().min(0).max(0.25),
  opacity: fraction,
});

const backgroundSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('gradient'),
    preset: z.enum(['blue', 'violet', 'lilac', 'cream', 'black', 'sequoia', 'sonoma', 'ventura', 'monterey', 'aurora', 'desert']).nullable(),
    from: hex,
    to: hex,
    angle: z.number().min(0).max(360),
    brightness: fraction,
  }),
  z.strictObject({ type: z.literal('solid'), color: hex, brightness: fraction }),
  z.strictObject({ type: z.literal('image'), mediaId: z.uuid(), blur: z.number().min(0).max(0.1), brightness: fraction }),
  z.strictObject({ type: z.literal('wallpaper'), id: z.string().regex(/^[a-z0-9-]{1,64}$/), blur: z.number().min(0).max(0.1), brightness: fraction }),
  z.strictObject({ type: z.literal('transparent') }),
]);

export const styleSchema = z.strictObject({
  frame: frameSchema,
  canvas: canvasSchema,
  padding: paddingSchema,
  shadow: shadowSchema,
  background: backgroundSchema,
});

const ms = z.number().int().min(0);
const segmentId = z.string().min(1).max(64);

const videoSchema = z
  .strictObject({
    clips: z.array(z.strictObject({ startMs: ms, endMs: ms })).min(1).max(500),
    zooms: z
      .array(
        z.strictObject({
          id: segmentId,
          startMs: ms,
          endMs: ms,
          scale: z.number().min(1).max(ZOOM_LIMITS.max),
          mode: z.enum(['auto', 'manual']),
          x: fraction,
          y: fraction,
        }),
      )
      .max(500),
    scenes: z.array(z.strictObject({ id: segmentId, startMs: ms, endMs: ms, mode: z.enum(['cameraFull', 'hideCamera']) })).max(500),
    muted: z.boolean(),
  })
  .superRefine(({ clips, zooms, scenes }, ctx) => {
    if (clips.some((clip) => clip.endMs <= clip.startMs)) {
      ctx.addIssue({ code: 'custom', path: ['clips'], message: 'A clip must end after it starts.' });
    }
    for (const [name, track] of [['zooms', zooms], ['scenes', scenes]] as const) {
      const sorted = [...track].sort((a, b) => a.startMs - b.startMs);
      if (sorted.some((segment, i) => segment.endMs <= segment.startMs || (i > 0 && segment.startMs < sorted[i - 1]!.endMs))) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'Segments must not overlap.' });
      }
    }
  });

const currentCompositionSchema = z
  .strictObject({
    v: z.literal(2),
    source: z.strictObject({ mediaId: z.uuid(), width: side, height: side }),
    crop: z.strictObject({ x: fraction, y: fraction, width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) }),
    cropAspect: z.enum(['free', 'original', '16:9', '1:1', '4:5']),
    frame: frameSchema,
    canvas: canvasSchema,
    padding: paddingSchema,
    shadow: shadowSchema,
    background: backgroundSchema,
    output: z.strictObject({ format: z.enum(['png', 'jpeg']), scale: z.union([z.literal(1), z.literal(2)]) }),
    video: videoSchema.optional(),
  })
  .superRefine(({ crop, source }, ctx) => {
    if (crop.x + crop.width > 1 + EPSILON || crop.y + crop.height > 1 + EPSILON) {
      ctx.addIssue({ code: 'custom', path: ['crop'], message: 'The crop must stay inside the source.' });
    }
    const minW = Math.min(MIN_CROP_PX, source.width);
    const minH = Math.min(MIN_CROP_PX, source.height);
    if (crop.width * source.width < minW - EPSILON || crop.height * source.height < minH - EPSILON) {
      ctx.addIssue({ code: 'custom', path: ['crop'], message: `The crop must be at least ${MIN_CROP_PX} px a side.` });
    }
  });

/** Stored v1 compositions are upgraded before they are checked. */
export const compositionSchema = z.preprocess(upgradeComposition, currentCompositionSchema);

// Compile time: the schemas and model.ts's hand-written types stay identical.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type SchemaMatchesModel = [
  Assert<Equals<z.infer<typeof compositionSchema>, Composition>>,
  Assert<Equals<z.infer<typeof styleSchema>, Style>>,
];
