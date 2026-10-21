import type { CSSProperties } from 'react';
import { BrowserChrome } from './BrowserFrame';
import { BACKGROUNDS, CHROME_RATIO, CROP_ASPECTS, type PreviewComposition } from './previewComposition';
import './composition.css';

export interface CompositionSource {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Renders a composition (background, frame, padding, shadow, crop) around one
 * piece of media, as DOM: only the media itself is an image. It fills its
 * box at any size, from the composer's thumbnail to the Studio canvas.
 */
export function CompositionPreview({
  composition,
  source,
  zoom = 1,
  className,
  testId,
}: {
  composition: PreviewComposition;
  source: CompositionSource;
  /** Display scale around the fitted size (1 = fit). */
  zoom?: number;
  className?: string;
  testId?: string;
}) {
  const mediaAspect = CROP_ASPECTS[composition.crop] ?? source.width / source.height;
  const chrome = CHROME_RATIO[composition.frame.style];
  const light = composition.backgroundLight - 0.5;
  const style = {
    '--composition-bg': BACKGROUNDS[composition.background].canvas,
    '--composition-light': light >= 0 ? `rgb(255 255 255 / ${light * 0.7})` : `rgb(0 0 0 / ${-light * 0.8})`,
    '--pad': composition.padding,
    '--chrome': chrome,
    '--media-aspect': mediaAspect,
    '--frame-aspect': 1 / (1 / mediaAspect + chrome),
    '--zoom': zoom,
  } as CSSProperties;

  return (
    <div className={['composition', className].filter(Boolean).join(' ')} style={style} data-testid={testId}>
      <div className="composition-light" />
      <div className={`composition-frame composition-shadow-${composition.shadow}`}>
        <div className={`frame-body frame-body-${composition.frame.style}`}>
          <BrowserChrome {...composition.frame} />
          <div className="frame-media">
            <img src={source.url} alt={source.alt} draggable={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
