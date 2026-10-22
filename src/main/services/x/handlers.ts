import { z } from 'zod';
import { accountIdSchema, connectSchema, jobIdSchema, postSchema } from '../../../shared/contracts/x';
import { xChannels } from '../../../shared/contracts/x.channels';
import type { XService } from './service';

// The `x:*` IPC table: channel, payload schema and handler. Electron-free, so
// tests wrap the very same entries in createIpcHandler (src/main/ipc/core.ts)
// that src/main/ipc/x.ts registers with handle().

export interface XHandler {
  channel: string;
  schema: z.ZodType;
  fn(payload: unknown): unknown;
}

function entry<S extends z.ZodType>(channel: string, schema: S, fn: (payload: z.output<S>) => unknown): XHandler {
  return { channel, schema, fn: fn as (payload: unknown) => unknown };
}

export function createXHandlers(service: XService): XHandler[] {
  return [
    entry(xChannels.getState, z.undefined(), () => service.state()),
    entry(xChannels.connect, connectSchema, (payload) => service.connect(payload?.reconnectAccountId)),
    entry(xChannels.cancelConnect, z.undefined(), () => {
      service.cancelConnect();
      return null;
    }),
    entry(xChannels.switchAccount, accountIdSchema, ({ accountId }) => service.switchAccount(accountId)),
    entry(xChannels.disconnect, accountIdSchema, ({ accountId }) => service.disconnect(accountId)),
    entry(xChannels.post, postSchema, (payload) => service.post(payload)),
    entry(xChannels.getOpenJobs, z.undefined(), () => service.openJobs()),
    entry(xChannels.cancelJob, jobIdSchema, ({ jobId }) => service.cancelJob(jobId)),
    entry(xChannels.retryJob, jobIdSchema, ({ jobId }) => service.retryJob(jobId)),
    entry(xChannels.reconcile, jobIdSchema, ({ jobId }) => service.reconcile(jobId)),
    entry(xChannels.markNotPosted, jobIdSchema, ({ jobId }) => service.markNotPosted(jobId)),
    entry(xChannels.dismissJob, jobIdSchema, ({ jobId }) => {
      service.dismissJob(jobId);
      return null;
    }),
  ];
}
