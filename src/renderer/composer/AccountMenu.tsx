import { useRef } from 'react';
import { ChevronDownIcon, Menu, popovers, usePopoverOpen, type MenuItem } from '../design-system';

export type AccountState =
  | { kind: 'disconnected' }
  /** A real, connected X account (T9). */
  | { kind: 'connected'; handle: string }
  /** Preview mode's labelled sample handle. */
  | { kind: 'preview'; handle: string };

const MENU_ID = 'account-menu';

/**
 * The header's account control. Disconnected it reads "Connect X"; there is
 * no fake connected state, and the sample handle exists only in preview mode,
 * always labelled.
 */
export function AccountMenu({ account, onConnect }: { account: AccountState; onConnect?: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const open = usePopoverOpen(MENU_ID);

  const items: MenuItem[] =
    account.kind === 'disconnected'
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
        : [{ id: 'account', label: account.handle, detail: 'Connected to X', disabled: true }];

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
        <span className="account-handle">{account.kind === 'disconnected' ? 'Connect X' : account.handle}</span>
        {account.kind === 'preview' && <span className="badge">Preview</span>}
        <ChevronDownIcon size={24} className="account-chevron" />
      </button>
      <Menu id={MENU_ID} anchor={anchor} label="X account" items={items} testId="account-menu" />
    </>
  );
}
