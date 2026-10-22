-- Reminder state (T8). One row: what the schedule needs to survive a restart
-- (src/shared/reminders/schedule.ts). Preferences live in `settings`; this is
-- what changes on every fire. Times are ISO-8601 UTC strings. Depends on
-- nothing else.
CREATE TABLE reminder_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  -- The interval counts from here: last fire, dismissal, unpause, cleared snooze or first run.
  interval_from      TEXT,
  last_fired_at      TEXT,
  last_dismissed_at  TEXT,
  snoozed_until      TEXT,
  snooze_kind        TEXT CHECK (snooze_kind IN ('snooze', 'skip')),
  -- The local date (YYYY-MM-DD, in the working-hours zone) `fired_count` counts.
  fired_count_date   TEXT,
  fired_count        INTEGER NOT NULL DEFAULT 0,
  last_published_at  TEXT,
  -- When a reminder last started an idea generation (T7's suggestions).
  last_generation_at TEXT,
  updated_at         TEXT NOT NULL
);

INSERT INTO reminder_state (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
