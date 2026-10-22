-- T7 (XBOT-5UVE6R): project context and story suggestions. Approved folders,
-- the events their scans produced (and the user's notes), the suggestions
-- generated from them, and the stories the user dismissed. Independent of
-- every other domain's migrations.
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  root_path       TEXT NOT NULL,
  root_realpath   TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  brief_json      TEXT NOT NULL CHECK (json_valid(brief_json)),
  options_json    TEXT NOT NULL CHECK (json_valid(options_json)),
  is_git          INTEGER NOT NULL DEFAULT 0 CHECK (is_git IN (0, 1)),
  scan_state      TEXT NOT NULL DEFAULT 'never' CHECK (scan_state IN ('never', 'ok', 'partial', 'missing', 'denied', 'error')),
  scan_note       TEXT,
  last_scan_at    TEXT,
  checkpoint_sha  TEXT,
  summary_hash    TEXT,
  summary_text    TEXT,
  doc_cache_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(doc_cache_json)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- project_id NULL: a note saved with "No project" (the general scope).
CREATE TABLE project_events (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('commit', 'doc', 'files', 'note')),
  source_ref    TEXT NOT NULL,
  summary       TEXT NOT NULL,
  detail_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  inferred      INTEGER NOT NULL CHECK (inferred IN (0, 1)),
  low_signal    INTEGER NOT NULL DEFAULT 0 CHECK (low_signal IN (0, 1)),
  fingerprint   TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  generated_at  TEXT,
  attempted_at  TEXT
);

-- A plain UNIQUE(project_id, fingerprint) would never match two NULL project ids.
CREATE UNIQUE INDEX project_events_fingerprint ON project_events (ifnull(project_id, ''), fingerprint);
CREATE INDEX project_events_unused ON project_events (project_id, generated_at);
CREATE INDEX project_events_created ON project_events (created_at);

CREATE TABLE suggestions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('problem_solved', 'feature_finished', 'before_after', 'bug_fix', 'funny_failure', 'lesson', 'demo', 'question')),
  text         TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 600),
  sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
  claims_json  TEXT NOT NULL CHECK (json_valid(claims_json)),
  flags_json   TEXT NOT NULL CHECK (json_valid(flags_json)),
  source_key   TEXT NOT NULL,
  fingerprint  TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'used', 'dismissed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX suggestions_status ON suggestions (status, created_at);

-- Not tied to projects: removing and re-adding a folder never brings a
-- dismissed story back. source_key hashes the folder's realpath (or
-- 'general') with the story's sorted source fingerprints, without its kind.
CREATE TABLE dismissed_suggestions (
  source_key  TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  text_norm   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX dismissed_suggestions_scope ON dismissed_suggestions (scope, created_at);
