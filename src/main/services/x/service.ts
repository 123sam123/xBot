import type { IntegrationStatus } from '../../../shared/contracts/app';
import type { ConnectResult, PostPayload, PublishJob, ReconcileResult, XAccount, XEvents, XState } from '../../../shared/contracts/x';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import { statusChanged } from '../../status';
import type { DraftsService } from '../drafts/service';
import { createAccountStore, type AccountStore } from './accounts';
import { createXApi, type FetchLike } from './api';
import type { LoopbackOptions, Loopback } from './loopback';
import { createOAuth, type OAuth } from './oauth';
import { createPublisher, type Publisher, type ResolvePostMedia } from './publish';
import type { TokenVault } from './vault';

// The x domain's service, assembled from its parts. No `electron` import:
// services/x/index.ts passes Electron's fetch, safeStorage and shell in, and
// tests pass fakes. The IPC handlers (handlers.ts) call only this surface.

export interface XServiceDeps {
  db: Db;
  log: Logger;
  fetch: FetchLike;
  vault: TokenVault;
  drafts: Pick<DraftsService, 'get'>;
  mediaRoot: string;
  emit<K extends keyof XEvents>(name: K, payload: XEvents[K]): void;
  config(): { clientId: string; port: number };
  openBrowser(url: string): void;
  beforeBrowser?(): void;
  afterAnswer?(): void;
  preview?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  listen?: (options: LoopbackOptions) => Promise<Loopback>;
  timeouts?: { requestMs?: number; createMs?: number; retryDelayMs?: number; connectMs?: number; processingMs?: number };
  chunkBytes?: number;
  resolvePostMedia?: ResolvePostMedia;
}

export interface XService {
  readonly accounts: AccountStore;
  readonly oauth: OAuth;
  readonly publisher: Publisher;
  init(): void;
  state(): XState;
  connect(reconnectAccountId?: string): Promise<ConnectResult>;
  cancelConnect(): void;
  switchAccount(accountId: string): XAccount[];
  disconnect(accountId: string): Promise<XAccount[]>;
  post(payload: PostPayload): Promise<PublishJob>;
  openJobs(): PublishJob[];
  cancelJob(jobId: string): PublishJob;
  retryJob(jobId: string): Promise<PublishJob>;
  reconcile(jobId: string): Promise<ReconcileResult>;
  markNotPosted(jobId: string): PublishJob;
  dismissJob(jobId: string): void;
  /** The "X" chip, from the database only (never touches the Keychain). */
  status(): IntegrationStatus | null;
  settleForQuit(maxMs: number): Promise<void>;
  dispose(): void;
}

export function createXService(deps: XServiceDeps): XService {
  const t = deps.timeouts ?? {};
  const api = createXApi({
    fetch: deps.fetch,
    now: deps.now,
    timeoutMs: t.requestMs,
    createTimeoutMs: t.createMs,
    retryDelayMs: t.retryDelayMs,
    sleep: deps.sleep,
  });

  const notifyAccounts = () => {
    deps.emit('x:accounts-changed', { accounts: accounts.list() });
    statusChanged();
  };
  const accounts = createAccountStore({ db: deps.db, vault: deps.vault, api, log: deps.log, now: deps.now, onChanged: notifyAccounts });
  const oauth = createOAuth({
    api,
    accounts,
    vault: deps.vault,
    log: deps.log,
    config: deps.config,
    openBrowser: deps.openBrowser,
    listen: deps.listen,
    beforeBrowser: deps.beforeBrowser,
    afterAnswer: deps.afterAnswer,
    onConnectingChanged: notifyAccounts,
    timeoutMs: t.connectMs,
  });
  const publisher = createPublisher({
    db: deps.db,
    accounts,
    api,
    drafts: deps.drafts,
    mediaRoot: deps.mediaRoot,
    emit: deps.emit,
    log: deps.log,
    preview: deps.preview,
    now: deps.now,
    sleep: deps.sleep,
    processingTimeoutMs: t.processingMs,
    chunkBytes: deps.chunkBytes,
    resolvePostMedia: deps.resolvePostMedia,
    onActivity: statusChanged,
  });

  const notInPreview = () => {
    if (deps.preview) throw new IpcError('preview_mode', 'X is off in preview mode.');
  };

  return {
    accounts,
    oauth,
    publisher,

    init() {
      publisher.recover();
    },

    state() {
      return {
        clientIdSet: deps.config().clientId !== '',
        callbackUrl: oauth.callbackUrl(),
        accounts: deps.preview ? [] : accounts.list(),
        connecting: oauth.connecting(),
      };
    },

    connect(reconnectAccountId) {
      notInPreview();
      return oauth.connect(reconnectAccountId);
    },

    cancelConnect: () => oauth.cancel(),

    switchAccount(accountId) {
      notInPreview();
      accounts.switchTo(accountId);
      return accounts.list();
    },

    async disconnect(accountId) {
      notInPreview();
      await accounts.disconnect(accountId);
      return accounts.list();
    },

    post: (payload) => publisher.post(payload),
    openJobs: () => (deps.preview ? [] : publisher.openJobs()),
    cancelJob: (jobId) => publisher.cancel(jobId),
    retryJob: (jobId) => {
      notInPreview();
      return publisher.retry(jobId);
    },
    reconcile: (jobId) => {
      notInPreview();
      return publisher.reconcile(jobId);
    },
    markNotPosted: (jobId) => publisher.markNotPosted(jobId),
    dismissJob: (jobId) => publisher.dismiss(jobId),

    status() {
      if (deps.preview) return null;
      const { running, uncertain } = publisher.summary();
      if (uncertain > 0) {
        return { id: 'x', label: 'A post needs checking', tone: 'warning', detail: 'X didn’t confirm a post. Open Post to check X.' };
      }
      if (running > 0) return { id: 'x', label: 'Posting to X', tone: 'busy' };
      const active = accounts.active();
      if (active?.reconnect_required) return { id: 'x', label: 'Reconnect X', tone: 'warning', detail: `@${active.handle} needs to sign in again.` };
      if (active) return { id: 'x', label: `X: @${active.handle}`, tone: 'ok' };
      if (deps.config().clientId === '') {
        return { id: 'x', label: 'X not set up', tone: 'neutral', detail: 'Add your X app’s Client ID in Settings → X to post from xBot.' };
      }
      return { id: 'x', label: 'X disconnected', tone: 'neutral', detail: 'Connect an X account to post from xBot.' };
    },

    settleForQuit: (maxMs) => publisher.settleForQuit(maxMs),

    dispose() {
      oauth.dispose();
      publisher.dispose();
    },
  };
}
