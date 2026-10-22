import { useEffect, useState } from 'react';
import { PauseIcon, PlayIcon, RestartIcon, StopIcon, TrashIcon } from '../design-system';
import { useRecordingState } from './App';
import { formatElapsed } from './time';

// The stop bar while recording, as in Cap: Stop with the time, then pause or
// resume, restart and delete. It drags by its body.

export function Bar() {
  const state = useRecordingState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const elapsed = state.elapsedMs + (state.status === 'recording' ? Math.max(0, now - state.at) : 0);
  const saving = state.status === 'finishing';

  return (
    <div className="stop-bar" data-testid="stop-bar">
      {saving ? (
        <span className="stop-bar-saving">
          <span className="stop-bar-spinner" aria-hidden="true" />
          Saving…
        </span>
      ) : (
        <>
          <button type="button" className="stop-bar-stop" onClick={() => void window.xbot.recordings.stop()} aria-label="Stop recording" data-testid="bar-stop">
            <StopIcon size={16} />
            <span className="stop-bar-time">{formatElapsed(elapsed)}</span>
          </button>
          <span className="stop-bar-sep" aria-hidden="true" />
          {state.status === 'paused' ? (
            <button type="button" className="stop-bar-btn" aria-label="Resume" onClick={() => void window.xbot.recordings.resume()} data-testid="bar-resume">
              <PlayIcon size={18} />
            </button>
          ) : (
            <button type="button" className="stop-bar-btn" aria-label="Pause" onClick={() => void window.xbot.recordings.pause()} data-testid="bar-pause">
              <PauseIcon size={18} />
            </button>
          )}
          <button type="button" className="stop-bar-btn" aria-label="Restart" onClick={() => void window.xbot.recordings.restart()}>
            <RestartIcon size={18} />
          </button>
          <button type="button" className="stop-bar-btn" aria-label="Delete recording" onClick={() => void window.xbot.recordings.discard()}>
            <TrashIcon size={18} />
          </button>
        </>
      )}
    </div>
  );
}
