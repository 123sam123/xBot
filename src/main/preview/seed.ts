import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Composition } from '../../shared/composition/model';
import type { StudioDocument } from '../../shared/contracts/studio';
import {
  PREVIEW_DRAFT_TEXT,
  PREVIEW_FIXTURES,
  PREVIEW_IDEA,
  PREVIEW_VIDEO_DRAFT_TEXT,
  previewStudioComposition,
  previewThumbnailComposition,
} from '../../shared/previewSample';
import type { Db } from '../db';
import type { Logger } from '../log';
import type { DraftsService } from '../services/drafts/service';
import type { FfmpegBinaries } from '../services/ffmpeg/locate';
import type { MediaService } from '../services/media/service';
import type { StudioService } from '../services/studio/service';

// Preview mode's sample data (T10). A fresh preview userData gets, through
// the services' own code paths (imports, Studio documents, Add to post):
//
// 1. an older draft with the sample video and, when FFmpeg is there, its
//    Studio document with the reference's framing and trim;
// 2. the current draft with the reference's text and the framed screenshot,
//    a real Studio export of the screenshot's document;
// 3. one stored idea, labelled "Preview sample";
// 4. the Studio showing the video document (else the screenshot's).
//
// It runs once per preview userData (no media yet and no `preview.seededAt`),
// on the drafts queue, before the first window. A step that fails is logged
// and skipped: preview mode then shows less, never something fake. No
// `electron` import: app.ts passes in the services and the fixtures folder.

/** A raw `settings` row outside the registry, like T5's `studio.ffmpegPath`, so `settings:set` can't reach it. */
export const SEEDED_KEY = 'preview.seededAt';

export interface PreviewSeedDeps {
  db: Db;
  log: Logger;
  /** `<resources>/fixtures` when packaged, `<app>/resources/fixtures` otherwise. */
  fixturesDir: string;
  drafts: Pick<DraftsService, 'getCurrent' | 'update' | 'startNew'>;
  media: Pick<MediaService, 'importFiles'>;
  studio: Pick<StudioService, 'openForAttachment' | 'save' | 'addToPost'>;
  ffmpeg(): Promise<FfmpegBinaries | null>;
  setStudioDocument(documentId: string, openedFromAttachmentId: string | null): void;
}

/** True for a preview userData that was never seeded and holds no media. */
export function needsPreviewSeed(db: Db): boolean {
  const media = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM media').get()!.n;
  const seeded = db.prepare<[string], { key: string }>('SELECT key FROM settings WHERE key = ?').get(SEEDED_KEY);
  return media === 0 && !seeded;
}

export async function seedPreview(deps: PreviewSeedDeps): Promise<'seeded' | 'skipped'> {
  const { db, log, drafts, media, studio } = deps;
  if (!needsPreviewSeed(db)) return 'skipped';

  /** Imports a fixture onto the draft through the normal import path; the new attachment's id, or null. */
  const attach = async (draftId: string, name: string): Promise<string | null> => {
    const path = join(deps.fixturesDir, name);
    if (!existsSync(path)) {
      log.warn('preview: fixture missing', path);
      return null;
    }
    const { draft, rejected } = await media.importFiles(draftId, [{ name, path }]);
    if (rejected.length > 0) {
      log.warn('preview: fixture rejected', name, rejected[0]!.message);
      return null;
    }
    return draft.attachments.at(-1)?.id ?? null;
  };

  /** Opens the attachment's Studio document and gives it `make`'s composition; the saved document and revision. */
  const style = async (draftId: string, attachmentId: string, make: (doc: StudioDocument) => Composition) => {
    const opened = await studio.openForAttachment(draftId, attachmentId);
    if (!('document' in opened)) return null;
    const composition = make(opened.document);
    const { revision } = studio.save(opened.document.id, opened.document.revision, composition);
    return { id: opened.document.id, revision, composition };
  };

  // 1. The older draft: the video, styled as in the reference when FFmpeg can open it.
  let videoDocument: string | null = null;
  const videoDraft = drafts.getCurrent();
  drafts.update(videoDraft.id, PREVIEW_VIDEO_DRAFT_TEXT);
  const video = await attach(videoDraft.id, PREVIEW_FIXTURES.video);
  if (video && (await deps.ffmpeg())) {
    try {
      const styled = await style(videoDraft.id, video, (doc) =>
        previewStudioComposition(doc.composition.source, doc.video ? { durationMs: doc.video.durationMs } : undefined),
      );
      videoDocument = styled?.id ?? null;
    } catch (err) {
      log.warn('preview: the sample video has no Studio document', err);
    }
  }

  // 2. The current draft: the reference's text and the framed screenshot.
  let imageDocument: string | null = null;
  let framed = false;
  const imageDraft = drafts.startNew();
  drafts.update(imageDraft.id, PREVIEW_DRAFT_TEXT);
  const screenshot = await attach(imageDraft.id, PREVIEW_FIXTURES.screenshot);
  if (screenshot) {
    const styled = await style(imageDraft.id, screenshot, (doc) => previewThumbnailComposition(doc.composition.source)).catch((err: unknown) => {
      log.warn('preview: the sample screenshot has no Studio document', err);
      return null;
    });
    imageDocument = styled?.id ?? null;
    const framedFile = join(deps.fixturesDir, PREVIEW_FIXTURES.framed);
    if (styled && existsSync(framedFile)) {
      try {
        // The Studio's own Add to post: checks the PNG against the composition's export layout, stores it and swaps it in.
        await studio.addToPost({
          documentId: styled.id,
          baseRevision: styled.revision,
          composition: styled.composition,
          bytes: await readFile(framedFile),
          openedFromAttachmentId: screenshot,
        });
        framed = true;
      } catch (err) {
        log.warn('preview: kept the plain screenshot; the framed fixture no longer matches its composition (run pnpm fixtures)', err);
      }
    }
  }

  // 3. One idea, labelled as a sample. Finding new ideas stays off in preview.
  const at = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO suggestions (id, project_id, kind, text, sources_json, claims_json, flags_json, source_key, fingerprint, status, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 'preview-sample', 'preview-sample', 'new', ?, ?)`,
  ).run(
    randomUUID(),
    PREVIEW_IDEA.kind,
    PREVIEW_IDEA.text,
    JSON.stringify(PREVIEW_IDEA.sources),
    JSON.stringify(PREVIEW_IDEA.claims),
    JSON.stringify({ phrases: [], hashtagsStripped: [] }),
    at,
    at,
  );

  // 4. What the Studio shows first.
  const shown = videoDocument ?? imageDocument;
  if (shown) deps.setStudioDocument(shown, null);

  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SEEDED_KEY, JSON.stringify(at), at);
  log.info('preview: seeded', { video: video !== null, videoDocument: videoDocument !== null, screenshot: screenshot !== null, framed });
  return 'seeded';
}
