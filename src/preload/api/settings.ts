import type { SettingsApi } from '../../shared/contracts/settings';
import { settingsChannels } from '../../shared/contracts/settings.channels';
import { invoke } from '../invoke';

export const settings: SettingsApi = {
  getAll: () => invoke(settingsChannels.getAll),
  set: (key, value) => invoke(settingsChannels.set, { key, value }),
};
