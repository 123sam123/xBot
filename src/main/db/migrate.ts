import type { Database } from 'better-sqlite3';
import type { Logger } from '../log';

// No `electron` import here: this module runs under Vitest too.

export interface Migration {
  /** File name without `.sql`: `<YYYYMMDDHHmm>_<domain>_<slug>`. */
  id: string;
  sql: string;
}

/**
 * Applies every migration whose id is not yet in `schema_migrations` — by
 * missing id, not "newer than the last one", because branches merge out of
 * timestamp order — in filename order, all in one transaction.
 *
 * Foreign keys are switched off for the batch (SQLite ignores the pragma
 * inside a transaction), so a table rebuild's DROP cannot cascade-delete
 * child rows; `foreign_key_check` must come back empty before COMMIT, and the
 * pragma is switched back on afterwards. Any failure rolls the whole batch back.
 */
export function migrate(db: Database, migrations: readonly Migration[], log?: Logger): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').pluck().all() as string[]);
  const known = new Set(migrations.map((m) => m.id));
  for (const id of applied) {
    if (!known.has(id)) log?.warn(`migrate: ${id} is in the database but not in this build; ignoring it`);
  }

  const pending = migrations.filter((m) => !applied.has(m.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (pending.length === 0) return [];

  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const m of pending) {
        db.exec(m.sql);
        record.run(m.id, new Date().toISOString());
      }
      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) {
        throw new Error(`migrate: foreign key check failed after ${pending.at(-1)?.id}: ${JSON.stringify(violations)}`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  log?.info(`migrate: applied ${pending.map((m) => m.id).join(', ')}`);
  return pending.map((m) => m.id);
}
