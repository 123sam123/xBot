import { useRef } from 'react';
import { AppMark, Menu, popovers, usePopoverOpen, type MenuItem } from '../design-system';
import type { AccountAction, AccountMenuEntry } from './account/accountMenu';
import { AccountMenu, type AccountState } from './AccountMenu';

const APP_MENU_ID = 'app-menu';

/**
 * The header. The xBot mark and name are the app menu's trigger (New draft,
 * Draft history…, Settings…), so the default view stays as in the reference.
 */
export function ComposerHeader({
  account,
  onConnect,
  menuItems = [],
  accountEntries,
  onAccountAction,
}: {
  account: AccountState;
  onConnect?: () => void;
  menuItems?: readonly MenuItem[];
  /** The real X accounts' menu (T9); see AccountMenu. */
  accountEntries?: readonly AccountMenuEntry[];
  onAccountAction?(action: AccountAction): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const open = usePopoverOpen(APP_MENU_ID);
  return (
    <header className="composer-header">
      <button
        ref={anchor}
        type="button"
        className="app-menu-trigger"
        data-testid="app-menu-trigger"
        aria-label="xBot menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => popovers.toggle(APP_MENU_ID)}
      >
        <AppMark size={30} />
        <span className="composer-name">xBot</span>
      </button>
      <Menu id={APP_MENU_ID} anchor={anchor} label="xBot" items={menuItems} placement="bottom-start" testId="app-menu" />
      <AccountMenu account={account} onConnect={onConnect} entries={accountEntries} onAction={onAccountAction} />
    </header>
  );
}
