import { useAppInfo } from '../../common/useAppInfo';
import { ShortcutField, useStartup } from '../../composer/reminders';
import { Toggle } from '../../design-system';
import type { SettingsSection } from '../registry';

/** Settings → Startup and shortcut (T8): launch at login and the global shortcut. Hidden in preview. */
function Startup() {
  const { info } = useAppInfo();
  const preview = info?.isPreview ?? false;
  const { startup, set } = useStartup(!preview);
  if (!info || preview || !startup) return null;

  const login = startup.launchAtLogin;
  return (
    <>
      <Toggle
        label="Launch at login"
        description={login.note ?? 'xBot starts in the menu bar when you log in.'}
        checked={login.enabled}
        disabled={!login.available}
        onChange={(value) => {
          void window.xbot.reminders.setLaunchAtLogin(value).then((result) => result.ok && set(result.data));
        }}
      />
      <ShortcutField startup={startup} mac={info.platform === 'darwin'} onChange={set} />
    </>
  );
}

const section: SettingsSection = { id: 'startup', order: 90, title: 'Startup and shortcut', Component: Startup };
export default section;
