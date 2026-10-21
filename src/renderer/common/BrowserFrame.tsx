import { LockIcon, PlusIcon, ShareIcon, TabsIcon } from '../design-system';
import type { FrameStyle, FrameTheme } from './previewComposition';

/**
 * The decorative window chrome drawn above framed media (it is not a
 * browser). Sizes are in `cqw` of the frame, so it scales with the preview.
 */
export function BrowserChrome({ style, theme, address }: { style: FrameStyle; theme: FrameTheme; address: string }) {
  if (style === 'none') return null;
  return (
    <div className={`frame-chrome frame-chrome-${style} frame-chrome-${theme}`} aria-hidden="true">
      <span className="frame-lights">
        <span className="frame-light frame-light-close" />
        <span className="frame-light frame-light-min" />
        <span className="frame-light frame-light-max" />
      </span>
      {style === 'browser' && (
        <>
          <span className="frame-address">
            <LockIcon className="frame-address-lock" />
            <span>{address}</span>
          </span>
          <span className="frame-tools">
            <ShareIcon />
            <PlusIcon />
            <TabsIcon />
          </span>
        </>
      )}
    </div>
  );
}
