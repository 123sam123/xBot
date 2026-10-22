-- X accounts and the publish pipeline (T9). Depends only on T3's `drafts` and
-- `media` tables (202610212200_drafts_media). See docs/X.md.

-- One row per connected X account. `token_blob` is safeStorage ciphertext of
-- the access/refresh token pair and is never stored any other way; it only
-- decrypts on the Mac that wrote it. `client_id` is the app the tokens were
-- issued to, which refresh and revoke must use. At most one account is active.
CREATE TABLE x_accounts (
  id                 TEXT PRIMARY KEY,
  x_user_id          TEXT NOT NULL UNIQUE,
  client_id          TEXT NOT NULL,
  handle             TEXT NOT NULL,
  name               TEXT NOT NULL,
  scopes             TEXT NOT NULL,
  token_blob         BLOB NOT NULL,
  token_expires_at   TEXT NOT NULL,
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  reconnect_required INTEGER NOT NULL DEFAULT 0 CHECK (reconnect_required IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX x_accounts_single_active ON x_accounts (is_active) WHERE is_active = 1;

-- One row per Post ↑ that got past validation. The account, text and media are
-- frozen here; the draft can change afterwards without changing what is posted.
-- `idempotency_key` hashes draft, account, text and media, so the same content
-- from the same draft maps to one job. `create_sent_at` is written (durably)
-- before each create request; `uncertain_since` is set while any create's
-- outcome is unknown and cleared only by a confirmed post or "Mark as not posted".
CREATE TABLE publish_jobs (
  id                  TEXT PRIMARY KEY,
  draft_id            TEXT REFERENCES drafts (id) ON DELETE SET NULL,
  account_id          TEXT REFERENCES x_accounts (id) ON DELETE SET NULL,
  account_x_user_id   TEXT NOT NULL,
  account_handle      TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  frozen_text         TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN (
                        'queued', 'uploading', 'processing', 'publishing',
                        'published', 'failed', 'canceled', 'needs_reconciliation')),
  progress_phase      TEXT CHECK (progress_phase IN ('upload', 'processing')),
  progress_percent    INTEGER,
  remote_post_id      TEXT,
  remote_url          TEXT,
  error_code          TEXT,
  error_detail        TEXT,
  rate_limit_reset_at TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  create_sent_at      TEXT,
  uncertain_since     TEXT,
  dismissed_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  finished_at         TEXT
);
-- A draft has at most one job in the active set: repeated clicks find it.
CREATE UNIQUE INDEX publish_jobs_one_active_per_draft ON publish_jobs (draft_id)
  WHERE status IN ('queued', 'uploading', 'processing', 'publishing', 'needs_reconciliation');
CREATE INDEX publish_jobs_status ON publish_jobs (status);
CREATE INDEX publish_jobs_account ON publish_jobs (account_id);

-- A job's frozen media, in post order. `media_id` is the declared foreign key
-- that keeps T3's startup GC from collecting the file while the job may still
-- upload it; it is nulled once the job is published, canceled or dismissed and
-- re-bound from `frozen_media_id` when the job is queued again.
CREATE TABLE publish_job_media (
  job_id            TEXT NOT NULL REFERENCES publish_jobs (id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  media_id          TEXT REFERENCES media (id),
  frozen_media_id   TEXT NOT NULL,
  mime              TEXT NOT NULL,
  bytes             INTEGER NOT NULL,
  name              TEXT NOT NULL,
  media_category    TEXT NOT NULL CHECK (media_category IN ('tweet_image', 'tweet_gif', 'tweet_video')),
  remote_state      TEXT NOT NULL DEFAULT 'none' CHECK (remote_state IN ('none', 'initialized', 'appended', 'finalized', 'ready')),
  remote_media_id   TEXT,
  remote_media_key  TEXT,
  remote_expires_at TEXT,
  PRIMARY KEY (job_id, position)
);
CREATE INDEX publish_job_media_media ON publish_job_media (media_id);

-- Every status change, append-only.
CREATE TABLE publish_job_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES publish_jobs (id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX publish_job_events_job ON publish_job_events (job_id);
