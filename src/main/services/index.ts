// Every domain's service, in init order. Siblings fill in their own module;
// this list already names them all.
import { aiModule } from './ai';
import { backupModule } from './backup';
import { draftsModule } from './drafts';
import { mediaModule } from './media';
import { projectsModule } from './projects';
import { remindersModule } from './reminders';
import { settingsModule } from './settings';
import { studioModule } from './studio';
import type { ServiceContext, ServiceModule } from './types';
import { xModule } from './x';

const modules: readonly ServiceModule[] = [
  settingsModule,
  draftsModule,
  mediaModule,
  studioModule,
  aiModule,
  projectsModule,
  remindersModule,
  xModule,
  backupModule,
];

export async function initServices(ctx: ServiceContext): Promise<void> {
  for (const m of modules) await m.init(ctx);
}

export async function disposeServices(): Promise<void> {
  for (const m of [...modules].reverse()) {
    try {
      await m.dispose?.();
    } catch (err) {
      console.error(`services: ${m.name} failed to dispose`, err);
    }
  }
}
