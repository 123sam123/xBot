// Owned by T9 (XBOT-OE2XV9). X accounts and publishing: what the renderer sees
// of them, the IPC payloads, settings, events and the bridge API. Tokens, OAuth
// codes and verifiers never appear here. See docs/X.md.
import { z } from 'zod';
import { CLIENT_ID_PATTERN, DEFAULT_CALLBACK_PORT, type JobStatus } from '../xRules';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';

export interface XAccount {
  id: string;
  xUserId: string;
  handle: string;
  name: string;
  active: boolean;
  /** The token was rejected or can't be decrypted on this Mac: connect again. */
  reconnectRequired: boolean;
}

export interface XState {
  /** A Client ID is saved in Settings → X. */
  clientIdSet: boolean;
  /** The exact URL to register as the X app's callback. */
  callbackUrl: string;
  accounts: XAccount[];
  /** A browser sign-in is waiting for X. */
  connecting: boolean;
}

export interface PublishJobError {
  code: string;
  message: string;
  /** ISO time a rate limit resets; Retry is refused until then. */
  resetAt?: string;
}

export interface PublishJob {
  id: string;
  /** Null once the draft was deleted. */
  draftId: string | null;
  accountHandle: string;
  frozenText: string;
  /** The frozen media, in post order (T3 media ids). */
  mediaIds: string[];
  status: JobStatus;
  progress: { phase: 'upload' | 'processing'; percent: number } | null;
  remotePostId: string | null;
  /** The real post's URL, only once X returned its id. */
  remoteUrl: string | null;
  error: PublishJobError | null;
  /** Create requests sent so far. */
  attempts: number;
  /** A create was sent whose outcome is unknown: check X before posting again. */
  uncertain: boolean;
  /** The user dismissed it; it no longer shows. */
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReconcileResult {
  job: PublishJob;
  found: boolean;
}

export interface ConnectResult {
  account: XAccount;
  /** Something the user should know, e.g. "You signed in as @b, not @a." */
  notice: string | null;
}

// '' until the user pastes a Client ID.
export const xSettings = {
  'x.clientId': defineSetting(z.union([z.literal(''), z.string().regex(CLIENT_ID_PATTERN)]), ''),
  'x.callbackPort': defineSetting(z.number().int().min(1024).max(65535), DEFAULT_CALLBACK_PORT),
} satisfies SettingsShape;

export const accountIdSchema = z.strictObject({ accountId: z.uuid() });
/** `reconnectAccountId`: the account a "Reconnect @a" click meant to renew. */
export const connectSchema = z.strictObject({ reconnectAccountId: z.uuid().optional() }).optional();
export const jobIdSchema = z.strictObject({ jobId: z.uuid() });
// Loose bounds on purpose: X's own limits (4 images, 280 weighted characters)
// are checked by the service, which answers with a reason instead of `invalid_payload`.
export const postSchema = z.strictObject({
  draftId: z.uuid(),
  text: z.string().max(25_000),
  attachmentIds: z.array(z.uuid()).max(200),
});
export type PostPayload = z.infer<typeof postSchema>;

export interface XEvents {
  'post:published': { postId: string; url: string };
  'x:accounts-changed': { accounts: XAccount[] };
  'x:job-changed': { job: PublishJob };
}

export const xForwardedEvents = ['post:published', 'x:accounts-changed', 'x:job-changed'] as const satisfies readonly (keyof XEvents)[];

export interface XApi {
  getState(): Promise<IpcResult<XState>>;
  /** Opens X's consent page in the browser and resolves with the connected account. */
  connect(reconnectAccountId?: string): Promise<IpcResult<ConnectResult>>;
  cancelConnect(): Promise<IpcResult<null>>;
  switchAccount(accountId: string): Promise<IpcResult<XAccount[]>>;
  disconnect(accountId: string): Promise<IpcResult<XAccount[]>>;
  /** Posts the draft's saved text and media (which must equal `text` / `attachmentIds`) with the active account. */
  post(payload: PostPayload): Promise<IpcResult<PublishJob>>;
  /** Jobs still running or unresolved, plus failed and published ones not yet dismissed; newest first. */
  getOpenJobs(): Promise<IpcResult<PublishJob[]>>;
  cancelJob(jobId: string): Promise<IpcResult<PublishJob>>;
  retryJob(jobId: string): Promise<IpcResult<PublishJob>>;
  reconcile(jobId: string): Promise<IpcResult<ReconcileResult>>;
  markNotPosted(jobId: string): Promise<IpcResult<PublishJob>>;
  dismissJob(jobId: string): Promise<IpcResult<null>>;
}
