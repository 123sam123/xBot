import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { XAccount } from '../../../shared/contracts/x';
import { ACTIVE_STATUSES } from '../../../shared/xRules';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import { XApiError, type TokenSet, type XApi } from './api';
import type { TokenVault } from './vault';

// Connected X accounts and their tokens. No `electron` import. Tokens exist in
// plaintext only in memory, for the request that needs them; at rest they are
// safeStorage ciphertext in `x_accounts.token_blob`. Refresh is lazy (on use,
// near expiry), shared per account so concurrent callers make one token call
// (X's refresh tokens are single-use), and stores the new pair before anyone
// uses it.

export interface AccountRow {
  id: string;
  x_user_id: string;
  client_id: string;
  handle: string;
  name: string;
  scopes: string;
  token_blob: Buffer;
  token_expires_at: string;
  is_active: 0 | 1;
  reconnect_required: 0 | 1;
  created_at: string;
  updated_at: string;
}

const tokenBlobSchema = z.strictObject({
  access: z.string().min(1),
  refresh: z.string().min(1).nullable(),
  expiresAt: z.string(),
  scope: z.string(),
});

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000;

export interface AccountStore {
  list(): XAccount[];
  active(): AccountRow | null;
  get(id: string): AccountRow | null;
  byXUserId(xUserId: string): AccountRow | null;
  /** Inserts or updates by X user id (keeping the row id) and makes it the active account. */
  save(p: { xUserId: string; clientId: string; handle: string; name: string; tokens: TokenSet }): Promise<AccountRow>;
  switchTo(id: string): void;
  /** A usable access token for this account, refreshed if it is about to expire. */
  accessToken(id: string): Promise<string>;
  /** After X rejected `rejected` with a 401: refresh (once, shared) and return the new token. */
  refreshAfterRejection(id: string, rejected: string): Promise<string>;
  markReconnect(id: string): void;
  /** Deletes the account and only its tokens; refused while it has an active job. Revokes best effort. */
  disconnect(id: string): Promise<void>;
  /** Best-effort revoke of a token pair that is not stored (a refused connect). */
  revoke(clientId: string, tokens: TokenSet): Promise<void>;
}

export interface AccountStoreDeps {
  db: Db;
  vault: TokenVault;
  api: XApi;
  log: Logger;
  now?: () => number;
  onChanged?: () => void;
}

export function toAccount(row: AccountRow): XAccount {
  return {
    id: row.id,
    xUserId: row.x_user_id,
    handle: row.handle,
    name: row.name,
    active: row.is_active === 1,
    reconnectRequired: row.reconnect_required === 1,
  };
}

const ACTIVE_LIST = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createAccountStore({ db, vault, api, log, now = Date.now, onChanged = () => {} }: AccountStoreDeps): AccountStore {
  const iso = () => new Date(now()).toISOString();
  const q = {
    all: db.prepare<[], AccountRow>('SELECT * FROM x_accounts ORDER BY created_at, rowid'),
    byId: db.prepare<[string], AccountRow>('SELECT * FROM x_accounts WHERE id = ?'),
    byXUser: db.prepare<[string], AccountRow>('SELECT * FROM x_accounts WHERE x_user_id = ?'),
    active: db.prepare<[], AccountRow>('SELECT * FROM x_accounts WHERE is_active = 1'),
    clearActive: db.prepare('UPDATE x_accounts SET is_active = 0 WHERE is_active = 1'),
    setActive: db.prepare('UPDATE x_accounts SET is_active = 1 WHERE id = ?'),
    upsert: db.prepare(
      `INSERT INTO x_accounts (id, x_user_id, client_id, handle, name, scopes, token_blob, token_expires_at, is_active, reconnect_required, created_at, updated_at)
       VALUES (@id, @x_user_id, @client_id, @handle, @name, @scopes, @token_blob, @token_expires_at, 0, 0, @now, @now)
       ON CONFLICT (x_user_id) DO UPDATE SET
         client_id = excluded.client_id, handle = excluded.handle, name = excluded.name, scopes = excluded.scopes,
         token_blob = excluded.token_blob, token_expires_at = excluded.token_expires_at,
         reconnect_required = 0, updated_at = excluded.updated_at`,
    ),
    setTokens: db.prepare('UPDATE x_accounts SET token_blob = ?, token_expires_at = ?, scopes = ?, updated_at = ? WHERE id = ?'),
    setReconnect: db.prepare('UPDATE x_accounts SET reconnect_required = 1, updated_at = ? WHERE id = ?'),
    delete: db.prepare('DELETE FROM x_accounts WHERE id = ?'),
    activeJobs: db.prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM publish_jobs WHERE account_id = ? AND status IN (${ACTIVE_LIST})`),
  };
  const refreshing = new Map<string, Promise<TokenSet>>();

  function row(id: string): AccountRow {
    const found = q.byId.get(id);
    if (!found) throw new IpcError('x_account_not_found', 'That X account is no longer connected.');
    return found;
  }

  const reconnectError = (r: Pick<AccountRow, 'handle'>) =>
    new IpcError('x_reconnect', `X no longer accepts xBot’s sign-in for @${r.handle}. Reconnect to keep posting.`);

  function markReconnect(id: string): void {
    if (q.setReconnect.run(iso(), id).changes > 0) onChanged();
  }

  async function readTokens(r: AccountRow): Promise<TokenSet> {
    let opened: { plainText: string; reseal: boolean };
    try {
      opened = await vault.open(r.token_blob);
    } catch (err) {
      // A denied Keychain prompt, or a backup restored on another Mac.
      log.warn('x: stored tokens could not be decrypted', r.handle, err instanceof Error ? err.name : 'error');
      markReconnect(r.id);
      throw reconnectError(r);
    }
    const parsed = tokenBlobSchema.safeParse(parseJson(opened.plainText));
    if (!parsed.success) {
      markReconnect(r.id);
      throw reconnectError(r);
    }
    if (opened.reseal) await writeTokens(r.id, parsed.data).catch(() => {});
    return parsed.data;
  }

  async function writeTokens(id: string, tokens: TokenSet): Promise<void> {
    const blob = await vault.seal(JSON.stringify(tokens));
    q.setTokens.run(blob, tokens.expiresAt, tokens.scope, iso(), id);
  }

  async function doRefresh(id: string): Promise<TokenSet> {
    const r = row(id);
    const tokens = await readTokens(r);
    if (!tokens.refresh) {
      markReconnect(id);
      throw reconnectError(r);
    }
    const attempt = () => api.refresh({ clientId: r.client_id, refreshToken: tokens.refresh! });
    let next: TokenSet;
    try {
      try {
        next = await attempt();
      } catch (err) {
        // The response may have been lost after X rotated the token; one retry tells.
        if (err instanceof XApiError && (err.kind === 'network' || err.kind === 'timeout')) next = await attempt();
        else throw err;
      }
    } catch (err) {
      if (err instanceof XApiError && err.kind === 'http' && (err.status === 400 || err.status === 401)) {
        markReconnect(id);
        throw reconnectError(r);
      }
      throw err;
    }
    // The old blob stays until this write lands; a crash in between means Reconnect at worst.
    await writeTokens(id, next);
    return next;
  }

  /** One refresh per account at a time; concurrent callers share it. */
  function refreshShared(id: string): Promise<TokenSet> {
    const running = refreshing.get(id);
    if (running) return running;
    const started = doRefresh(id).finally(() => refreshing.delete(id));
    refreshing.set(id, started);
    return started;
  }

  async function revoke(clientId: string, tokens: TokenSet): Promise<void> {
    for (const token of [tokens.refresh, tokens.access]) {
      if (!token) continue;
      try {
        await api.revoke({ clientId, token });
      } catch (err) {
        log.warn('x: token revoke failed (best effort)', err instanceof XApiError ? err.message : 'error');
      }
    }
  }

  return {
    list: () => q.all.all().map(toAccount),
    active: () => q.active.get() ?? null,
    get: (id) => q.byId.get(id) ?? null,
    byXUserId: (xUserId) => q.byXUser.get(xUserId) ?? null,

    async save({ xUserId, clientId, handle, name, tokens }) {
      const blob = await vault.seal(JSON.stringify(tokens));
      const saved = db.transaction(() => {
        q.upsert.run({
          id: randomUUID(),
          x_user_id: xUserId,
          client_id: clientId,
          handle,
          name,
          scopes: tokens.scope,
          token_blob: blob,
          token_expires_at: tokens.expiresAt,
          now: iso(),
        });
        const r = q.byXUser.get(xUserId)!;
        q.clearActive.run();
        q.setActive.run(r.id);
        return q.byId.get(r.id)!;
      })();
      onChanged();
      return saved;
    },

    switchTo(id) {
      db.transaction(() => {
        row(id);
        q.clearActive.run();
        q.setActive.run(id);
      })();
      onChanged();
    },

    async accessToken(id) {
      const r = row(id);
      if (r.reconnect_required) throw reconnectError(r);
      const tokens = await readTokens(r);
      if (Date.parse(tokens.expiresAt) - now() > REFRESH_MARGIN_MS) return tokens.access;
      return (await refreshShared(id)).access;
    },

    async refreshAfterRejection(id, rejected) {
      const r = row(id);
      if (r.reconnect_required) throw reconnectError(r);
      const running = refreshing.get(id);
      if (running) return (await running).access;
      const current = await readTokens(r);
      if (current.access !== rejected) return current.access; // someone else refreshed already
      return (await refreshShared(id)).access;
    },

    markReconnect,

    async disconnect(id) {
      const r = row(id);
      // Decrypt first (async); the check and the delete then happen in one synchronous transaction.
      const tokens = await vault
        .open(r.token_blob)
        .then(({ plainText }) => tokenBlobSchema.parse(parseJson(plainText)))
        .catch(() => null);
      db.transaction(() => {
        const current = q.byId.get(id);
        if (!current) return;
        if (q.activeJobs.get(id)!.n > 0) {
          throw new IpcError(
            'x_account_busy',
            `A post from @${current.handle} is still running or waiting to be checked. Finish it, Reconnect, or mark it as not posted first.`,
          );
        }
        q.delete.run(id);
        if (current.is_active) {
          const next = q.all.all()[0];
          if (next) q.setActive.run(next.id);
        }
      })();
      onChanged();
      if (tokens) await revoke(r.client_id, tokens);
    },

    revoke,
  };
}
