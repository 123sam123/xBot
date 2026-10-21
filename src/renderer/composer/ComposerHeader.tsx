import { AppMark } from '../design-system';
import { AccountMenu, type AccountState } from './AccountMenu';

export function ComposerHeader({ account, onConnect }: { account: AccountState; onConnect?: () => void }) {
  return (
    <header className="composer-header">
      <AppMark size={30} />
      <span className="composer-name">xBot</span>
      <AccountMenu account={account} onConnect={onConnect} />
    </header>
  );
}
