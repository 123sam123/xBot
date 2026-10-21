import { useRef } from 'react';
import { ChevronDownIcon, Divider, FullscreenIcon, GhostButton, IconButton, ImageIcon, Menu, popovers, Tooltip } from '../design-system';

export type FitMode = 'fit' | 'fill';
export const ZOOM_LEVELS = [50, 75, 100] as const;

/** Output dimensions on the left; fit, zoom and full screen on the right. */
export function StudioFooter({
  dimensions,
  fit,
  zoom,
  onFit,
  onZoom,
}: {
  dimensions: { width: number; height: number } | null;
  fit: FitMode;
  zoom: number;
  /** Without these the view controls are shown but inert. */
  onFit?(mode: FitMode): void;
  onZoom?(zoom: number): void;
}) {
  const fitAnchor = useRef<HTMLButtonElement>(null);
  const zoomAnchor = useRef<HTMLButtonElement>(null);
  return (
    <footer className="studio-footer">
      <span className="studio-dims" data-testid="studio-dims">
        <ImageIcon size={23} strokeWidth={1.6} />
        {dimensions ? `${dimensions.width} × ${dimensions.height}` : 'No media'}
      </span>
      <span className="studio-view">
        <Divider vertical />
        <GhostButton
          ref={fitAnchor}
          className="studio-view-button"
          disabled={!onFit}
          aria-haspopup="menu"
          iconAfter={<ChevronDownIcon size={18} />}
          onClick={() => popovers.toggle('fit-menu')}
        >
          {fit === 'fit' ? 'Fit' : 'Fill'}
        </GhostButton>
        <Menu
          id="fit-menu"
          anchor={fitAnchor}
          label="Fit"
          placement="top-end"
          items={(['fit', 'fill'] as const).map((mode) => ({
            id: mode,
            label: mode === 'fit' ? 'Fit' : 'Fill',
            checked: mode === fit,
            onSelect: () => onFit?.(mode),
          }))}
        />
        <Divider vertical />
        <GhostButton
          ref={zoomAnchor}
          className="studio-view-button"
          disabled={!onZoom}
          aria-haspopup="menu"
          iconAfter={<ChevronDownIcon size={18} />}
          onClick={() => popovers.toggle('zoom-menu')}
        >
          {zoom}%
        </GhostButton>
        <Menu
          id="zoom-menu"
          anchor={zoomAnchor}
          label="Zoom"
          placement="top-end"
          items={ZOOM_LEVELS.map((level) => ({
            id: String(level),
            label: `${level}%`,
            checked: level === zoom,
            onSelect: () => onZoom?.(level),
          }))}
        />
        <Divider vertical />
        <Tooltip label="Full screen isn’t available yet">
          <IconButton label="Full screen" bare disabled>
            <FullscreenIcon size={24} strokeWidth={1.6} />
          </IconButton>
        </Tooltip>
      </span>
    </footer>
  );
}
