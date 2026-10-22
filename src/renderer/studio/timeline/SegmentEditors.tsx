import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ZOOM_LIMITS, type SceneMode, type SceneSegment, type ZoomMode, type ZoomSegment } from '../../../shared/composition/model';
import { clampZoomScale } from '../../../shared/composition/timeline';
import { GhostButton, Popover, Segmented, Slider, TrashIcon } from '../../design-system';

export const ZOOM_EDITOR = 'timeline-zoom-editor';
export const SCENE_EDITOR = 'timeline-scene-editor';

/**
 * A zoom segment's settings: how far it zooms, and where. The focus box shows
 * the part of the frame the zoom fills; drag it to move the focus.
 */
export function ZoomEditor({
  anchor,
  segment,
  aspect,
  frameUrl,
  autoAvailable,
  onChange,
  onCommit,
  onDelete,
}: {
  anchor: RefObject<HTMLElement | null>;
  segment: ZoomSegment;
  /** The content's width ÷ height, so the focus box has the frame's shape. */
  aspect: number;
  /** A still of the video near the segment, behind the focus box. */
  frameUrl?: string;
  /** Automatic zoom follows the recorded cursor, so it needs a recording. */
  autoAvailable: boolean;
  onChange(next: ZoomSegment, gesture?: string): void;
  onCommit(): void;
  onDelete(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = 1 / segment.scale;

  const focusAt = (event: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    const half = width / 2;
    const x = Math.min(1 - half, Math.max(half, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1 - half, Math.max(half, (event.clientY - rect.top) / rect.height));
    onChange({ ...segment, mode: 'manual', x, y }, `zoom-focus-${segment.id}`);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    focusAt(event);
  };

  const left = Math.min(1 - width, Math.max(0, segment.x - width / 2));
  const top = Math.min(1 - width, Math.max(0, segment.y - width / 2));

  return (
    <Popover id={ZOOM_EDITOR} anchor={anchor} placement="top" offset={10} label="Zoom" className="segment-editor" testId="zoom-editor">
      <header className="segment-editor-head">
        <h2>Zoom</h2>
        <span className="segment-editor-value">{segment.scale.toFixed(1)}x</span>
      </header>
      <Slider
        label="Zoom amount"
        min={ZOOM_LIMITS.min}
        max={ZOOM_LIMITS.max}
        step={0.1}
        value={segment.scale}
        onChange={(scale) => onChange({ ...segment, scale: clampZoomScale(scale) }, `zoom-scale-${segment.id}`)}
        onCommit={onCommit}
        testId="zoom-amount"
      />
      <Segmented<ZoomMode>
        label="Zoom mode"
        options={[
          { value: 'auto', label: 'Auto', disabled: !autoAvailable, reason: 'Follows the cursor of an xBot recording' },
          { value: 'manual', label: 'Manual' },
        ]}
        value={segment.mode}
        onChange={(mode) => onChange({ ...segment, mode })}
        testId="zoom-mode"
      />
      <div
        ref={box}
        className="zoom-focus"
        style={{ aspectRatio: String(aspect), ...(frameUrl ? ({ '--frame': `url("${frameUrl}")` } as CSSProperties) : {}) }}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => event.buttons === 1 && focusAt(event)}
        onPointerUp={onCommit}
        data-testid="zoom-focus"
      >
        <span className="zoom-focus-rect" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${width * 100}%` }} />
      </div>
      <GhostButton className="segment-editor-delete" icon={<TrashIcon size={16} />} onClick={onDelete}>
        Delete zoom
      </GhostButton>
    </Popover>
  );
}

export function SceneEditor({
  anchor,
  segment,
  onChange,
  onDelete,
}: {
  anchor: RefObject<HTMLElement | null>;
  segment: SceneSegment;
  onChange(next: SceneSegment): void;
  onDelete(): void;
}) {
  return (
    <Popover id={SCENE_EDITOR} anchor={anchor} placement="top" offset={10} label="Scene" className="segment-editor">
      <header className="segment-editor-head">
        <h2>Scene</h2>
      </header>
      <Segmented<SceneMode>
        label="Scene"
        options={[
          { value: 'cameraFull', label: 'Camera only' },
          { value: 'hideCamera', label: 'Hide camera' },
        ]}
        value={segment.mode}
        onChange={(mode) => onChange({ ...segment, mode })}
      />
      <GhostButton className="segment-editor-delete" icon={<TrashIcon size={16} />} onClick={onDelete}>
        Delete scene
      </GhostButton>
    </Popover>
  );
}
