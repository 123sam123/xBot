import type { RefCallback } from 'react';
import type { Composition } from '../../shared/composition/model';
import { CompositionCanvas, previewLayout, useDevicePixelRatio } from '../common/composition/CompositionCanvas';
import type { CompositionAssets } from '../common/composition/draw';

/**
 * A video document's preview, stacked the way FFmpeg composites the export:
 * the <video> underneath, sized and offset so its crop fills the content rect
 * at one uniform scale, and the canvas over it drawing the frame layer, whose
 * hole (rounded corners, border and all) shows the video through.
 */
export function VideoStage({
  composition,
  assets,
  ready,
  displayScale,
  url,
  videoRef,
  failed,
}: {
  composition: Composition;
  assets: CompositionAssets;
  ready: boolean;
  displayScale: number;
  url: string;
  videoRef: RefCallback<HTMLVideoElement>;
  /** The <video> couldn't load this codec. */
  failed: boolean;
}) {
  const dpr = useDevicePixelRatio();
  const { layout, cssWidth, cssHeight } = previewLayout(composition, displayScale, dpr);
  const kx = cssWidth / layout.canvas.width;
  const ky = cssHeight / layout.canvas.height;
  const content = { x: layout.content.x * kx, y: layout.content.y * ky, width: layout.content.width * kx };
  // CSS px per source px: the crop fills the content width (and, the aspect being the crop's, its height).
  const k = content.width / layout.sourceCrop.width;
  return (
    <div className="video-stage" style={{ width: cssWidth, height: cssHeight }} data-testid="studio-video-stage">
      <video
        ref={videoRef}
        className="video-stage-video"
        src={url}
        preload="auto"
        playsInline
        disablePictureInPicture
        style={{
          left: content.x - layout.sourceCrop.x * k,
          top: content.y - layout.sourceCrop.y * k,
          width: composition.source.width * k,
          height: composition.source.height * k,
        }}
        data-testid="studio-video"
      />
      <CompositionCanvas composition={composition} assets={assets} assetsReady={ready} displayScale={displayScale} hole className="video-stage-canvas" testId="studio-preview-canvas" />
      {failed && (
        <p className="video-stage-note" role="status">
          This video can’t play here. The export still works.
        </p>
      )}
    </div>
  );
}
