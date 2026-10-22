-- Video in the Media Studio (T5): MP4 exports, a video document's source facts,
-- and the export jobs that make them. Depends on 202610220100_studio_documents
-- (studio_documents, studio_exports) and 202610212200_drafts_media (drafts),
-- which sort first.

-- studio_exports now also holds MP4s. SQLite can't alter a CHECK, so the table
-- is rebuilt in the documented order (create, copy, drop, rename, indexes).
-- Nothing references studio_exports yet; export_jobs below does, so it comes after.
CREATE TABLE new_studio_exports (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES studio_documents (id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL REFERENCES media (id),
  format      TEXT NOT NULL CHECK (format IN ('png', 'jpeg', 'mp4')),
  scale       INTEGER NOT NULL CHECK (scale IN (1, 2)),
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
INSERT INTO new_studio_exports (id, document_id, media_id, format, scale, width, height, created_at)
  SELECT id, document_id, media_id, format, scale, width, height, created_at FROM studio_exports;
DROP TABLE studio_exports;
ALTER TABLE new_studio_exports RENAME TO studio_exports;
CREATE INDEX studio_exports_document ON studio_exports (document_id);
CREATE INDEX studio_exports_media ON studio_exports (media_id);

-- What ffprobe read when a video document was created (VideoInfo JSON): the
-- display size, duration, streams and colour. NULL for image documents.
ALTER TABLE studio_documents ADD COLUMN source_video_json TEXT;

-- One MP4 export at a time, in order. `export_id` points at the stored export
-- rather than at its media: the media cleanup keeps every row a foreign key
-- points at, so a job must not pin its output (studio_exports is pruned when no
-- draft uses it). `pid` and `output_path` (relative to tmp/) let the next start
-- kill an FFmpeg that outlived a crash.
CREATE TABLE export_jobs (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES studio_documents (id) ON DELETE CASCADE,
  draft_id    TEXT REFERENCES drafts (id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('video')),
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  progress    REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  error       TEXT,
  export_id   TEXT REFERENCES studio_exports (id) ON DELETE SET NULL,
  pid         INTEGER,
  output_path TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX export_jobs_document ON export_jobs (document_id);
CREATE INDEX export_jobs_draft ON export_jobs (draft_id);
CREATE INDEX export_jobs_export ON export_jobs (export_id);
CREATE INDEX export_jobs_status ON export_jobs (status);
