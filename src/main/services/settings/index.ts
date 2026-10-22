import {
  settingKeys,
  settingsRegistry,
  type SettingKey,
  type SettingValue,
  type SettingsValues,
} from '../../../shared/contracts/settings';
import type { Db } from '../../db';
import type { ServiceContext, ServiceModule } from '../types';

export interface SettingsService {
  get<K extends SettingKey>(key: K): SettingValue<K>;
  getAll(): SettingsValues;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void;
}

export function createSettingsService(db: Db, ctx: Pick<ServiceContext, 'events' | 'log'>): SettingsService {
  const select = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  function get<K extends SettingKey>(key: K): SettingValue<K> {
    const def = settingsRegistry[key];
    const row = select.get(key);
    if (!row) return def.default as SettingValue<K>;
    const parsed = def.schema.safeParse(JSON.parse(row.value));
    if (parsed.success) return parsed.data as SettingValue<K>;
    ctx.log.warn(`settings: stored value for ${key} no longer matches its schema; using the default`);
    return def.default as SettingValue<K>;
  }

  return {
    get,
    getAll() {
      return Object.fromEntries(settingKeys.map((key) => [key, get(key)])) as SettingsValues;
    },
    set(key, value) {
      const parsed = settingsRegistry[key].schema.parse(value);
      upsert.run(key, JSON.stringify(parsed));
      ctx.events.emit('settings:changed', { key, value: parsed });
    },
  };
}

let instance: SettingsService | null = null;

export function settings(): SettingsService {
  if (!instance) throw new Error('settings service used before initServices()');
  return instance;
}

export const settingsModule: ServiceModule = {
  name: 'settings',
  init(ctx) {
    instance = createSettingsService(ctx.db, ctx);
  },
  dispose() {
    instance = null;
  },
};
