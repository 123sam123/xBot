import { useEffect, useState } from 'react';
import type { StudioTarget } from '../../shared/contracts/drafts';

// The hand-off from the composer's "Edit in Studio ↗" (T3). The Studio shows
// that media read-only; T4 (XBOT-1N58PP) replaces this with real editing.

/** The attachment the composer opened in the Studio, if any; kept current. */
export function useStudioTarget(enabled: boolean): StudioTarget | null {
  const [target, setTarget] = useState<StudioTarget | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void window.xbot.drafts.getStudioTarget().then((result) => {
      if (alive && result.ok && result.data) setTarget(result.data);
    });
    const off = window.xbot.events.on('draft:studio-target', (next) => setTarget(next));
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return target;
}

export function StudioTargetView({ target }: { target: StudioTarget }) {
  const { media } = target;
  return media.kind === 'video' ? (
    <video className="studio-target" src={media.url} poster={media.thumbUrl ?? undefined} controls muted playsInline data-testid="studio-target" />
  ) : (
    <img className="studio-target" src={media.url} alt={media.name} draggable={false} data-testid="studio-target" />
  );
}
