import { useCallback, useEffect, useState } from 'react';
import type { XState } from '../../../shared/contracts/x';

/**
 * X setup and accounts, kept current through `x:accounts-changed` (connect,
 * switch, disconnect, sign-in waiting) and the `x.*` settings. Null until the
 * first read settles, and always null when `enabled` is false (preview).
 */
export function useXState(enabled: boolean): { state: XState | null; reload(): void } {
  const [state, setState] = useState<XState | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    void window.xbot.x.getState().then((result) => {
      if (result.ok) setState(result.data);
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const offAccounts = window.xbot.events.on('x:accounts-changed', reload);
    const offSettings = window.xbot.events.on('settings:changed', ({ key }) => {
      if (key.startsWith('x.')) reload();
    });
    return () => {
      offAccounts();
      offSettings();
    };
  }, [enabled, reload]);

  return { state: enabled ? state : null, reload };
}

/** What a connect attempt says to the user; null for a quiet end (canceled, timed out). */
export async function connectX(reconnectAccountId?: string): Promise<{ tone: 'neutral' | 'warning'; text: string; code?: string } | null> {
  const result = await window.xbot.x.connect(reconnectAccountId);
  if (result.ok) return { tone: result.data.notice ? 'warning' : 'neutral', text: result.data.notice ?? `@${result.data.account.handle} connected` };
  if (result.error.code === 'x_connect_canceled') return null;
  return { tone: 'warning', text: result.error.message, code: result.error.code };
}
