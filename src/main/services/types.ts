import type { Db } from '../db';
import type { appEvents } from '../events';
import type { Logger } from '../log';
import type { AppPaths } from '../paths';

export interface ServiceContext {
  db: Db;
  paths: AppPaths;
  events: typeof appEvents;
  log: Logger;
}

/** One domain's main-process service. `init` runs after the DB is migrated. */
export interface ServiceModule {
  name: string;
  init(ctx: ServiceContext): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
