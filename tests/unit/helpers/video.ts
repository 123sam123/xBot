import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledMigrations, openDatabase, type Db } from '../../../src/main/db';
import { migrate } from '../../../src/main/db/migrate';
import { appPaths, prepareUserData, type AppPaths } from '../../../src/main/paths';
import { createDraftsService, type DraftsService } from '../../../src/main/services/drafts/service';
import { createSerialQueue } from '../../../src/main/services/drafts/queue';
import type { FfmpegBinaries } from '../../../src/main/services/ffmpeg/locate';
import { probeVideo } from '../../../src/main/services/ffmpeg/probe';
import { createMediaService, type MediaService } from '../../../src/main/services/media/service';
import { createStudioService, type StudioService } from '../../../src/main/services/studio/service';
import type { ServiceContext } from '../../../src/main/services/types';
import type { ExportJob } from '../../../src/shared/contracts/studio';
import { silent } from './videoFixtures';

// The real electron-free drafts, media and studio services on a migrated
// userData, for the Vitest video tests. Fixtures and readers: videoFixtures.ts.

export * from './videoFixtures';

export interface Harness {
  userData: string;
  paths: AppPaths;
  db: Db;
  events: ServiceContext['events'];
  drafts: DraftsService;
  media: MediaService;
  studio: StudioService;
  close(): void;
}

/** The real drafts, media and studio services on a fresh, migrated userData; FFmpeg is `bins` (or missing for null). */
export async function harness(bins: FfmpegBinaries | null, { realtime = false }: { realtime?: boolean } = {}): Promise<Harness> {
  const userData = mkdtempSync(join(tmpdir(), 'xbot-video-'));
  const paths = appPaths(userData);
  prepareUserData(paths);
  const db = openDatabase(paths.db);
  migrate(db, bundledMigrations());
  const events = new EventEmitter() as ServiceContext['events'];
  const drafts = createDraftsService(db, { events });
  const media = createMediaService({
    db,
    paths,
    log: silent,
    tools: { makeThumbnail: async () => false, inspectVideo: async (file) => (bins ? probeVideo(bins.ffprobe, file) : null) },
    drafts,
  });
  await media.init();
  const studio = createStudioService({
    db,
    paths,
    log: silent,
    media,
    drafts,
    events,
    video: { binaries: async () => bins },
    serialize: createSerialQueue(),
    realtime,
  });
  await studio.init(null);
  return {
    userData,
    paths,
    db,
    events,
    drafts,
    media,
    studio,
    close() {
      studio.dispose();
      db.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** Resolves with the job once `done` holds for one of its `export:progress` events. */
export function waitForJob(events: ServiceContext['events'], jobId: string, done: (job: ExportJob) => boolean = (job) => job.status !== 'queued' && job.status !== 'running'): Promise<ExportJob> {
  return new Promise((resolve) => {
    const listener = ({ job }: { job: ExportJob }) => {
      if (job.id !== jobId || !done(job)) return;
      events.off('export:progress', listener);
      resolve(job);
    };
    events.on('export:progress', listener);
  });
}

/** The file of the current draft's attachment that holds `documentId`'s export. */
export function exportedFile(h: Harness, documentId: string): string {
  const path = h.db
    .prepare(
      `SELECT m.path FROM draft_attachments a JOIN drafts d ON d.id = a.draft_id AND d.is_current = 1
       JOIN media m ON m.id = a.media_id WHERE a.studio_document_id = ?`,
    )
    .pluck()
    .get(documentId) as string;
  return join(h.paths.media, path);
}
