import { useCallback, useEffect, useState } from 'react';
import type { AiState } from '../../../shared/contracts/ai';

/**
 * The local AI state from main, kept current through the `ai:state` event.
 * Showing the page asks main for a (throttled) re-check, so a status that
 * went stale while the window was hidden corrects itself.
 */
export function useAiState(enabled = true): { state: AiState | null; refresh(mode: 'throttled' | 'force'): Promise<void> } {
  const [state, setState] = useState<AiState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void window.xbot.ai.getState('cached').then((result) => {
      if (alive && result.ok) setState(result.data);
    });
    const off = window.xbot.events.on('ai:state', setState);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void window.xbot.ai.getState('throttled');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      off();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  const refresh = useCallback(async (mode: 'throttled' | 'force') => {
    const result = await window.xbot.ai.getState(mode);
    if (result.ok) setState(result.data);
  }, []);

  return { state, refresh };
}
