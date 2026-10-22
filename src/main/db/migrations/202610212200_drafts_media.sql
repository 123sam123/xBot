-- Drafts, imported media and the attachments that put media on a draft (T3).

-- At most one draft is current: the one the composer edits. The rest are history.
CREATE TABLE drafts (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL DEFAULT '',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX drafts_single_current ON drafts (is_current) WHERE is_current = 1;
CREATE INDEX drafts_updated_at ON drafts (updated_at);

-- One row per imported file, deduplicated by content. `path` and `thumb_path`
-- are relative to userData/media. Every table that refers to media must do so
-- with a declared foreign key to media(id): the startup GC deletes rows that
-- no foreign key points at (see ARCHITECTURE.md → "Media").
CREATE TABLE media (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  path          TEXT NOT NULL UNIQUE,
  mime          TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  bytes         INTEGER NOT NULL,
  sha256        TEXT NOT NULL UNIQUE,
  thumb_path    TEXT,
  original_name TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- A draft's media, in post order. Positions are renumbered through negative
-- values, so there is deliberately no `position >= 0` check. T4 adds
-- `studio_document_id TEXT REFERENCES studio_documents(id)` with ALTER TABLE.
CREATE TABLE draft_attachments (
  id         TEXT PRIMARY KEY,
  draft_id   TEXT NOT NULL REFERENCES drafts (id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL REFERENCES media (id),
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, position)
);
CREATE INDEX draft_attachments_media ON draft_attachments (media_id);
