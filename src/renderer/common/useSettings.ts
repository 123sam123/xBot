import { useEffect, useState } from 'react';
import type { SettingKey, SettingValue, SettingsValues } from '../../shared/contracts/settings';

/**
 * All settings, kept current through the forwarded `settings:changed` event.
 * `ready` turns true when the first read settles, even if it failed.
 */
export function useSettings(): { values: SettingsValues | null; ready: boolean } {
  const [state, setState] = useState<{ values: SettingsValues | null; ready: boolean }>({ values: null, ready: false });
  useEffect(() => {
    let alive = true;
    void window.xbot.settings.getAll().then((result) => {
      if (alive) setState({ values: result.ok ? result.data : null, ready: true });
    });
    const off = window.xbot.events.on('settings:changed', ({ key, value }) =>
      setState((prev) => (prev.values ? { ...prev, values: { ...prev.values, [key]: value } } : prev)),
    );
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): void {
  void window.xbot.settings.set(key, value).then((result) => {
    if (!result.ok) console.error(`settings: could not set ${key}`, result.error);
  });
}
