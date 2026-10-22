-- Screen recordings (Phase 2 of the Cap-style Studio). A recording's video is
-- imported as the document's source media; this row keeps the rest of it: the
-- folder under userData/recordings with the camera video, the cursor data and
-- images, and its metadata (capture size, audio tracks, camera sync) as JSON.
-- Depends on 202610220100_studio_documents, which sorts first.
CREATE TABLE recordings (
  id         TEXT PRIMARY KEY,
  dir        TEXT NOT NULL,
  meta_json  TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The recording a document was made from; NULL for imported media.
ALTER TABLE studio_documents ADD COLUMN recording_id TEXT REFERENCES recordings (id) ON DELETE SET NULL;
CREATE INDEX studio_documents_recording ON studio_documents (recording_id);
