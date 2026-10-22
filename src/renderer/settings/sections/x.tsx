import { useAppInfo } from '../../common/useAppInfo';
import { XSetup } from '../../composer/account/XSetup';
import type { SettingsSection } from '../registry';

/** Settings → X: the user-owned developer-app setup, the callback, and connected accounts (T9). Hidden in preview. */
function X() {
  const { info } = useAppInfo();
  if (!info || info.isPreview) return null;
  return <XSetup variant="settings" />;
}

const section: SettingsSection = { id: 'x', order: 40, title: 'X', Component: X };
export default section;
