// The app-wide event map, merged from every domain. Domains declare their
// events (and which ones reach the renderer) in their own contract file.
import { aiForwardedEvents, type AiEvents } from './ai';
import { appForwardedEvents, type AppEvents } from './app';
import { backupForwardedEvents, type BackupEvents } from './backup';
import { draftsForwardedEvents, type DraftsEvents } from './drafts';
import { mediaForwardedEvents, type MediaEvents } from './media';
import { projectsForwardedEvents, type ProjectsEvents } from './projects';
import { remindersForwardedEvents, type RemindersEvents } from './reminders';
import { settingsForwardedEvents, type SettingsEvents } from './settings';
import { studioForwardedEvents, type StudioEvents } from './studio';
import { windowsForwardedEvents, type WindowsEvents } from './windows';
import { xForwardedEvents, type XEvents } from './x';

export interface AppEventPayloads
  extends AppEvents,
    WindowsEvents,
    SettingsEvents,
    DraftsEvents,
    MediaEvents,
    StudioEvents,
    AiEvents,
    ProjectsEvents,
    RemindersEvents,
    XEvents,
    BackupEvents {}

export type AppEventName = keyof AppEventPayloads;

/** Events main forwards to every renderer window. */
export const forwardedEvents = [
  ...appForwardedEvents,
  ...windowsForwardedEvents,
  ...settingsForwardedEvents,
  ...draftsForwardedEvents,
  ...mediaForwardedEvents,
  ...studioForwardedEvents,
  ...aiForwardedEvents,
  ...projectsForwardedEvents,
  ...remindersForwardedEvents,
  ...xForwardedEvents,
  ...backupForwardedEvents,
] as const satisfies readonly AppEventName[];

export type ForwardedEventName = (typeof forwardedEvents)[number];

export interface RendererEventMessage<K extends ForwardedEventName = ForwardedEventName> {
  name: K;
  payload: AppEventPayloads[K];
}

export interface EventsApi {
  /** Subscribe to a forwarded event; returns the unsubscribe function. */
  on<K extends ForwardedEventName>(name: K, listener: (payload: AppEventPayloads[K]) => void): () => void;
}
