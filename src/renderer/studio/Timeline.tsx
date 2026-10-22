import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GlassCard, IconButton, PauseIcon, PlayIcon, SpeakerIcon, SpeakerMutedIcon, Tooltip } from '../design-system';

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "00:01.5", for a trim handle's spoken value. */
function preciseClock(seconds: number): string {
  return `${clock(seconds)}.${Math.floor((Math.max(0, seconds) % 1) * 10)}`;
}

/** Arrow keys move a trim handle by this much (Shift: ten times). */
const KEY_STEP_S = 0.1;

type Edge = 'start' | 'end';

/**
 * The slim video timeline: play, time, filmstrip, trim box and playhead.
 * Times are seconds; `trim` is [start, end] as fractions of `duration`.
 * With `onSeek` the strip scrubs and the playhead drags; with `onTrim` the
 * handles drag (and take arrow keys); with `onToggleMute` a mute button
 * closes the row. Without them it only shows (preview mode's sample).
 */
export function Timeline({
  duration,
  current,
  trim,
  frames,
  playing,
  onTogglePlay,
  label = 'Video timeline',
  onSeek,
  onTrim,
  onTrimEnd,
  minTrim = 0,
  muted,
  onToggleMute,
  muteDisabledReason,
}: {
  duration: number;
  current: number;
  trim: readonly [number, number];
  /** Filmstrip thumbnails, left to right. */
  frames: readonly string[];
  playing: boolean;
  onTogglePlay(): void;
  label?: string;
  /** Scrub to `seconds`. */
  onSeek?(seconds: number): void;
  /** A trim handle moved: the new [start, end] fractions, and which edge moved. */
  onTrim?(trim: [number, number], edge: Edge): void;
  /** A handle drag (or a key press) ended: one undo step. */
  onTrimEnd?(): void;
  /** The shortest trim, as a fraction of `duration`. */
  minTrim?: number;
  muted?: boolean;
  onToggleMute?(): void;
  /** Set when there is nothing to mute; shown as the button's tooltip. */
  muteDisabledReason?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'seek' } | { kind: 'trim'; edge: Edge } | null>(null);
  const at = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

  const fractionAt = (clientX: number) => {
    const rect = strip.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const moveEdge = (edge: Edge, fraction: number): [number, number] => {
    const [start, end] = trim;
    return edge === 'start' ? [Math.min(Math.max(0, fraction), end - minTrim), end] : [start, Math.max(Math.min(1, fraction), start + minTrim)];
  };

  const begin = (event: ReactPointerEvent<HTMLElement>, kind: 'seek' | Edge) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === 'seek') {
      drag.current = { kind: 'seek' };
      onSeek?.(fractionAt(event.clientX) * duration);
    } else {
      drag.current = { kind: 'trim', edge: kind };
      (event.currentTarget as HTMLElement).focus();
    }
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === 'seek') onSeek?.(fractionAt(event.clientX) * duration);
    else onTrim?.(moveEdge(current.edge, fractionAt(event.clientX)), current.edge);
  };
  const end = () => {
    if (drag.current?.kind === 'trim') onTrimEnd?.();
    drag.current = null;
  };

  const onHandleKey = (event: KeyboardEvent<HTMLElement>, edge: Edge) => {
    if (!onTrim || duration <= 0) return;
    const step = (event.shiftKey ? KEY_STEP_S * 10 : KEY_STEP_S) / duration;
    const value = edge === 'start' ? trim[0] : trim[1];
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? value - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? value + step
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 1
              : null;
    if (next === null) return;
    event.preventDefault();
    onTrim(moveEdge(edge, next), edge);
  };

  const handle = (edge: Edge) => {
    const value = (edge === 'start' ? trim[0] : trim[1]) * duration;
    return onTrim ? (
      <span
        className={`trim-grip trim-grip-${edge}`}
        role="slider"
        tabIndex={0}
        aria-label={edge === 'start' ? 'Trim start' : 'Trim end'}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={preciseClock(value)}
        data-testid={`timeline-trim-${edge}`}
        onPointerDown={(event) => begin(event, edge)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => onHandleKey(event, edge)}
        onKeyUp={() => onTrimEnd?.()}
      >
        <span className={`trim-handle trim-handle-${edge}`} />
      </span>
    ) : (
      <span className={`trim-handle trim-handle-${edge}`} />
    );
  };

  const mute =
    onToggleMute &&
    (() => {
      const button = (
        <IconButton
          label={muted ? 'Unmute' : 'Mute'}
          bare
          className="timeline-mute"
          aria-pressed={muted}
          disabled={muteDisabledReason !== undefined}
          onClick={() => muteDisabledReason === undefined && onToggleMute()}
          data-testid="timeline-mute"
        >
          {muted || muteDisabledReason ? <SpeakerMutedIcon size={20} /> : <SpeakerIcon size={20} />}
        </IconButton>
      );
      return muteDisabledReason ? <Tooltip label={muteDisabledReason}>{button}</Tooltip> : button;
    })();

  return (
    <GlassCard className="timeline" role="group" aria-label={label} data-testid="timeline">
      <IconButton label={playing ? 'Pause' : 'Play'} size="lg" className="timeline-play" onClick={onTogglePlay} data-testid="timeline-play">
        {playing ? <PauseIcon size={17} /> : <PlayIcon size={18} />}
      </IconButton>
      <span className="timeline-time" data-testid="timeline-time">
        {clock(current)} / {clock(duration)}
      </span>
      <div
        ref={strip}
        className={['timeline-strip', onSeek && 'timeline-strip-interactive'].filter(Boolean).join(' ')}
        style={{ '--trim-start': at(trim[0]), '--trim-end': at(trim[1]) } as CSSProperties}
        data-testid="timeline-strip"
        onPointerDown={onSeek ? (event) => begin(event, 'seek') : undefined}
        onPointerMove={onSeek ? move : undefined}
        onPointerUp={onSeek ? end : undefined}
        onPointerCancel={onSeek ? end : undefined}
      >
        <div className="timeline-frames" aria-hidden="true">
          {frames.map((src, index) => (
            <img key={index} src={src} alt="" draggable={false} />
          ))}
        </div>
        <div className="timeline-trim" style={{ left: at(trim[0]), width: at(trim[1] - trim[0]) }}>
          {handle('start')}
          {handle('end')}
        </div>
        <div className="timeline-playhead" style={{ left: at(duration > 0 ? Math.min(1, current / duration) : 0) }} data-testid="timeline-playhead" />
      </div>
      {mute}
    </GlassCard>
  );
}
