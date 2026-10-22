import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { SceneSegment, VideoSettings, ZoomSegment } from '../../../shared/composition/model';
import {
  clipLength,
  clipStartTime,
  newScene,
  newSegmentRange,
  newZoom,
  placeSegment,
  removeClip,
  timelineDuration,
  trimClip,
} from '../../../shared/composition/timeline';
import { useClock, type Clock } from '../../common/composition/clock';
import { CameraIcon, ChevronDownIcon, ClockIcon, FilmIcon, Menu, PlusIcon, popovers, SearchIcon, type MenuItem } from '../../design-system';

export type TimelineSelection = { kind: 'clip'; index: number } | { kind: 'zoom'; id: string } | { kind: 'scene'; id: string } | null;

const ADD_MENU = 'timeline-add';
/** Space after the last second, px. */
const TAIL_PX = 48;
/** Room before 0:00 so the playhead's knob isn't clipped, px. */
const LEAD_PX = 26;
/** A pointer that moved less than this is a click, px. */
const CLICK_SLOP = 3;

const TICK_STEPS_S = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

export function formatClock(ms: number, tenths = false): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return tenths ? `${minutes}:${seconds.toFixed(2).padStart(5, '0')}` : `${minutes}:${String(Math.floor(seconds)).padStart(2, '0')}`;
}

const uid = () => crypto.randomUUID();

interface Drag {
  pointerId: number;
  startX: number;
  moved: boolean;
  apply(dxMs: number): void;
  click?: () => void;
}

export function Timeline({
  video,
  sourceDurationMs,
  clock,
  zoom,
  onSeek,
  onChange,
  onCommit,
  selection,
  onSelect,
  onSplit,
  hasCamera,
  zoomAnchor,
}: {
  video: VideoSettings;
  sourceDurationMs: number;
  clock: Clock;
  /** Timeline zoom, 1 fits the whole timeline. */
  zoom: number;
  onSeek(tMs: number): void;
  onChange(next: VideoSettings, gesture?: string): void;
  onCommit(): void;
  selection: TimelineSelection;
  onSelect(selection: TimelineSelection, anchor?: HTMLElement): void;
  onSplit(): void;
  hasCamera: boolean;
  /** Set to the selected zoom segment's element, for its editor popover. */
  zoomAnchor: RefObject<HTMLElement | null>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<Drag | null>(null);
  const total = timelineDuration(video);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const fitPps = Math.max(8, (width - LEAD_PX - TAIL_PX) / Math.max(0.5, total / 1000));
  const pps = fitPps * zoom;
  const x = (ms: number) => LEAD_PX + (ms / 1000) * pps;
  const msAt = (clientX: number) => {
    const el = scroller.current!;
    const left = el.getBoundingClientRect().left;
    return Math.min(total, Math.max(0, ((clientX - left + el.scrollLeft - LEAD_PX) / pps) * 1000));
  };
  const contentWidth = Math.max(width, x(total) + TAIL_PX);

  /** Keeps `left` (content px) in view. */
  const follow = useCallback((left: number) => {
    const el = scroller.current;
    if (!el) return;
    if (left < el.scrollLeft || left > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, left - el.clientWidth * 0.25);
  }, []);

  const begin = (event: ReactPointerEvent, apply: (dxMs: number) => void, click?: () => void) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, moved: false, apply, click };
  };
  const move = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    if (!active.moved && Math.abs(dx) < CLICK_SLOP) return;
    active.moved = true;
    active.apply((dx / pps) * 1000);
  };
  const end = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (active.moved) onCommit();
    else active.click?.();
  };

  const scrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    onSeek(msAt(event.clientX));
    const onMove = (e: PointerEvent) => onSeek(msAt(e.clientX));
    const stop = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
  };

  // Delete / Backspace removes the selected segment or clip.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (!selection) return;
      event.preventDefault();
      if (selection.kind === 'clip') onChange(removeClip(video, selection.index));
      else if (selection.kind === 'zoom') onChange({ ...video, zooms: video.zooms.filter((z) => z.id !== selection.id) });
      else onChange({ ...video, scenes: video.scenes.filter((s) => s.id !== selection.id) });
      onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, video, onChange, onSelect]);

  const addZoomAt = (tMs: number, anchor?: HTMLElement) => {
    const range = newSegmentRange(video.zooms, tMs, total);
    if (!range) return;
    const zoomSegment = newZoom(uid(), range);
    onChange({ ...video, zooms: [...video.zooms, zoomSegment].sort((a, b) => a.startMs - b.startMs) });
    onSelect({ kind: 'zoom', id: zoomSegment.id }, anchor);
  };
  const addSceneAt = (tMs: number) => {
    const range = newSegmentRange(video.scenes, tMs, total);
    if (!range) return;
    const scene = newScene(uid(), range);
    onChange({ ...video, scenes: [...video.scenes, scene].sort((a, b) => a.startMs - b.startMs) });
    onSelect({ kind: 'scene', id: scene.id });
  };

  const segmentHandlers = <T extends ZoomSegment | SceneSegment>(kind: 'zoom' | 'scene', segment: T) => {
    const track = (kind === 'zoom' ? video.zooms : video.scenes) as T[];
    const write = (next: T[], gesture: string) => onChange(kind === 'zoom' ? { ...video, zooms: next as ZoomSegment[] } : { ...video, scenes: next as SceneSegment[] }, gesture);
    return {
      body: (event: ReactPointerEvent<HTMLElement>) => {
        const element = event.currentTarget;
        begin(
          event,
          (dx) => write(placeSegment(track, segment.id, segment.startMs + dx, segment.endMs + dx, total, 'move'), `${kind}-move-${segment.id}`),
          () => onSelect({ kind, id: segment.id } as TimelineSelection, element),
        );
      },
      start: (event: ReactPointerEvent) => begin(event, (dx) => write(placeSegment(track, segment.id, segment.startMs + dx, segment.endMs, total, 'start'), `${kind}-start-${segment.id}`)),
      end: (event: ReactPointerEvent) => begin(event, (dx) => write(placeSegment(track, segment.id, segment.startMs, segment.endMs + dx, total, 'end'), `${kind}-end-${segment.id}`)),
    };
  };

  const addItems: MenuItem[] = [
    { id: 'zoom', label: 'Zoom at playhead', onSelect: () => addZoomAt(clock.get()) },
    { id: 'scene', label: 'Scene at playhead', disabled: !hasCamera, detail: hasCamera ? undefined : 'Needs a camera recording', onSelect: () => addSceneAt(clock.get()) },
    { id: 'split', label: 'Split clip at playhead', onSelect: onSplit },
  ];

  return (
    <div className="timeline" data-testid="timeline">
      <div className="timeline-labels">
        <button ref={addAnchor} type="button" className="timeline-add" aria-haspopup="menu" onClick={() => popovers.toggle(ADD_MENU)} data-testid="timeline-add">
          <PlusIcon size={15} strokeWidth={2.2} />
          Add track
          <ChevronDownIcon size={13} strokeWidth={2.2} />
        </button>
        <TrackLabel kind="video" icon={<FilmIcon size={18} />} label="Video" />
        <TrackLabel kind="zoom" icon={<SearchIcon size={18} />} label="Zoom" />
        <TrackLabel kind="scene" icon={<CameraIcon size={18} />} label="Scene" />
      </div>

      <div ref={scroller} className="timeline-scroll" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <div className="timeline-content" style={{ width: contentWidth }}>
          <Ruler total={total} pps={pps} x={x} onPointerDown={scrub} />

          <div className="timeline-track timeline-track-video" onPointerDown={scrub}>
            {video.clips.map((clip, index) => {
              const start = clipStartTime(video, index);
              const length = clipLength(clip);
              const selected = selection?.kind === 'clip' && selection.index === index;
              return (
                <div
                  key={`${index}-${clip.startMs}`}
                  className={`timeline-clip${selected ? ' timeline-segment-selected' : ''}`}
                  style={{ left: x(start), width: Math.max(4, (length / 1000) * pps) }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelect({ kind: 'clip', index });
                    onSeek(msAt(event.clientX));
                  }}
                  data-testid={`timeline-clip-${index}`}
                >
                  <SegmentEdge side="start" onPointerDown={(event) => begin(event, (dx) => onChange(trimClip(video, index, 'start', clip.startMs + dx, sourceDurationMs), `clip-start-${index}`))} />
                  <span className="timeline-segment-label">
                    <span>Clip</span>
                    <span className="timeline-segment-detail">
                      <ClockIcon size={13} strokeWidth={2} />
                      {(length / 1000).toFixed(length < 10_000 ? 1 : 0).replace(/\.0$/, '')}s
                    </span>
                  </span>
                  <SegmentEdge side="end" onPointerDown={(event) => begin(event, (dx) => onChange(trimClip(video, index, 'end', clip.endMs + dx, sourceDurationMs), `clip-end-${index}`))} />
                </div>
              );
            })}
          </div>

          <div
            className="timeline-track timeline-track-zoom"
            onPointerDown={(event) => {
              if (event.button !== 0 || event.target !== event.currentTarget) return;
              addZoomAt(msAt(event.clientX));
            }}
            data-testid="timeline-zoom-track"
          >
            {video.zooms.length === 0 && <span className="timeline-hint">Click to add a zoom</span>}
            {video.zooms.map((segment) => {
              const handlers = segmentHandlers('zoom', segment);
              const selected = selection?.kind === 'zoom' && selection.id === segment.id;
              return (
                <div
                  key={segment.id}
                  ref={selected ? (el) => void (zoomAnchor.current = el) : undefined}
                  className={`timeline-zoom${selected ? ' timeline-segment-selected' : ''}`}
                  style={{ left: x(segment.startMs), width: Math.max(6, ((segment.endMs - segment.startMs) / 1000) * pps) }}
                  onPointerDown={handlers.body}
                  data-testid="timeline-zoom"
                >
                  <SegmentEdge side="start" onPointerDown={handlers.start} />
                  <span className="timeline-segment-label">
                    <span>{segment.mode === 'auto' ? 'Automatic Zoom' : 'Manual Zoom'}</span>
                    <span className="timeline-segment-detail">
                      <SearchIcon size={13} strokeWidth={2} />
                      {segment.scale.toFixed(1)}x
                    </span>
                  </span>
                  <SegmentEdge side="end" onPointerDown={handlers.end} />
                </div>
              );
            })}
          </div>

          <div
            className={`timeline-track timeline-track-scene${hasCamera ? '' : ' timeline-track-off'}`}
            onPointerDown={(event) => {
              if (!hasCamera || event.button !== 0 || event.target !== event.currentTarget) return;
              addSceneAt(msAt(event.clientX));
            }}
          >
            {video.scenes.length === 0 && (
              <span className="timeline-hint timeline-hint-center">
                {hasCamera ? 'Click to add scene segment' : 'Scene segments need a camera recording'}
                <small>(Make the camera full screen, or hide it)</small>
              </span>
            )}
            {video.scenes.map((segment) => {
              const handlers = segmentHandlers('scene', segment);
              const selected = selection?.kind === 'scene' && selection.id === segment.id;
              return (
                <div
                  key={segment.id}
                  className={`timeline-scene${selected ? ' timeline-segment-selected' : ''}`}
                  style={{ left: x(segment.startMs), width: Math.max(6, ((segment.endMs - segment.startMs) / 1000) * pps) }}
                  onPointerDown={handlers.body}
                >
                  <SegmentEdge side="start" onPointerDown={handlers.start} />
                  <span className="timeline-segment-label">
                    <span>{segment.mode === 'cameraFull' ? 'Camera Only' : 'Hide Camera'}</span>
                  </span>
                  <SegmentEdge side="end" onPointerDown={handlers.end} />
                </div>
              );
            })}
          </div>

          <Playhead clock={clock} x={x} follow={follow} />
        </div>
      </div>

      <Menu id={ADD_MENU} anchor={addAnchor} label="Add track" placement="top-start" items={addItems} testId="timeline-add-menu" />
    </div>
  );
}

function TrackLabel({ kind, icon, label }: { kind: 'video' | 'zoom' | 'scene'; icon: ReactNode; label: string }) {
  return (
    <div className={`timeline-label timeline-label-${kind}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function SegmentEdge({ side, onPointerDown }: { side: 'start' | 'end'; onPointerDown(event: ReactPointerEvent): void }) {
  return <span className={`timeline-edge timeline-edge-${side}`} onPointerDown={onPointerDown} aria-hidden="true" />;
}

function Ruler({ total, pps, x, onPointerDown }: { total: number; pps: number; x(ms: number): number; onPointerDown(event: ReactPointerEvent): void }) {
  const step = TICK_STEPS_S.find((s) => s * pps >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t <= total / 1000 + 1e-6; t += step) ticks.push(t);
  return (
    <div className="timeline-ruler" onPointerDown={onPointerDown}>
      {ticks.map((t) => (
        <span key={t} className="timeline-tick" style={{ left: x(t * 1000) }}>
          <span className="timeline-tick-label">{step < 1 ? formatClock(t * 1000, true).replace(/0$/, '') : formatClock(t * 1000)}</span>
        </span>
      ))}
      {ticks.map((t) =>
        (t + step / 2) * 1000 <= total ? <span key={`d${t}`} className="timeline-dot" style={{ left: x((t + step / 2) * 1000) }} /> : null,
      )}
    </div>
  );
}

/** The red playhead; it alone follows the clock, and keeps itself in view while playing. */
function Playhead({ clock, x, follow }: { clock: Clock; x(ms: number): number; follow(left: number): void }) {
  const now = useClock(clock);
  const left = x(now);
  useEffect(() => follow(left), [left, follow]);
  return (
    <div className="timeline-playhead" style={{ left }} aria-hidden="true" data-testid="timeline-playhead">
      <span className="timeline-playhead-knob" />
    </div>
  );
}
