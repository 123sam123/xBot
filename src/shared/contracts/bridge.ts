// The shape of `window.xbot`, the only way the renderer reaches the main
// process. Each key is one domain, implemented in src/preload/api/<domain>.ts.
import type { AiApi } from './ai';
import type { AppApi } from './app';
import type { BackupApi } from './backup';
import type { DraftsApi } from './drafts';
import type { EventsApi } from './events';
import type { MediaApi } from './media';
import type { ProjectsApi } from './projects';
import type { RecordingsApi } from './recordings';
import type { RemindersApi } from './reminders';
import type { SettingsApi } from './settings';
import type { StudioApi } from './studio';
import type { WindowsApi } from './windows';
import type { XApi } from './x';

export interface XbotBridge {
  app: AppApi;
  windows: WindowsApi;
  settings: SettingsApi;
  events: EventsApi;
  drafts: DraftsApi;
  media: MediaApi;
  studio: StudioApi;
  ai: AiApi;
  projects: ProjectsApi;
  reminders: RemindersApi;
  x: XApi;
  backup: BackupApi;
  recordings: RecordingsApi;
}
