import type { XAccount, XState } from '../../../shared/contracts/x';

// What the header's account control shows, as data: the trigger's text and the
// menu's entries with the action each one runs. Pure, so it is unit-tested
// without React; AccountMenu turns the actions into calls.

export type AccountAction =
  | { kind: 'connect' }
  | { kind: 'cancel-connect' }
  | { kind: 'switch'; accountId: string }
  | { kind: 'reconnect'; accountId: string }
  | { kind: 'disconnect'; accountId: string }
  | { kind: 'settings' };

export interface AccountMenuEntry {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  /** Set on account rows only: the active one is checked. */
  checked?: boolean;
  action?: AccountAction;
}

export type AccountTrigger = { kind: 'disconnected' } | { kind: 'connecting' } | { kind: 'connected'; handle: string; reconnect: boolean };

export function activeAccount(state: Pick<XState, 'accounts'> | null): XAccount | null {
  return state?.accounts.find((a) => a.active) ?? null;
}

export function accountTrigger(state: XState | null): AccountTrigger {
  if (state?.connecting) return { kind: 'connecting' };
  const active = activeAccount(state);
  return active ? { kind: 'connected', handle: `@${active.handle}`, reconnect: active.reconnectRequired } : { kind: 'disconnected' };
}

export function accountMenuEntries(state: XState | null): AccountMenuEntry[] {
  if (!state) return [{ id: 'loading', label: 'Loading your X accounts…', disabled: true }];
  if (state.connecting) {
    return [
      { id: 'waiting', label: 'Waiting for X in your browser…', detail: 'Approve xBot there, then come back.', disabled: true },
      { id: 'cancel-connect', label: 'Cancel sign-in', action: { kind: 'cancel-connect' } },
    ];
  }
  const connect: AccountMenuEntry = state.clientIdSet
    ? { id: 'connect', label: state.accounts.length > 0 ? 'Add another account…' : 'Connect X account', detail: state.accounts.length > 0 ? 'Switch accounts on x.com first.' : 'Opens X in your browser.', action: { kind: 'connect' } }
    : { id: 'setup', label: 'Set up X posting…', detail: 'Add your X app’s Client ID first.', action: { kind: 'settings' } };
  if (state.accounts.length === 0) return [connect];

  const entries: AccountMenuEntry[] = state.accounts.map((a) => ({
    id: `account-${a.id}`,
    label: `@${a.handle}`,
    detail: a.reconnectRequired ? 'Needs to sign in again' : a.active ? 'Posting as this account' : undefined,
    checked: a.active,
    action: a.active ? undefined : { kind: 'switch', accountId: a.id },
  }));
  const active = activeAccount(state);
  if (active?.reconnectRequired) {
    entries.push({ id: 'reconnect', label: `Reconnect @${active.handle}`, detail: 'Signs in again in your browser.', action: { kind: 'reconnect', accountId: active.id } });
  }
  entries.push(connect);
  if (active) entries.push({ id: 'disconnect', label: `Disconnect @${active.handle}`, detail: 'Removes its tokens from this Mac.', action: { kind: 'disconnect', accountId: active.id } });
  return entries;
}
