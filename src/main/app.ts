import { join } from 'node:path';
import { app, dialog } from 'electron';
import { bundledMigrations, openDatabase, type Db } from './db';
import { migrate } from './db/migrate';
import { appEvents, forwardEventsToRenderers } from './events';
import { registerIpc } from './ipc';
import { requestDraftFlush } from './ipc/drafts';
import { requestStudioFlush } from './ipc/studio';
import { log } from './log';
import { installAppMenu } from './menu';
import { isPreviewMode, type AppPaths } from './paths';
import { seedPreview } from './preview/seed';
import { handleMediaProtocol } from './protocols/media';
import { installSecurityHandlers } from './security';
import { disposeServices, initServices } from './services';
import { drafts } from './services/drafts';
import { draftsQueue } from './services/drafts/queue';
import { ffmpeg } from './services/ffmpeg';
import { media } from './services/media';
import { fireReminderNow, startReminders } from './services/reminders';
import { setStudioDocument, studio } from './services/studio';
import { settleXForQuit } from './services/x';
import { onStatusChanged } from './status';
import { createTray } from './tray';
import { applyAppearance, applyGlass, markQuitting } from './windows/common';
import { composerWindow, createComposerWindow, toggleComposer } from './windows/composer';
import { createStudioWindow, openStudio, studioWindow } from './windows/studio';

let db: Db | null = null;
/** How long quitting waits for the composer to save typed text and the Studio its edits. */
const QUIT_FLUSH_MS = 1000;
/** How long quitting waits for X to answer a create-post request already sent. */
const QUIT_X_MS = 10_000;

/** The Studio's bundled wallpapers: `<resources>/wallpapers` when packaged, `<app>/resources/wallpapers` otherwise. */
function wallpapersDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'wallpapers') : join(app.getAppPath(), 'resources', 'wallpapers');
}

function openAndMigrate(paths: AppPaths): Db | null {
  let opened: Db | null = null;
  try {
    opened = openDatabase(paths.db);
    migrate(opened, bundledMigrations(), log);
    return opened;
  } catch (err) {
    log.error('db: could not open or migrate', paths.db, err);
    opened?.close();
    // Show the problem and leave the file exactly as it is.
    dialog.showErrorBox(
      'xBot could not open its database',
      `${paths.db}\n\n${err instanceof Error ? err.message : String(err)}\n\nNothing was changed. xBot will quit.`,
    );
    return null;
  }
}

/**
 * Preview mode (T10): a fresh preview userData gets the sample drafts, media
 * and idea through the services' own paths (src/main/preview/seed.ts), on the
 * drafts queue. The first preview launch waits for it, FFmpeg's detection
 * included (at most its 15 s timeout).
 */
async function seedPreviewData(opened: Db): Promise<void> {
  if (!isPreviewMode(process.argv, process.env)) return;
  const fixturesDir = app.isPackaged ? join(process.resourcesPath, 'fixtures') : join(app.getAppPath(), 'resources', 'fixtures');
  try {
    await draftsQueue(() =>
      seedPreview({
        db: opened,
        log,
        fixturesDir,
        drafts: drafts(),
        media: media(),
        studio: studio(),
        ffmpeg: () => ffmpeg().binaries(),
        setStudioDocument,
      }),
    );
  } catch (err) {
    log.error('preview: seeding failed; preview mode starts with what it has', err);
  }
}

/** Everything after `app.whenReady()`, in the order ARCHITECTURE.md documents. */
export async function startApp(paths: AppPaths): Promise<void> {
  app.dock?.hide();

  db = openAndMigrate(paths);
  if (!db) {
    app.exit(1);
    return;
  }
  await initServices({ db, paths, events: appEvents, log });

  installSecurityHandlers();
  handleMediaProtocol({ media: paths.media, wallpapers: wallpapersDir() });
  registerIpc();
  forwardEventsToRenderers();
  onStatusChanged((statuses) => appEvents.emit('status:changed', { statuses }));
  await seedPreviewData(db);

  applyAppearance();
  createComposerWindow();
  createStudioWindow();
  // Settings → Appearance → Glass clarity applies live, to both windows.
  appEvents.on('settings:changed', ({ key }) => {
    if (key !== 'ui.glassClarity') return;
    for (const win of [composerWindow(), studioWindow()]) if (win) applyGlass(win);
  });
  createTray();
  installAppMenu();
  // Reminders need the windows (auto-open), the tray (its display) and the forwarded events.
  startReminders();

  app.on('second-instance', () => toggleComposer());
  app.on('activate', () => toggleComposer());
  // The first quit waits (at most QUIT_FLUSH_MS) for the composer to save text
  // and the Studio to save edits still inside their autosave debounce, and (at
  // most QUIT_X_MS, only while a create-post request is in flight) for X to
  // answer, then quits for real.
  let flushedForQuit = false;
  app.on('before-quit', (event) => {
    if (!flushedForQuit) {
      flushedForQuit = true;
      event.preventDefault();
      void Promise.all([requestDraftFlush(QUIT_FLUSH_MS), requestStudioFlush(QUIT_FLUSH_MS), settleXForQuit(QUIT_X_MS)]).finally(() => app.quit());
      return;
    }
    markQuitting();
  });
  app.on('will-quit', () => {
    // Services first (an import may still be finishing), then the database.
    void disposeServices().finally(() => {
      db?.close();
      db = null;
    });
  });
  // A menu-bar app keeps running with no windows.
  app.on('window-all-closed', () => {});

  if (!app.isPackaged && process.env.XBOT_E2E === '1') {
    // Test seam for the Playwright smoke test: drive the real code paths.
    (globalThis as Record<string, unknown>).__xbotTest = { toggleComposer, openStudio, fireReminder: fireReminderNow };
  }

  log.info('xBot ready', { userData: paths.userData, version: app.getVersion() });
}
