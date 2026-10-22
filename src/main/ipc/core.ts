import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import type { IpcResult } from '../../shared/contracts/ipc';
import type { Logger } from '../log';

// Pure IPC plumbing — no `electron` import, so it is unit-tested directly.

/** The parts of Electron's IpcMainInvokeEvent this module reads. */
export interface IpcEventLike {
  sender: { id: number };
  senderFrame: { url: string; parent: unknown } | null;
}

export interface TrustContext {
  /** webContents ids of xBot's own windows. */
  knownWebContentsIds: () => ReadonlySet<number>;
  /** Vite dev-server origin while `pnpm dev` runs, otherwise null. */
  devServerOrigin: string | null;
  /** Absolute path of the built renderer (`out/renderer`). */
  rendererDir: string;
}

/** A thrown IpcError keeps its code in the result envelope. */
export class IpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

function isInsideDir(file: string, dir: string): boolean {
  const rel = relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * True only for the top frame of one of xBot's own windows showing one of
 * xBot's own pages: the dev-server origin in dev, a file inside the built
 * renderer directory otherwise.
 */
export function isTrustedSender(event: IpcEventLike, ctx: TrustContext): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  if (!ctx.knownWebContentsIds().has(event.sender.id)) return false;

  let url: URL;
  try {
    url = new URL(frame.url);
  } catch {
    return false;
  }
  if (ctx.devServerOrigin !== null) return url.origin === ctx.devServerOrigin;
  if (url.protocol !== 'file:') return false;
  return isInsideDir(fileURLToPath(url), ctx.rendererDir);
}

export interface HandlerOptions<S extends z.ZodType, R, E extends IpcEventLike> {
  channel: string;
  schema: S;
  fn: (payload: z.output<S>, event: E) => R | Promise<R>;
  trust: (event: E) => boolean;
  log: Logger;
}

/** Wraps a domain handler: sender check, then zod validation, then the result envelope. */
export function createIpcHandler<S extends z.ZodType, R, E extends IpcEventLike>({
  channel,
  schema,
  fn,
  trust,
  log,
}: HandlerOptions<S, R, E>): (event: E, payload: unknown) => Promise<IpcResult<Awaited<R>>> {
  return async (event, payload) => {
    if (!trust(event)) {
      log.warn(`ipc: rejected ${channel} from untrusted sender`, event.senderFrame?.url ?? '(no frame)');
      return { ok: false, error: { code: 'forbidden_sender', message: 'Sender is not an xBot window.' } };
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      log.warn(`ipc: rejected ${channel}: invalid payload`, parsed.error.issues);
      return { ok: false, error: { code: 'invalid_payload', message: `Invalid payload for ${channel}.` } };
    }
    try {
      return { ok: true, data: await fn(parsed.data, event) };
    } catch (err) {
      if (err instanceof IpcError) return { ok: false, error: { code: err.code, message: err.message } };
      log.error(`ipc: ${channel} failed`, err);
      return { ok: false, error: { code: 'internal', message: `${channel} failed.` } };
    }
  };
}
