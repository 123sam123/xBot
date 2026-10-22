import { createHash, randomBytes } from 'node:crypto';
import type { ConnectResult } from '../../../shared/contracts/x';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import { toAccount, type AccountStore } from './accounts';
import { X_AUTHORIZE_URL, type TokenSet, type XApi } from './api';
import { apiIpcError } from './errors';
import { CALLBACK_PATH, startLoopback, type Loopback, type LoopbackOptions } from './loopback';
import type { TokenVault } from './vault';

// Connecting an X account: OAuth 2.0 Authorization Code with PKCE (S256) for a
// public "Native App" client, in the system browser, with a short-lived
// loopback callback (docs/X.md). No `electron` import: the browser opener,
// the listener and the composer hooks are injected. No secret is involved.

export const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'] as const;
export const CONNECT_TIMEOUT_MS = 5 * 60_000;

export interface OAuthDeps {
  api: XApi;
  accounts: AccountStore;
  vault: TokenVault;
  log: Logger;
  config(): { clientId: string; port: number };
  openBrowser(url: string): void;
  listen?: (options: LoopbackOptions) => Promise<Loopback>;
  /** Before the browser opens (the composer hides so it can't cover X's page). */
  beforeBrowser?(): void;
  /** After a sign-in X answered (success or decline), not after a timeout or cancel. */
  afterAnswer?(): void;
  onConnectingChanged?(): void;
  timeoutMs?: number;
}

export interface OAuth {
  connect(reconnectAccountId?: string): Promise<ConnectResult>;
  cancel(): void;
  connecting(): boolean;
  callbackUrl(): string;
  dispose(): void;
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function createOAuth(deps: OAuthDeps): OAuth {
  const listen = deps.listen ?? startLoopback;
  const timeoutMs = deps.timeoutMs ?? CONNECT_TIMEOUT_MS;
  interface Flow {
    promise: Promise<ConnectResult>;
    url: string;
    loopback: Loopback | null;
    canceled: boolean;
  }
  let flow: Flow | null = null;

  async function run(reconnectAccountId: string | undefined, f: Flow): Promise<ConnectResult> {
    const { clientId, port } = deps.config();
    if (!clientId) throw new IpcError('x_client_id_missing', 'Add your X app’s Client ID in Settings → X first.');
    // Refuse before anything starts: no listener, no browser, no request, nothing stored.
    if (!(await deps.vault.available())) {
      throw new IpcError(
        'x_secure_storage_unavailable',
        'OS-protected encryption (the macOS Keychain) isn’t available, so xBot won’t store X tokens. Nothing was saved.',
      );
    }
    if (f.canceled) throw new IpcError('x_connect_canceled', 'The sign-in was canceled.');

    const state = base64url(randomBytes(32));
    const { verifier, challenge } = pkcePair();
    const loopback = await listen({ port, state, timeoutMs });
    f.loopback = loopback;
    if (f.canceled) {
      loopback.close();
      throw new IpcError('x_connect_canceled', 'The sign-in was canceled.');
    }
    const uri = redirectUri(loopback.port);
    f.url = authorizeUrl({ clientId, redirectUri: uri, state, challenge });
    deps.beforeBrowser?.();
    deps.openBrowser(f.url);

    const answer = await loopback.result;
    deps.afterAnswer?.();
    if (answer.kind === 'error') {
      if (answer.error === 'access_denied') throw new IpcError('x_connect_denied', 'You declined access on X, so nothing was connected.');
      throw new IpcError('x_connect_failed', `X couldn’t complete the sign-in: ${answer.description ?? answer.error}`);
    }

    // X's code is valid for 30 s: exchange it at once.
    let tokens: TokenSet;
    try {
      tokens = await deps.api.exchangeCode({ clientId, code: answer.code, redirectUri: uri, verifier });
    } catch (err) {
      throw apiIpcError(err, 'auth');
    }
    const granted = new Set(tokens.scope.split(/\s+/).filter(Boolean));
    const missing = SCOPES.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      await deps.accounts.revoke(clientId, tokens);
      throw new IpcError(
        'x_scopes_missing',
        `X didn’t grant ${missing.join(', ')}. Set your X app’s permissions to “Read and write”, then connect again.`,
      );
    }

    let me: { id: string; name: string; username: string };
    try {
      me = await deps.api.me(tokens.access);
    } catch (err) {
      await deps.accounts.revoke(clientId, tokens);
      throw apiIpcError(err, 'read');
    }

    const existing = deps.accounts.byXUserId(me.id);
    const wanted = reconnectAccountId ? deps.accounts.get(reconnectAccountId) : null;
    const saved = await deps.accounts.save({ xUserId: me.id, clientId, handle: me.username, name: me.name, tokens });
    let notice: string | null = null;
    if (wanted && wanted.x_user_id !== me.id) {
      notice = `You signed in as @${me.username}, not @${wanted.handle}. Switch accounts on x.com, then reconnect @${wanted.handle}.`;
    } else if (existing && !reconnectAccountId) {
      notice = `@${me.username} was already connected; xBot switched to it.`;
    }
    return { account: toAccount(saved), notice };
  }

  return {
    connect(reconnectAccountId) {
      if (flow) {
        // One sign-in at a time: show X's page again and wait on the same flow.
        if (flow.url) {
          deps.beforeBrowser?.();
          deps.openBrowser(flow.url);
        }
        return flow.promise;
      }
      const f: Flow = { promise: Promise.resolve(null as never), url: '', loopback: null, canceled: false };
      f.promise = run(reconnectAccountId, f).finally(() => {
        f.loopback?.close();
        if (flow === f) flow = null;
        deps.onConnectingChanged?.();
      });
      flow = f;
      deps.onConnectingChanged?.();
      return f.promise;
    },

    cancel() {
      if (!flow) return;
      flow.canceled = true;
      flow.loopback?.close();
    },

    connecting: () => flow !== null,

    callbackUrl: () => redirectUri(deps.config().port),

    dispose() {
      if (flow) {
        flow.canceled = true;
        flow.loopback?.close();
      }
    },
  };
}
