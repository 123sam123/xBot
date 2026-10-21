import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AppPaths {
  userData: string;
  db: string;
  media: string;
  exports: string;
  logs: string;
  tmp: string;
}

export interface UserDataOptions {
  appData: string;
  isPackaged: boolean;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}

export function isPreviewMode(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--preview') || env.XBOT_PREVIEW === '1';
}

/**
 * Where xBot keeps its data. Packaged: `<appData>/xBot`; unpackaged (pnpm dev,
 * e2e): `<appData>/xBot Dev`, so branch migrations never touch real data;
 * preview mode: `<appData>/xBot Preview`. `XBOT_USER_DATA_DIR` overrides it, but
 * only when unpackaged (tests).
 */
export function resolveUserDataDir({ appData, isPackaged, argv, env }: UserDataOptions): string {
  if (!isPackaged && env.XBOT_USER_DATA_DIR) return resolve(env.XBOT_USER_DATA_DIR);
  if (isPreviewMode(argv, env)) return join(appData, 'xBot Preview');
  return join(appData, isPackaged ? 'xBot' : 'xBot Dev');
}

export function appPaths(userData: string): AppPaths {
  return {
    userData,
    db: join(userData, 'xbot.db'),
    media: join(userData, 'media'),
    exports: join(userData, 'exports'),
    logs: join(userData, 'logs'),
    tmp: join(userData, 'tmp'),
  };
}

/**
 * Creates the userData layout. `tmp/` is emptied only when the folder is
 * provably ours (it already holds xbot.db, or this run just created it).
 */
export function prepareUserData(paths: AppPaths): void {
  const fresh = !existsSync(paths.userData);
  const ours = fresh || existsSync(paths.db);
  for (const dir of [paths.userData, paths.media, paths.exports, paths.logs]) mkdirSync(dir, { recursive: true });
  if (ours) rmSync(paths.tmp, { recursive: true, force: true });
  mkdirSync(paths.tmp, { recursive: true });
}
