import { useRef } from 'react';
import { ChevronDownIcon, Menu, popovers, usePopoverOpen, type MenuItem } from '../design-system';
import type { AccountAction, AccountMenuEntry } from './account/accountMenu';

export type AccountState =
  | { kind: 'disconnected' }
  /** A browser sign-in is waiting for X (T9). */
  | { kind: 'connecting' }
  /** A real, connected X account (T9); `reconnect` when its sign-in must be renewed. */
  | { kind: 'connected'; handle: string; reconnect?: boolean }
  /** Preview mode's labelled sample handle. */
  | { kind: 'preview'; handle: string };

const MENU_ID = 'account-menu';

/**
 * The header's account control. Disconnected it reads "Connect X"; there is
 * no fake connected state, and the sample handle exists only in preview mode,
 * always labelled. With `entries` (T9) the menu lists the real accounts and
 * runs each entry's action through `onAction`.
 */
export function AccountMenu({
  account,
  onConnect,
  entries,
  onAction,
}: {
  account: AccountState;
  onConnect?: () => void;
  entries?: readonly AccountMenuEntry[];
  onAction?(action: AccountAction): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const open = usePopoverOpen(MENU_ID);

  const items: MenuItem[] = entries
    ? entries.map((e) => ({
        id: e.id,
        label: e.label,
        detail: e.detail,
        disabled: e.disabled || (!e.action && e.checked === undefined),
        checked: e.checked,
        onSelect: e.action ? () => onAction?.(e.action!) : undefined,
      }))
    : account.kind === 'disconnected'
      ? [
          {
            id: 'connect',
            label: 'Connect X account',
            detail: onConnect ? undefined : 'X publishing isn’t set up in this build yet.',
            disabled: !onConnect,
            onSelect: onConnect,
          },
        ]
      : account.kind === 'preview'
        ? [{ id: 'sample', label: account.handle, detail: 'Sample account for preview mode. Nothing is connected.', disabled: true }]
        : account.kind === 'connecting'
          ? [{ id: 'connecting', label: 'Waiting for X in your browser…', disabled: true }]
          : [{ id: 'account', label: account.handle, detail: 'Connected to X', disabled: true }];

  const label = account.kind === 'disconnected' ? 'Connect X' : account.kind === 'connecting' ? 'Connecting…' : account.handle;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="account-trigger"
        data-testid="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => popovers.toggle(MENU_ID)}
      >
        <span className="account-handle">{label}</span>
        {account.kind === 'preview' && <span className="badge">Preview</span>}
        {account.kind === 'connected' && account.reconnect && <span className="badge badge-warning">Reconnect</span>}
        <ChevronDownIcon size={24} className="account-chevron" />
      </button>
      <Menu id={MENU_ID} anchor={anchor} label="X account" items={items} testId="account-menu" />
    </>
  );
}
