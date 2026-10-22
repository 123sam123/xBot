// Owned by T10 (XBOT-1DDYA1). Already wired into services/index.ts (last, so it is disposed first).
import { app } from 'electron';
import type { ServiceModule } from '../types';
import { createBackupService, type BackupService } from './service';

let instance: BackupService | null = null;

export function backup(): BackupService {
  if (!instance) throw new Error('backup service used before initServices()');
  return instance;
}

export const backupModule: ServiceModule = {
  name: 'backup',
  init(ctx) {
    instance = createBackupService({ db: ctx.db, paths: ctx.paths, log: ctx.log, appVersion: app.getVersion() });
  },
  dispose() {
    // A backup still running is stopped and its .partial folder removed before the database closes.
    instance?.dispose();
    instance = null;
  },
};
