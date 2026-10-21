import { z } from 'zod';
import { settingsChannels } from '../../shared/contracts/settings.channels';
import { setSettingSchema, type SettingKey, type SettingValue } from '../../shared/contracts/settings';
import { settings } from '../services/settings';
import { handle } from './register';

export function registerSettingsIpc(): void {
  handle(settingsChannels.getAll, z.undefined(), () => settings().getAll());
  handle(settingsChannels.set, setSettingSchema, ({ key, value }) => {
    settings().set(key as SettingKey, value as SettingValue<SettingKey>);
    return null;
  });
}
