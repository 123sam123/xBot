// The preload bridge: one frozen `window.xbot` object, one key per domain.
// It imports only types and zod-free channel names from src/shared/contracts
// (a sandboxed preload cannot load packages), and never exposes ipcRenderer.
import { contextBridge } from 'electron';
import type { XbotBridge } from '../shared/contracts/bridge';
import { ai } from './api/ai';
import { app } from './api/app';
import { backup } from './api/backup';
import { drafts } from './api/drafts';
import { events } from './api/events';
import { media } from './api/media';
import { projects } from './api/projects';
import { reminders } from './api/reminders';
import { settings } from './api/settings';
import { studio } from './api/studio';
import { windows } from './api/windows';
import { x } from './api/x';

const bridge: XbotBridge = { app, windows, settings, events, drafts, media, studio, ai, projects, reminders, x, backup };

contextBridge.exposeInMainWorld('xbot', Object.freeze(bridge));
