import type { Db } from './index';

// A transaction that survives power loss once it returns. The app runs with
// `synchronous=NORMAL` (ARCHITECTURE.md → Database), where a WAL commit can be
// rolled back by a power cut. For the few writes that must never be lost —
// "a create-post request is about to be sent" — this runs the transaction with
// `synchronous=FULL` and F_FULLFSYNC (macOS), then restores the defaults.
// SQLite refuses to change the pragma inside a transaction, so this is never
// called from inside one, and never nested. No `electron` import.

export function durable<T>(db: Db, fn: () => T): T {
  if (db.inTransaction) throw new Error('durable() must not run inside a transaction');
  db.pragma('synchronous = FULL');
  db.pragma('fullfsync = ON');
  try {
    return db.transaction(fn)();
  } finally {
    db.pragma('fullfsync = OFF');
    db.pragma('synchronous = NORMAL');
  }
}
