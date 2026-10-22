import { basename } from 'node:path';
import Database from 'better-sqlite3';
import type { Migration } from './migrate';

// No `electron` import here: this module runs under Vitest too.

export type Db = Database.Database;

export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

/** Every `migrations/*.sql` file, embedded into the bundle at build time. */
export function bundledMigrations(): Migration[] {
  const files = import.meta.glob<string>('./migrations/*.sql', { query: '?raw', import: 'default', eager: true });
  return Object.entries(files).map(([path, sql]) => ({ id: basename(path, '.sql'), sql }));
}
