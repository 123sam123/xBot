// Owned by T10 (XBOT-1DDYA1).
import { existsSync } from 'node:fs';
import { shell } from 'electron';
import { z } from 'zod';
import type { BackupResult } from '../../shared/contracts/backup';
import { backupChannels } from '../../shared/contracts/backup.channels';
import { backup } from '../services/backup';
import { IpcError } from './core';
import { pickPaths } from './media';
import { handle } from './register';

/** The last backup this run wrote. "Show in Finder" reveals it, so the renderer never sends a path. */
let lastBackup: string | null = null;

function toIpcError(err: unknown): IpcError {
  if (err instanceof IpcError) return err;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOSPC') return new IpcError('backup_failed', 'There isn’t enough space in that folder for the backup.');
  if (code === 'EACCES' || code === 'EPERM') return new IpcError('backup_failed', 'xBot can’t write to that folder.');
  if (code === 'EROFS') return new IpcError('backup_failed', 'That folder is read-only.');
  if (code === 'ENOENT') return new IpcError('backup_failed', 'That folder is no longer there.');
  return new IpcError('backup_failed', 'The backup couldn’t be written.');
}

export function registerBackupIpc(): void {
  handle(backupChannels.create, z.undefined(), async (): Promise<BackupResult | null> => {
    const folder = (
      await pickPaths({
        title: 'Back up xBot data',
        message: 'Choose where to put the backup folder.',
        buttonLabel: 'Back Up Here',
        properties: ['openDirectory', 'createDirectory'],
      })
    )?.[0];
    if (!folder) return null;
    try {
      const { path, result } = await backup().create(folder);
      lastBackup = path;
      return result;
    } catch (err) {
      throw toIpcError(err);
    }
  });

  handle(backupChannels.reveal, z.undefined(), () => {
    if (!lastBackup || !existsSync(lastBackup)) throw new IpcError('no_backup', 'That backup folder is no longer there.');
    shell.showItemInFolder(lastBackup);
    return null;
  });
}
