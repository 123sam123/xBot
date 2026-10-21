// Owned by T7 (XBOT-5UVE6R). Payload schemas, settings, events and the bridge API for the
// `projects` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const projectsSettings = {} satisfies SettingsShape;

export interface ProjectsEvents {}

export const projectsForwardedEvents = [] as const satisfies readonly (keyof ProjectsEvents)[];

export interface ProjectsApi {}
