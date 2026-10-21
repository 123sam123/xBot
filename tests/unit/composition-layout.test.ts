import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/shared/composition/layout';
import { defaultComposition, type CanvasRatio, type Composition, type FrameStyle, type Rect } from '../../src/shared/composition/model';

// SPEC §16 "Do not distort source media": one geometry serves the preview and
// the export, and whatever the ratio, padding, frame or crop, the content
// keeps the crop's aspect. Hand-computed sizes pin the rules themselves.

const SOURCE = { mediaId: '00000000-0000-4000-8000-000000000001', width: 800, height: 600 };

function comp(patch: Partial<Composition> = {}): Composition {
  const base = defaultComposition(SOURCE);
  return {
    ...base,
    padding: { x: 0.05, y: 0.05, linked: true },
    canvas: { ratio: 'original', width: 1920, height: 1080 },
    ...patch,
  };
}

const aspect = (r: Pick<Rect, 'width' | 'height'>) => r.width / r.height;

function expectRect(actual: Rect | null, expected: Rect): void {
  expect(actual).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(actual![key]).toBeCloseTo(expected[key], 9);
}

describe('computeLayout output size', () => {
  // 800×600 source, browser chrome 0.0725 × 800 = 58 → frame 800×658; S = 800, padding 5 % → 40 px.
  it.each<[CanvasRatio, number, number]>([
    ['original', 880, 738],
    ['16:9', 1312, 738],
    ['1:1', 880, 880],
    ['4:5', 880, 1100],
  ])('%s → %i×%i at 1×', (ratio, width, height) => {
    const layout = computeLayout(comp({ canvas: { ratio, width: 1920, height: 1080 } }), { scale: 1 });
    expect(layout.canvas).toEqual({ width, height });
    expect(layout.capped).toBe(false);
  });

  it('custom uses the chosen size and fits the padded frame inside it', () => {
    const layout = computeLayout(comp({ canvas: { ratio: 'custom', width: 640, height: 400 } }), { scale: 1 });
    expect(layout.canvas).toEqual({ width: 640, height: 400 });
    const k = 400 / 738; // height-bound
    expect(layout.frame.height).toBeCloseTo(658 * k, 9);
    expect(layout.frame.y).toBeCloseTo(40 * k, 9);
    expect(layout.frame.x + layout.frame.width / 2).toBeCloseTo(320, 9); // centred
  });

  it('2× doubles every length', () => {
    const one = computeLayout(comp(), { scale: 1 });
    const two = computeLayout(comp(), { scale: 2 });
    expect(two.canvas).toEqual({ width: 1760, height: 1476 });
    expect(two.content.width).toBeCloseTo(one.content.width * 2, 9);
    expect(two.radius).toBeCloseTo(one.radius * 2, 9);
  });

  it('caps the longest side at 8192 px, uniformly', () => {
    const huge = { ...SOURCE, width: 6000, height: 4000 };
    const layout = computeLayout(comp({ source: huge, padding: { x: 0, y: 0, linked: true } }), { scale: 2 });
    expect(layout.capped).toBe(true);
    expect(layout.canvas.width).toBe(8192);
    expect(layout.canvas.height).toBe(Math.round((4000 + 0.0725 * 6000) * (8192 / 6000)));
    expect(aspect(layout.content)).toBeCloseTo(6000 / 4000, 9);
  });
});

describe('computeLayout frame and padding', () => {
  it('places the browser chrome above the content', () => {
    const layout = computeLayout(comp(), { scale: 1 });
    expectRect(layout.frame, { x: 40, y: 40, width: 800, height: 658 });
    expectRect(layout.chrome, { x: 40, y: 40, width: 800, height: 58 });
    expectRect(layout.content, { x: 40, y: 98, width: 800, height: 600 });
    expect(layout.lights).toHaveLength(3);
    expect(layout.address?.pill.width).toBeCloseTo(0.58 * 800, 9);
    expect(layout.tools).toHaveLength(3);
  });

  it('minimal keeps a thinner bar with the lights only; none has no chrome', () => {
    const minimal = computeLayout(comp({ frame: { ...comp().frame, style: 'minimal' } }), { scale: 1 });
    expect(minimal.chrome?.height).toBeCloseTo(36, 9);
    expect(minimal.lights).toHaveLength(3);
    expect(minimal.address).toBeNull();
    expect(minimal.tools).toHaveLength(0);

    const none = computeLayout(comp({ frame: { ...comp().frame, style: 'none' } }), { scale: 1 });
    expect(none.chrome).toBeNull();
    expect(none.lights).toHaveLength(0);
    expect(none.canvas).toEqual({ width: 880, height: 680 });
  });

  it('hides the address and the lights on request', () => {
    const layout = computeLayout(comp({ frame: { ...comp().frame, showAddress: false, showLights: false } }), { scale: 1 });
    expect(layout.address).toBeNull();
    expect(layout.lights).toHaveLength(0);
    expect(layout.chrome?.height).toBeCloseTo(58, 9);
  });

  it('separate padding: x and y are fractions of the longer frame side', () => {
    const layout = computeLayout(comp({ padding: { x: 0.1, y: 0.02, linked: false } }), { scale: 1 });
    expect(layout.canvas).toEqual({ width: 960, height: 690 });
    expect(layout.frame.x).toBeCloseTo(80, 9);
    expect(layout.frame.y).toBeCloseTo(16, 9);
  });

  it('linked padding ignores y', () => {
    const layout = computeLayout(comp({ padding: { x: 0.1, y: 0.4, linked: true } }), { scale: 1 });
    expect(layout.canvas).toEqual({ width: 960, height: 818 });
  });
});

describe('computeLayout crop', () => {
  it('shows exactly the cropped source px', () => {
    const layout = computeLayout(comp({ crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.3 } }), { scale: 1 });
    expectRect(layout.sourceCrop, { x: 200, y: 60, width: 400, height: 180 });
    expect(layout.content.width).toBeCloseTo(400, 9);
    expect(layout.content.height).toBeCloseTo(180, 9);
  });
});

describe('the content aspect always equals the crop aspect', () => {
  const ratios: CanvasRatio[] = ['original', '16:9', '1:1', '4:5', 'custom'];
  const frames: FrameStyle[] = ['browser', 'minimal', 'none'];
  const paddings = [
    { x: 0, y: 0, linked: true },
    { x: 0.12, y: 0.12, linked: true },
    { x: 0.3, y: 0.05, linked: false },
    { x: 0.5, y: 0.5, linked: false },
  ];
  const crops: Rect[] = [
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.1, y: 0.2, width: 0.33, height: 0.71 },
    { x: 0.5, y: 0, width: 0.5, height: 0.02 },
    { x: 0, y: 0.9, width: 0.02, height: 0.1 },
  ];
  const sources = [SOURCE, { ...SOURCE, width: 1170, height: 2532 }, { ...SOURCE, width: 3024, height: 1964 }];

  it('for every ratio, padding, frame, crop and scale', () => {
    let cases = 0;
    for (const source of sources)
      for (const ratio of ratios)
        for (const style of frames)
          for (const padding of paddings)
            for (const crop of crops)
              for (const scale of [1, 2, 0.37]) {
                const c = comp({ source, crop, padding, canvas: { ratio, width: 1280, height: 720 }, frame: { ...comp().frame, style } });
                const layout = computeLayout(c, { scale });
                const cropAspect = (crop.width * source.width) / (crop.height * source.height);
                expect(Math.abs(aspect(layout.content) - cropAspect)).toBeLessThan(1e-9);
                expect(Math.abs(aspect(layout.sourceCrop) - cropAspect)).toBeLessThan(1e-9);
                // The frame stays inside the canvas, centred.
                expect(layout.frame.x).toBeGreaterThanOrEqual(-1e-9);
                expect(layout.frame.y).toBeGreaterThanOrEqual(-1e-9);
                expect(layout.frame.x * 2 + layout.frame.width).toBeCloseTo(layout.canvas.width, 6);
                expect(layout.frame.y * 2 + layout.frame.height).toBeCloseTo(layout.canvas.height, 6);
                expect(Number.isInteger(layout.canvas.width) && Number.isInteger(layout.canvas.height)).toBe(true);
                cases++;
              }
    expect(cases).toBe(3 * 5 * 3 * 4 * 4 * 3);
  });
});
