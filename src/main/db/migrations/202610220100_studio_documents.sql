-- Media Studio documents, their exports and visual presets (T4).
-- Depends on 202610212200_drafts_media (media, draft_attachments), which sorts first.
--
-- Every reference to media is a declared foreign key, so the media cleanup
-- (which follows foreign keys) never deletes a source, a background image or
-- an export still in use.

-- One editable document per source image. The composition (shared/composition)
-- is JSON; `composition_backup` keeps the last unreadable JSON the defaults
-- replaced, and `revision` refuses stale saves. `background_media_id` mirrors
-- an image background.
CREATE TABLE studio_documents (
  id                  TEXT PRIMARY KEY,
  source_media_id     TEXT NOT NULL REFERENCES media (id),
  background_media_id TEXT REFERENCES media (id),
  composition_json    TEXT NOT NULL,
  composition_backup  TEXT,
  revision            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX studio_documents_source ON studio_documents (source_media_id);
CREATE INDEX studio_documents_background ON studio_documents (background_media_id);
CREATE INDEX studio_documents_updated_at ON studio_documents (updated_at);

-- A rendered PNG/JPEG of a document ("Add to post"). Rows no attachment uses
-- are deleted when a newer export replaces them.
CREATE TABLE studio_exports (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES studio_documents (id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL REFERENCES media (id),
  format      TEXT NOT NULL CHECK (format IN ('png', 'jpeg')),
  scale       INTEGER NOT NULL CHECK (scale IN (1, 2)),
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX studio_exports_document ON studio_exports (document_id);
CREATE INDEX studio_exports_media ON studio_exports (media_id);

-- Saved visual styles (frame, canvas, padding, shadow, background).
CREATE TABLE studio_presets (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  style_json          TEXT NOT NULL,
  background_media_id TEXT REFERENCES media (id),
  created_at          TEXT NOT NULL
);
CREATE INDEX studio_presets_background ON studio_presets (background_media_id);

-- The document an attachment was edited in: "Edit in Studio ↗" reopens it.
ALTER TABLE draft_attachments ADD COLUMN studio_document_id TEXT REFERENCES studio_documents (id) ON DELETE SET NULL;
CREATE INDEX draft_attachments_studio_document ON draft_attachments (studio_document_id);
