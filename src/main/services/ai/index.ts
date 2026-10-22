// Owned by T6 (XBOT-4BCGOR). Already wired into services/index.ts.
import { totalmem } from 'node:os';
import { isPreviewMode } from '../../paths';
import { registerStatusProvider, statusChanged } from '../../status';
import { settings } from '../settings';
import type { ServiceModule } from '../types';
import { createAiService, type AiService } from './service';
import { statusFor } from './status';

let instance: AiService | null = null;
let cleanup: (() => void)[] = [];

/** The local AI service. T7 calls `ai().generate({ …, priority: 'background' })`. */
export function ai(): AiService {
  if (!instance) throw new Error('ai service used before initServices()');
  return instance;
}

export const aiModule: ServiceModule = {
  name: 'ai',
  init(ctx) {
    const preview = isPreviewMode(process.argv, process.env);
    const service = createAiService({
      db: ctx.db,
      getSettings: () => ({
        endpoint: settings().get('ai.endpoint'),
        model: settings().get('ai.model'),
        lowResource: settings().get('ai.lowResource'),
        timeoutSec: settings().get('ai.generationTimeoutSec'),
      }),
      setModel: (model) => settings().set('ai.model', model),
      isPreview: preview,
      log: ctx.log,
      // Each name/payload pair is typed by AiEvents; the bus's generic signature can't follow K.
      emit: (name, payload) => (ctx.events.emit as (n: string, p: unknown) => boolean).call(ctx.events, name, payload),
      onStatusChange: statusChanged,
      totalMemBytes: totalmem(),
    });
    instance = service;

    const onSettings = ({ key }: { key: string }) => {
      if (key.startsWith('ai.')) service.settingChanged(key);
    };
    ctx.events.on('settings:changed', onSettings);
    cleanup = [
      () => ctx.events.off('settings:changed', onSettings),
      // Preview mode shows no AI chip and never probes: it stays deterministic.
      registerStatusProvider({ id: 'ai', order: 10, get: () => (preview ? null : statusFor(service.state())) }),
    ];
    if (!preview) void service.probe('force');
  },
  dispose() {
    instance?.dispose();
    for (const undo of cleanup) undo();
    cleanup = [];
    instance = null;
  },
};
