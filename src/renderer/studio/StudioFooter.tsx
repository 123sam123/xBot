import { useRef, type RefObject } from 'react';
import { ChevronDownIcon, Divider, FullscreenIcon, GhostButton, IconButton, ImageIcon, Menu, popovers, Tooltip } from '../design-system';

export type FitMode = 'fit' | 'fill';
export const ZOOM_LEVELS = [50, 75, 100, 200] as const;

/** Output dimensions on the left; fit, zoom and full screen on the right. */
export function StudioFooter({
  dimensions,
  fit,
  zoom,
  onFit,
  onZoom,
  dimsAnchor,
  onDimensions,
  fullscreen,
  onFullscreen,
}: {
  dimensions: { width: number; height: number } | null;
  /** Null while a zoom level is chosen instead. */
  fit: FitMode | null;
  /** The effective zoom, %. */
  zoom: number;
  /** Without these the view controls are shown but inert. */
  onFit?(mode: FitMode): void;
  onZoom?(zoom: number): void;
  /** With these, the dimensions open the Output settings. */
  dimsAnchor?: RefObject<HTMLButtonElement | null>;
  onDimensions?(): void;
  fullscreen?: boolean;
  onFullscreen?(): void;
}) {
  const fitAnchor = useRef<HTMLButtonElement>(null);
  const zoomAnchor = useRef<HTMLButtonElement>(null);
  const label = dimensions ? `${dimensions.width} × ${dimensions.height}` : 'No media';
  return (
    <footer className="studio-footer">
      {onDimensions ? (
        <GhostButton
          ref={dimsAnchor}
          className="studio-dims studio-dims-button"
          icon={<ImageIcon size={23} strokeWidth={1.6} />}
          aria-haspopup="dialog"
          aria-label={`Output ${label}`}
          data-testid="studio-dims"
          onClick={onDimensions}
        >
          {label}
        </GhostButton>
      ) : (
        <span className="studio-dims" data-testid="studio-dims">
          <ImageIcon size={23} strokeWidth={1.6} />
          {label}
        </span>
      )}
      <span className="studio-view">
        <Divider vertical />
        <GhostButton
          ref={fitAnchor}
          className="studio-view-button"
          disabled={!onFit}
          aria-haspopup="menu"
          iconAfter={<ChevronDownIcon size={18} />}
          data-testid="studio-fit"
          onClick={() => popovers.toggle('fit-menu')}
        >
          {fit === 'fill' ? 'Fill' : 'Fit'}
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
          data-testid="studio-zoom"
          onClick={() => popovers.toggle('zoom-menu')}
        >
          {zoom}%
        </GhostButton>
        <Menu
          id="zoom-menu"
          anchor={zoomAnchor}
          label="Zoom"
          placement="top-end"
          testId="zoom-menu"
          items={ZOOM_LEVELS.map((level) => ({
            id: String(level),
            label: `${level}%`,
            checked: fit === null && level === zoom,
            onSelect: () => onZoom?.(level),
          }))}
        />
        <Divider vertical />
        {onFullscreen ? (
          <IconButton label={fullscreen ? 'Exit full screen' : 'Full screen'} bare onClick={onFullscreen} data-testid="studio-fullscreen">
            <FullscreenIcon size={24} strokeWidth={1.6} />
          </IconButton>
        ) : (
          <Tooltip label="Full screen isn’t available yet">
            <IconButton label="Full screen" bare disabled>
              <FullscreenIcon size={24} strokeWidth={1.6} />
            </IconButton>
          </Tooltip>
        )}
      </span>
    </footer>
  );
}
