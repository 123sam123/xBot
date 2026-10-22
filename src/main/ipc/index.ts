// Every domain's IPC registrar. Siblings fill in their own ipc/<domain>.ts;
// this list already names them all.
import { registerAiIpc } from './ai';
import { registerAppIpc } from './app';
import { registerBackupIpc } from './backup';
import { registerDraftsIpc } from './drafts';
import { registerMediaIpc } from './media';
import { registerProjectsIpc } from './projects';
import { registerRemindersIpc } from './reminders';
import { registerSettingsIpc } from './settings';
import { registerStudioIpc } from './studio';
import { registerWindowsIpc } from './windows';
import { registerXIpc } from './x';

export function registerIpc(): void {
  registerAppIpc();
  registerWindowsIpc();
  registerSettingsIpc();
  registerDraftsIpc();
  registerMediaIpc();
  registerStudioIpc();
  registerAiIpc();
  registerProjectsIpc();
  registerRemindersIpc();
  registerXIpc();
  registerBackupIpc();
}
