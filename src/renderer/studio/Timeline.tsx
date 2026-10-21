import type { CSSProperties } from 'react';
import { GlassCard, IconButton, PauseIcon, PlayIcon } from '../design-system';

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The slim video timeline: play, time, filmstrip, trim box and playhead.
 * Times are seconds; `trim` is [start, end] as fractions of `duration`.
 */
export function Timeline({
  duration,
  current,
  trim,
  frames,
  playing,
  onTogglePlay,
  label = 'Video timeline',
}: {
  duration: number;
  current: number;
  trim: readonly [number, number];
  /** Filmstrip thumbnails, left to right. */
  frames: readonly string[];
  playing: boolean;
  onTogglePlay(): void;
  label?: string;
}) {
  const at = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
  return (
    <GlassCard className="timeline" role="group" aria-label={label} data-testid="timeline">
      <IconButton label={playing ? 'Pause' : 'Play'} size="lg" className="timeline-play" onClick={onTogglePlay}>
        {playing ? <PauseIcon size={17} /> : <PlayIcon size={18} />}
      </IconButton>
      <span className="timeline-time">
        {clock(current)} / {clock(duration)}
      </span>
      <div className="timeline-strip" style={{ '--trim-start': at(trim[0]), '--trim-end': at(trim[1]) } as CSSProperties}>
        <div className="timeline-frames" aria-hidden="true">
          {frames.map((src, index) => (
            <img key={index} src={src} alt="" draggable={false} />
          ))}
        </div>
        <div className="timeline-trim" style={{ left: at(trim[0]), width: at(trim[1] - trim[0]) }}>
          <span className="trim-handle trim-handle-start" />
          <span className="trim-handle trim-handle-end" />
        </div>
        <div className="timeline-playhead" style={{ left: at(duration > 0 ? current / duration : 0) }} />
      </div>
    </GlassCard>
  );
}
