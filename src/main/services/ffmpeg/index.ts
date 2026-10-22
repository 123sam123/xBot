// Owned by T5 (XBOT-G66JJK). The FFmpeg this Mac has, shared by media posters,
// the import probe and the Studio's video exports. Registered before `media`.
import { app } from 'electron';
import type { FfmpegStatus } from '../../../shared/contracts/studio';
import type { Db } from '../../db';
import { registerStatusProvider, statusChanged } from '../../status';
import type { ServiceContext, ServiceModule } from '../types';
import { locateFfmpeg, MISSING_MESSAGES, type FfmpegBinaries } from './locate';

export interface FfmpegService {
  /** The cached status; 'checking' until the first check finishes. */
  status(): FfmpegStatus;
  /** The binaries once a check in progress settles; null when FFmpeg is missing. */
  binaries(): Promise<FfmpegBinaries | null>;
  /** Looks again ("Check again"). */
  recheck(): Promise<FfmpegStatus>;
  /** Uses the program the user picked (Locate FFmpeg…), or the automatic search for null. */
  setUserPath(path: string | null): Promise<FfmpegStatus>;
}

/**
 * The user's pick lives in the settings table under a key that is not in the
 * settings registry, so `settings:set` (any registry key) can't reach it: the
 * renderer must never choose what main spawns. It is stored as picked and
 * re-validated at every check, which survives `brew upgrade` moving Homebrew's
 * versioned folder.
 */
const USER_PATH_KEY = 'studio.ffmpegPath';

let instance: FfmpegService | null = null;
let unregisterStatus: (() => void) | null = null;

export function ffmpeg(): FfmpegService {
  if (!instance) throw new Error('ffmpeg service used before initServices()');
  return instance;
}

function userPathStore(db: Db) {
  const select = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');
  return {
    get(): string | null {
      const row = select.get(USER_PATH_KEY);
      if (!row) return null;
      try {
        const value: unknown = JSON.parse(row.value);
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    set(path: string | null): void {
      if (path === null) remove.run(USER_PATH_KEY);
      else upsert.run(USER_PATH_KEY, JSON.stringify(path));
    },
  };
}

export function createFfmpegService(ctx: Pick<ServiceContext, 'db' | 'events' | 'log'>, { disabled = false }: { disabled?: boolean } = {}): FfmpegService {
  const store = userPathStore(ctx.db);
  let status: FfmpegStatus = { state: 'checking' };
  let binaries: FfmpegBinaries | null = null;
  let pending: Promise<FfmpegStatus> | null = null;

  const publish = (next: FfmpegStatus) => {
    status = next;
    ctx.events.emit('studio:ffmpeg', next);
    statusChanged();
  };

  function check(): Promise<FfmpegStatus> {
    if (pending) return pending;
    const run = (async (): Promise<FfmpegStatus> => {
      if (disabled) return { state: 'missing', reason: 'disabled', message: MISSING_MESSAGES.disabled };
      const result = await locateFfmpeg({
        userPath: store.get(),
        resourcesPath: process.resourcesPath ?? null,
        env: process.env,
        platform: process.platform,
      });
      if (result.state !== 'ready') {
        binaries = null;
        ctx.log.warn('ffmpeg: not available', result.reason, result.message);
        return result;
      }
      binaries = result.binaries;
      ctx.log.info('ffmpeg: ready', result.binaries.ffmpeg, result.binaries.version, result.binaries.encoder);
      return { state: 'ready', version: result.binaries.version, encoder: result.binaries.encoder, path: result.binaries.ffmpeg };
    })()
      .catch((err: unknown): FfmpegStatus => {
        ctx.log.error('ffmpeg: check failed', err);
        binaries = null;
        return { state: 'missing', reason: 'not-found', message: MISSING_MESSAGES['not-found'] };
      })
      .then((next) => {
        pending = null;
        publish(next);
        return next;
      });
    pending = run;
    return run;
  }

  // In the background: startup never waits for FFmpeg.
  void check();

  return {
    status: () => status,
    async binaries() {
      if (pending) await pending;
      return binaries;
    },
    recheck: () => (pending ? pending.then(check) : check()),
    async setUserPath(path) {
      if (pending) await pending;
      store.set(path);
      return check();
    },
  };
}

export const ffmpegModule: ServiceModule = {
  name: 'ffmpeg',
  init(ctx) {
    // Test seam: e2e runs simulate a Mac without FFmpeg. Unpackaged builds only.
    const disabled = !app.isPackaged && process.env.XBOT_E2E_NO_FFMPEG === '1';
    instance = createFfmpegService(ctx, { disabled });
    unregisterStatus = registerStatusProvider({
      id: 'ffmpeg',
      order: 92,
      get: () => {
        const current = instance?.status();
        if (current?.state !== 'missing') return null;
        const label = current.reason === 'not-found' || current.reason === 'no-ffprobe' ? 'FFmpeg not found' : 'FFmpeg can’t export video';
        return { id: 'ffmpeg', label, tone: 'warning', detail: current.message };
      },
    });
  },
  dispose() {
    unregisterStatus?.();
    instance = null;
    unregisterStatus = null;
  },
};
