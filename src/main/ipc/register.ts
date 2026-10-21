import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { log } from '../log';
import { devServerUrl, knownWebContentsIds, rendererDir } from '../windows/common';
import { createIpcHandler, isTrustedSender, type TrustContext } from './core';

const dev = devServerUrl();
const trustContext: TrustContext = {
  knownWebContentsIds,
  devServerOrigin: dev ? new URL(dev).origin : null,
  rendererDir: rendererDir(),
};

/**
 * Registers `fn` for `channel`. Every renderer → main call goes through here:
 * the sender is checked, the payload is parsed with `schema`, and the result is
 * returned as an IpcResult envelope.
 */
export function handle<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  fn: (payload: z.output<S>, event: IpcMainInvokeEvent) => R | Promise<R>,
): void {
  ipcMain.handle(
    channel,
    createIpcHandler<S, R, IpcMainInvokeEvent>({
      channel,
      schema,
      fn,
      trust: (event) => isTrustedSender(event, trustContext),
      log,
    }),
  );
}
