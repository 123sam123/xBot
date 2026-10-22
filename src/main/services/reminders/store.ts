// T8 (XBOT-8V5WV5): the one-row `reminder_state` table. Electron-free.
import type { ReminderState, SnoozeKind } from '../../../shared/reminders/schedule';
import type { Db } from '../../db';

interface Row {
  interval_from: string | null;
  last_fired_at: string | null;
  last_dismissed_at: string | null;
  snoozed_until: string | null;
  snooze_kind: SnoozeKind | null;
  fired_count_date: string | null;
  fired_count: number;
  last_published_at: string | null;
  last_generation_at: string | null;
}

export interface ReminderStore {
  read(): ReminderState;
  write(state: ReminderState): void;
}

const toMs = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};
const toIso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function createReminderStore(db: Db, now: () => number = Date.now): ReminderStore {
  const select = db.prepare<[], Row>(
    `SELECT interval_from, last_fired_at, last_dismissed_at, snoozed_until, snooze_kind, fired_count_date, fired_count,
            last_published_at, last_generation_at
     FROM reminder_state WHERE id = 1`,
  );
  // An upsert, so a row deleted by hand comes back instead of failing every write.
  const upsert = db.prepare(
    `INSERT INTO reminder_state (id, interval_from, last_fired_at, last_dismissed_at, snoozed_until, snooze_kind, fired_count_date,
                                 fired_count, last_published_at, last_generation_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       interval_from = excluded.interval_from, last_fired_at = excluded.last_fired_at,
       last_dismissed_at = excluded.last_dismissed_at, snoozed_until = excluded.snoozed_until,
       snooze_kind = excluded.snooze_kind, fired_count_date = excluded.fired_count_date,
       fired_count = excluded.fired_count, last_published_at = excluded.last_published_at,
       last_generation_at = excluded.last_generation_at, updated_at = excluded.updated_at`,
  );

  return {
    read() {
      const row = select.get();
      return {
        intervalFrom: toMs(row?.interval_from ?? null),
        lastFiredAt: toMs(row?.last_fired_at ?? null),
        lastDismissedAt: toMs(row?.last_dismissed_at ?? null),
        snoozedUntil: toMs(row?.snoozed_until ?? null),
        snoozeKind: row?.snoozed_until ? (row.snooze_kind ?? 'snooze') : null,
        firedCountDate: row?.fired_count_date ?? null,
        firedCount: row?.fired_count ?? 0,
        lastPublishedAt: toMs(row?.last_published_at ?? null),
        lastGenerationAt: toMs(row?.last_generation_at ?? null),
      };
    },
    write(state) {
      upsert.run(
        toIso(state.intervalFrom),
        toIso(state.lastFiredAt),
        toIso(state.lastDismissedAt),
        toIso(state.snoozedUntil),
        state.snoozedUntil === null ? null : (state.snoozeKind ?? 'snooze'),
        state.firedCountDate,
        state.firedCount,
        toIso(state.lastPublishedAt),
        toIso(state.lastGenerationAt),
        new Date(now()).toISOString(),
      );
    },
  };
}
