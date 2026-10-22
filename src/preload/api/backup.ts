// Owned by T10 (XBOT-1DDYA1).
import type { BackupApi } from '../../shared/contracts/backup';
import { backupChannels } from '../../shared/contracts/backup.channels';
import { invoke } from '../invoke';

export const backup: BackupApi = {
  create: () => invoke(backupChannels.create),
  reveal: () => invoke(backupChannels.reveal),
};
