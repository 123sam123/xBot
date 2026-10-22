import { useRef, type ReactNode } from 'react';
import { AppMark, Menu, popovers, usePopoverOpen, type MenuItem } from '../design-system';
import { AccountMenu, type AccountState } from './AccountMenu';

const APP_MENU_ID = 'app-menu';

/**
 * The header. The xBot mark and name are the app menu's trigger (New draft,
 * Draft history…, Settings…), so the default view stays as in the reference.
 * `aiMenu` (T6's ✦ button) sits just left of the account control, and
 * `ideas` (T7's bulb) just left of that.
 */
export function ComposerHeader({
  account,
  onConnect,
  menuItems = [],
  aiMenu,
  ideas,
}: {
  account: AccountState;
  onConnect?: () => void;
  menuItems?: readonly MenuItem[];
  aiMenu?: ReactNode;
  ideas?: ReactNode;
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
      {ideas}
      {aiMenu}
      <AccountMenu account={account} onConnect={onConnect} />
    </header>
  );
}
