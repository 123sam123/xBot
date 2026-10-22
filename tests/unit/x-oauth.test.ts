import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { SCOPES } from '../../src/main/services/x/oauth';
import { fakeListen, fakeSafeStorage, json, setup, type Harness } from './x-harness';

// Connecting an account (OAuth 2.0 PKCE through a loopback callback) and
// storing its tokens, against a fake X API and a fake safeStorage.

let h: Harness;
afterEach(() => h?.close());

const count = (table: string) => h.db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;

/** A GET to the loopback listener, the way the browser follows X's redirect. */
function hit(url: string, host?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request(
      { host: '127.0.0.1', port: target.port, path: `${target.pathname}${target.search}`, headers: host ? { Host: host } : {} },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitFor<T>(get: () => T | undefined): Promise<T> {
  for (let i = 0; i < 500; i++) {
    const value = get();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('timed out');
}

function tokenRoute(scope = SCOPES.join(' ')) {
  h.api.on('POST /2/oauth2/token', (req) => {
    if (req.form?.get('grant_type') !== 'authorization_code') return json(400, { error: 'invalid_request' });
    h.api.users.set('connected-access', { id: '777', username: 'realhandle', name: 'Real Name' });
    return json(200, { token_type: 'bearer', access_token: 'connected-access', refresh_token: 'connected-refresh', expires_in: 7200, scope });
  });
}

describe('storage', () => {
  it.each([
    ['isEncryptionAvailable() is false', { available: false }, 'darwin'],
    ['the Linux backend is basic_text', { backend: 'basic_text' }, 'linux'],
  ])('refuses to connect and persists nothing when %s', async (_label, storage, platform) => {
    const listen = fakeListen(() => new Promise(() => {}));
    h = setup({ safeStorage: fakeSafeStorage(storage), platform, listen: listen.listen });
    await expect(h.service.connect()).rejects.toMatchObject({ code: 'x_secure_storage_unavailable' });
    expect(listen.calls).toHaveLength(0);
    expect(h.opened).toHaveLength(0);
    expect(h.api.log).toHaveLength(0);
    expect(count('x_accounts')).toBe(0);
  });
});

describe('connect', () => {
  it('runs PKCE S256 through a 127.0.0.1 callback, ignores a forged state, and shows the real handle', async () => {
    h = setup();
    tokenRoute();
    const connecting = h.service.connect();
    const authorize = new URL(await waitFor(() => h.opened[0]));

    expect(`${authorize.origin}${authorize.pathname}`).toBe('https://x.com/i/oauth2/authorize');
    const p = authorize.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('test-client-id-123');
    expect(p.get('scope')).toBe('tweet.read tweet.write users.read offline.access media.write');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const redirect = new URL(p.get('redirect_uri')!);
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe('/callback');

    // Another page can't end or hijack the flow.
    expect((await hit(`${redirect}?state=forged&code=evil`)).status).toBe(400);
    expect((await hit(`${redirect}?state=${p.get('state')}&code=abc`, `localhost:${redirect.port}`)).status).toBe(400);
    expect((await hit(`http://127.0.0.1:${redirect.port}/other?state=${p.get('state')}&code=abc`)).status).toBe(404);
    expect(h.service.state().connecting).toBe(true);

    const ok = await hit(`${redirect}?state=${p.get('state')}&code=the-code`);
    expect(ok.status).toBe(200);
    const { account, notice } = await connecting;
    expect(account).toMatchObject({ handle: 'realhandle', xUserId: '777', active: true });
    expect(notice).toBeNull();
    expect(h.service.state().accounts.map((a) => a.handle)).toEqual(['realhandle']);

    const exchange = h.api.requests('POST /2/oauth2/token')[0]!;
    expect(exchange.form?.get('client_id')).toBe('test-client-id-123');
    expect(exchange.form?.get('code')).toBe('the-code');
    expect(exchange.form?.get('redirect_uri')).toBe(redirect.toString());
    const verifier = exchange.form!.get('code_verifier')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(p.get('code_challenge'));
    expect(exchange.token).toBeNull(); // a public client: no Basic auth, no secret

    // Tokens are stored only sealed.
    const blob = h.db.prepare('SELECT token_blob FROM x_accounts').pluck().get() as Buffer;
    expect(blob.toString()).not.toContain('connected-access');
    expect(h.service.state().connecting).toBe(false);
  });

  it('refuses a sign-in that lacks the write scopes and revokes it', async () => {
    h = setup({ listen: fakeListen(async () => ({ kind: 'code', code: 'c' })).listen });
    tokenRoute('tweet.read users.read offline.access');
    await expect(h.service.connect()).rejects.toMatchObject({ code: 'x_scopes_missing' });
    expect(count('x_accounts')).toBe(0);
    expect(h.api.requests('POST /2/oauth2/revoke').length).toBeGreaterThan(0);
  });

  it('says so when the user declines on X', async () => {
    h = setup({ listen: fakeListen(async () => ({ kind: 'error', error: 'access_denied', description: null })).listen });
    await expect(h.service.connect()).rejects.toMatchObject({ code: 'x_connect_denied' });
    expect(count('x_accounts')).toBe(0);
  });

  it('asks for the Client ID first', async () => {
    h = setup({ config: () => ({ clientId: '', port: 0 }) });
    await expect(h.service.connect()).rejects.toMatchObject({ code: 'x_client_id_missing' });
    expect(h.opened).toHaveLength(0);
  });

  it('keeps @a needing a reconnect when the browser signs in as @b', async () => {
    h = setup({ listen: fakeListen(async () => ({ kind: 'code', code: 'c' })).listen });
    const a = await h.connect('alice');
    h.service.accounts.markReconnect(a);
    tokenRoute();
    const { account, notice } = await h.service.connect(a);
    expect(account.handle).toBe('realhandle');
    expect(notice).toMatch(/You signed in as @realhandle, not @alice/);
    const alice = h.service.state().accounts.find((acc) => acc.handle === 'alice')!;
    expect(alice).toMatchObject({ reconnectRequired: true, active: false });
  });
});

describe('tokens', () => {
  it('shares one refresh between concurrent callers and stores the rotated pair', async () => {
    h = setup();
    const id = await h.connect('builder', { refresh: 'refresh-old', expiresInMs: 30_000 });
    const [one, two] = await Promise.all([h.service.accounts.accessToken(id), h.service.accounts.accessToken(id)]);
    expect(one).toBe(two);
    expect(h.api.requests('POST /2/oauth2/token')).toHaveLength(1);
    expect(h.api.requests('POST /2/oauth2/token')[0]!.form?.get('refresh_token')).toBe('refresh-old');
    // The single-use refresh token was replaced: the next refresh sends the new one.
    h.clock.now += 3 * 60 * 60 * 1000;
    await h.service.accounts.accessToken(id);
    const second = h.api.requests('POST /2/oauth2/token')[1]!.form?.get('refresh_token');
    expect(second).toMatch(/^refresh-/);
    expect(second).not.toBe('refresh-old');
  });

  it('turns a rejected refresh into Reconnect', async () => {
    h = setup();
    const id = await h.connect('builder', { expiresInMs: 10_000 });
    h.api.on('POST /2/oauth2/token', () => json(400, { error: 'invalid_grant', error_description: 'Value passed for the token was invalid.' }));
    await expect(h.service.accounts.accessToken(id)).rejects.toMatchObject({ code: 'x_reconnect' });
    expect(h.service.state().accounts[0]).toMatchObject({ reconnectRequired: true });
    expect(h.service.status()).toMatchObject({ label: 'Reconnect X', tone: 'warning' });
  });

  it('turns a blob that no longer decrypts into Reconnect, without a crash', async () => {
    h = setup();
    const id = await h.connect('builder');
    const broken = h.relaunch({});
    h.db.prepare('UPDATE x_accounts SET token_blob = ? WHERE id = ?').run(Buffer.from('from another Mac'), id);
    await expect(broken.accounts.accessToken(id)).rejects.toMatchObject({ code: 'x_reconnect' });
    expect(broken.state().accounts[0]).toMatchObject({ reconnectRequired: true });
    broken.dispose();
  });
});
