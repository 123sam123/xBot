-- Video exports are encoded in the renderer now (WebCodecs) and streamed to
-- main, so the FFmpeg export-job queue is gone. Its table goes with it.
-- Depends on 202610221200_studio_export_jobs, which sorts first.
DROP TABLE IF EXISTS export_jobs;
