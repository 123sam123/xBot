import { exportLayout } from '../../../shared/composition/layout';
import { MAX_EXPORT_BYTES, type Composition, type ExportFormat } from '../../../shared/composition/model';
import { drawComposition, type CompositionAssets } from './draw';

// The export: the same layout and draw routine as the preview, at the output
// size on an OffscreenCanvas that holds nothing but the composition. A video's
// export is FFmpeg's (T5); the renderer only draws its frame layer here.

export class RenderError extends Error {
  constructor(
    readonly code: 'export_too_large' | 'render_failed',
    message: string,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}

export interface RenderedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export async function renderComposition(comp: Composition, assets: CompositionAssets, format: ExportFormat): Promise<RenderedImage> {
  const layout = exportLayout(comp);
  const { width, height } = layout.canvas;
  let blob: Blob;
  const canvas = new OffscreenCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    drawComposition(ctx, comp, layout, assets);
    blob = await canvas.convertToBlob({ type: format === 'png' ? 'image/png' : 'image/jpeg', quality: 0.92 });
  } catch (err) {
    console.error('studio: render failed', err);
    throw new RenderError('render_failed', 'Couldn’t render the image.');
  } finally {
    // Let the backing store go now rather than at the next GC.
    canvas.width = 0;
    canvas.height = 0;
  }
  if (blob.size > MAX_EXPORT_BYTES) throw new RenderError('export_too_large', 'This image is over 20 MB. Try 1× or JPEG.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/**
 * A video's frame layer: the composition without the video, with a hole where
 * it shows, as an RGBA PNG at the export size. FFmpeg lays it over the video.
 */
export async function renderVideoLayer(comp: Composition, assets: CompositionAssets): Promise<RenderedImage> {
  const layout = exportLayout(comp);
  const { width, height } = layout.canvas;
  let blob: Blob;
  const canvas = new OffscreenCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    drawComposition(ctx, comp, layout, { ...assets, source: null }, { hole: true });
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } catch (err) {
    console.error('studio: frame layer failed', err);
    throw new RenderError('render_failed', 'Couldn’t render the video’s frame.');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  if (blob.size > MAX_EXPORT_BYTES) throw new RenderError('export_too_large', 'The video’s frame is over 20 MB. Try a simpler background.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}
