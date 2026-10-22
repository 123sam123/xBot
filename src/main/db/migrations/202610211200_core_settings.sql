-- Key/value settings. `value` is JSON; the typed settings service validates it
-- against the per-domain schemas in src/shared/contracts/.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
