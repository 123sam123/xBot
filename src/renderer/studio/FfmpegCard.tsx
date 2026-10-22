import { useEffect, useState } from 'react';
import type { FfmpegStatus } from '../../shared/contracts/studio';
import { FrostedButton, GhostButton, GlassCard } from '../design-system';

/** FFmpeg's status, kept current by `studio:ffmpeg`; 'checking' until main answers. */
export function useFfmpegStatus(enabled: boolean): FfmpegStatus {
  const [status, setStatus] = useState<FfmpegStatus>({ state: 'checking' });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void window.xbot.studio.ffmpegStatus().then((result) => alive && result.ok && setStatus(result.data));
    const off = window.xbot.events.on('studio:ffmpeg', setStatus);
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return status;
}

/**
 * What to do when video needs FFmpeg and it isn't usable: the reason, how to
 * get it, and Check again / Locate FFmpeg…. Image editing never shows this.
 */
export function FfmpegCard({ status, compact = false }: { status: Extract<FfmpegStatus, { state: 'missing' }> | { state: 'checking' }; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async (action: () => Promise<{ ok: boolean; data?: FfmpegStatus | null }>) => {
    setBusy(true);
    setNote(null);
    try {
      const result = await action();
      if (result.ok && result.data?.state === 'missing') setNote('Still not found.');
    } finally {
      setBusy(false);
    }
  };
  const checking = status.state === 'checking';
  return (
    <GlassCard className={['ffmpeg-card', compact && 'ffmpeg-card-compact'].filter(Boolean).join(' ')} role="status" data-testid="ffmpeg-card">
      <p className="ffmpeg-card-title">{checking ? 'Looking for FFmpeg…' : 'Video editing needs FFmpeg'}</p>
      {!checking && (
        <>
          <p className="ffmpeg-card-text">{status.message}</p>
          {!compact && (
            <p className="ffmpeg-card-text">
              It’s free and stays on your Mac.{' '}
              <a href="https://ffmpeg.org/download.html" target="_blank" rel="noreferrer">
                About FFmpeg
              </a>
            </p>
          )}
          <span className="ffmpeg-card-actions">
            <FrostedButton className="ffmpeg-card-button" disabled={busy} onClick={() => void run(() => window.xbot.studio.checkFfmpeg())} data-testid="ffmpeg-check">
              {busy ? 'Checking…' : 'Check again'}
            </FrostedButton>
            <GhostButton className="ffmpeg-card-button" disabled={busy} onClick={() => void run(() => window.xbot.studio.locateFfmpeg())}>
              Locate FFmpeg…
            </GhostButton>
            {note && <span className="ffmpeg-card-note">{note}</span>}
          </span>
        </>
      )}
    </GlassCard>
  );
}
