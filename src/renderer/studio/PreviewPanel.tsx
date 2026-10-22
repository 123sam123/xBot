import type { ReactNode, RefObject } from 'react';
import { CANVAS_LIMITS, RATIOS, type CanvasRatio, type Composition } from '../../shared/composition/model';
import { useClock, type Clock } from '../common/composition/clock';
import {
  ChevronDownIcon,
  CropIcon,
  FrameIcon,
  GridIcon,
  Menu,
  NumberField,
  PauseIcon,
  Popover,
  PlayIcon,
  popovers,
  ScissorsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  ZoomInIcon,
  ZoomOutIcon,
  type MenuItem,
} from '../design-system';
import { FRAME_POPOVER } from './FramePopover';
import { formatClock } from './timeline/Timeline';

export const ASPECT_MENU = 'studio-aspect';
export const QUALITY_MENU = 'studio-quality';
export const SIZE_POPOVER = 'studio-size';

export type PreviewQuality = 'full' | 'half';

const ASPECT_LABELS: Record<CanvasRatio, string> = {
  original: 'Auto',
  '16:9': '16:9',
  '4:3': '4:3',
  '1:1': '1:1',
  '4:5': '4:5',
  '9:16': '9:16',
  custom: 'Custom',
};

/** The left panel: Cap's toolbar over the preview, and the transport under it for a video. */
export function PreviewPanel({
  aspect,
  onAspect,
  onCustom,
  aspectAnchor,
  frameAnchor,
  qualityAnchor,
  quality,
  onQuality,
  cropping,
  onCrop,
  disabled,
  stage,
  transport,
}: {
  aspect: CanvasRatio;
  onAspect(ratio: CanvasRatio): void;
  /** "Custom…": the size popover. */
  onCustom(): void;
  aspectAnchor: RefObject<HTMLButtonElement | null>;
  frameAnchor: RefObject<HTMLButtonElement | null>;
  qualityAnchor: RefObject<HTMLButtonElement | null>;
  quality: PreviewQuality;
  onQuality(quality: PreviewQuality): void;
  cropping: boolean;
  onCrop(): void;
  disabled: boolean;
  stage: ReactNode;
  transport?: ReactNode;
}) {
  const aspectItems: MenuItem[] = [
    ...(['original', ...Object.keys(RATIOS)] as CanvasRatio[]).map((ratio) => ({
      id: ratio,
      label: ASPECT_LABELS[ratio],
      checked: aspect === ratio,
      onSelect: () => onAspect(ratio),
    })),
    { id: 'custom', label: 'Custom size…', checked: aspect === 'custom', onSelect: onCustom },
  ];
  const qualityItems: MenuItem[] = [
    { id: 'full', label: 'Full', checked: quality === 'full', onSelect: () => onQuality('full') },
    { id: 'half', label: 'Half', detail: 'Smoother playback on long recordings', checked: quality === 'half', onSelect: () => onQuality('half') },
  ];

  return (
    <section className="studio-preview" aria-label="Preview">
      <div className="preview-toolbar">
        <button ref={aspectAnchor} type="button" className="preview-tool" aria-disabled={disabled || undefined} onClick={() => !disabled && popovers.toggle(ASPECT_MENU)} data-testid="preview-aspect">
          <GridIcon size={18} />
          {ASPECT_LABELS[aspect]}
          <ChevronDownIcon size={15} strokeWidth={2.2} />
        </button>
        <button type="button" className={`preview-tool${cropping ? ' preview-tool-active' : ''}`} aria-disabled={disabled || undefined} onClick={() => !disabled && onCrop()} data-testid="preview-crop">
          <CropIcon size={18} />
          Crop
        </button>
        <button ref={frameAnchor} type="button" className="preview-tool" aria-disabled={disabled || undefined} onClick={() => !disabled && popovers.toggle(FRAME_POPOVER)} data-testid="preview-frame">
          <FrameIcon size={18} />
          Frame
          <ChevronDownIcon size={15} strokeWidth={2.2} />
        </button>
        <span className="preview-toolbar-spacer" />
        <span className="preview-quality-label">Preview quality</span>
        <button ref={qualityAnchor} type="button" className="preview-tool preview-tool-filled" onClick={() => popovers.toggle(QUALITY_MENU)} data-testid="preview-quality">
          {quality === 'full' ? 'Full' : 'Half'}
          <ChevronDownIcon size={15} strokeWidth={2.2} />
        </button>
      </div>
      <div className="preview-stage">{stage}</div>
      {transport}
      <Menu id={ASPECT_MENU} anchor={aspectAnchor} label="Aspect ratio" placement="bottom-start" items={aspectItems} testId="aspect-menu" />
      <Menu id={QUALITY_MENU} anchor={qualityAnchor} label="Preview quality" placement="bottom-end" items={qualityItems} />
    </section>
  );
}

/** Play controls, the time, split, and the timeline's zoom. */
export function Transport({
  clock,
  totalMs,
  playing,
  onToggle,
  onPrevious,
  onNext,
  onSplit,
  zoom,
  onZoom,
}: {
  clock: Clock;
  totalMs: number;
  playing: boolean;
  onToggle(): void;
  onPrevious(): void;
  onNext(): void;
  onSplit(): void;
  zoom: number;
  onZoom(zoom: number): void;
}) {
  return (
    <div className="transport">
      <TimeReadout clock={clock} totalMs={totalMs} />
      <div className="transport-center">
        <button type="button" className="transport-btn" aria-label="Previous clip" onClick={onPrevious}>
          <SkipBackIcon size={18} />
        </button>
        <button type="button" className="transport-btn transport-play" aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle} data-testid="transport-play">
          {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
        <button type="button" className="transport-btn" aria-label="Next clip" onClick={onNext}>
          <SkipForwardIcon size={18} />
        </button>
      </div>
      <div className="transport-end">
        <button type="button" className="transport-btn" aria-label="Split at playhead" title="Split at playhead (S)" onClick={onSplit} data-testid="transport-split">
          <ScissorsIcon size={19} />
        </button>
        <span className="transport-sep" aria-hidden="true" />
        <button type="button" className="transport-btn" aria-label="Zoom timeline out" onClick={() => onZoom(Math.max(1, zoom / 1.5))}>
          <ZoomOutIcon size={19} />
        </button>
        <button type="button" className="transport-btn" aria-label="Zoom timeline in" onClick={() => onZoom(Math.min(12, zoom * 1.5))}>
          <ZoomInIcon size={19} />
        </button>
        <input
          type="range"
          className="slider transport-zoom"
          aria-label="Timeline zoom"
          min={0}
          max={1}
          step={0.01}
          value={Math.log(zoom) / Math.log(12)}
          onChange={(event) => onZoom(12 ** Number(event.target.value))}
          style={{ '--fill': `${(Math.log(zoom) / Math.log(12)) * 100}%` } as React.CSSProperties}
        />
      </div>
      <span className="transport-hint">Pinch, or press Cmd +/- to zoom</span>
    </div>
  );
}

function TimeReadout({ clock, totalMs }: { clock: Clock; totalMs: number }) {
  const now = useClock(clock);
  return (
    <span className="transport-time" data-testid="transport-time">
      {formatClock(now, true)} <span className="transport-total">/ {formatClock(totalMs, true)}</span>
    </span>
  );
}

/** A custom output size, px at 1×. */
export function SizePopover({
  anchor,
  composition,
  onChange,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  composition: Composition;
  onChange(next: Composition): void;
}) {
  const { canvas } = composition;
  const set = (patch: Partial<Composition['canvas']>) => onChange({ ...composition, canvas: { ...canvas, ratio: 'custom', ...patch } });
  return (
    <Popover id={SIZE_POPOVER} anchor={anchor} label="Custom size" placement="bottom-start" className="tool-popover" testId="popover-size">
      <h2 className="tool-popover-title">Custom size</h2>
      <div className="tool-field-pair">
        <NumberField label="W" value={canvas.width} min={CANVAS_LIMITS.min} max={CANVAS_LIMITS.max} suffix="px" onChange={(width) => set({ width })} testId="output-width" />
        <NumberField label="H" value={canvas.height} min={CANVAS_LIMITS.min} max={CANVAS_LIMITS.max} suffix="px" onChange={(height) => set({ height })} testId="output-height" />
      </div>
    </Popover>
  );
}
