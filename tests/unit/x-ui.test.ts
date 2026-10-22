import { describe, expect, it } from 'vitest';
import type { PublishJob, XAccount, XState } from '../../src/shared/contracts/x';
import { accountMenuEntries, accountTrigger } from '../../src/renderer/composer/account/accountMenu';
import { shouldStartFreshDraft } from '../../src/renderer/composer/publish/freshDraft';
import { jobView, pickJob } from '../../src/renderer/composer/publish/jobView';

// The composer's X states as data: the header's account menu, the publish job
// row, and when a posted draft makes way for a fresh one.

const account = (handle: string, extra: Partial<XAccount> = {}): XAccount => ({
  id: `${handle}-id`,
  xUserId: `${handle}-x`,
  handle,
  name: handle,
  active: false,
  reconnectRequired: false,
  ...extra,
});
const state = (extra: Partial<XState> = {}): XState => ({ clientIdSet: true, callbackUrl: 'http://127.0.0.1:47813/callback', accounts: [], connecting: false, ...extra });
const job = (extra: Partial<PublishJob> = {}): PublishJob => ({
  id: 'job',
  draftId: 'draft',
  accountHandle: 'alice',
  frozenText: 'Hello',
  mediaIds: [],
  status: 'queued',
  progress: null,
  remotePostId: null,
  remoteUrl: null,
  error: null,
  attempts: 0,
  uncertain: false,
  dismissed: false,
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
  ...extra,
});
const NOW = Date.parse('2026-10-22T10:05:00Z');

describe('account menu', () => {
  it('asks for the Client ID before offering to connect', () => {
    expect(accountTrigger(state({ clientIdSet: false }))).toEqual({ kind: 'disconnected' });
    expect(accountMenuEntries(state({ clientIdSet: false }))).toEqual([expect.objectContaining({ label: 'Set up X posting…', action: { kind: 'settings' } })]);
    expect(accountMenuEntries(state())).toEqual([expect.objectContaining({ label: 'Connect X account', action: { kind: 'connect' } })]);
  });

  it('lists the real accounts, checks the active one, and offers switch, add and disconnect', () => {
    const s = state({ accounts: [account('alice', { active: true }), account('bob')] });
    expect(accountTrigger(s)).toEqual({ kind: 'connected', handle: '@alice', reconnect: false });
    const entries = accountMenuEntries(s);
    expect(entries.map((e) => e.label)).toEqual(['@alice', '@bob', 'Add another account…', 'Disconnect @alice']);
    expect(entries[0]).toMatchObject({ checked: true, action: undefined });
    expect(entries[1]).toMatchObject({ checked: false, action: { kind: 'switch', accountId: 'bob-id' } });
    expect(entries[3]!.action).toEqual({ kind: 'disconnect', accountId: 'alice-id' });
  });

  it('offers Reconnect for an account whose sign-in expired, and Cancel while signing in', () => {
    const s = state({ accounts: [account('alice', { active: true, reconnectRequired: true })] });
    expect(accountTrigger(s)).toMatchObject({ reconnect: true });
    expect(accountMenuEntries(s).find((e) => e.id === 'reconnect')?.action).toEqual({ kind: 'reconnect', accountId: 'alice-id' });
    expect(accountTrigger(state({ connecting: true }))).toEqual({ kind: 'connecting' });
    expect(accountMenuEntries(state({ connecting: true })).map((e) => e.label)).toContain('Cancel sign-in');
  });
});

describe('job view', () => {
  it('shows progress, posting, and the real link', () => {
    expect(jobView(job({ status: 'uploading', progress: { phase: 'upload', percent: 41.6 } }), NOW)).toMatchObject({ label: 'Uploading 42%', percent: 42, actions: ['cancel'] });
    expect(jobView(job({ status: 'processing', progress: { phase: 'processing', percent: 30 } }), NOW)?.label).toBe('X is processing the media 30%');
    expect(jobView(job({ status: 'publishing' }), NOW)).toMatchObject({ label: 'Posting to X…', actions: [] });
    expect(jobView(job({ status: 'published', remoteUrl: 'https://x.com/i/web/status/1' }), NOW)).toMatchObject({ tone: 'ok', url: 'https://x.com/i/web/status/1', actions: ['open', 'dismiss'] });
  });

  it('offers the action that fixes each failure', () => {
    const failed = (code: string, resetAt?: string) => jobView(job({ status: 'failed', error: { code, message: code, ...(resetAt ? { resetAt } : {}) } }), NOW)!.actions;
    expect(failed('x_reconnect')).toEqual(['reconnect', 'fallback', 'dismiss']);
    expect(failed('x_credits')).toEqual(['fallback', 'dismiss']);
    expect(failed('x_rate_limited', '2026-10-22T10:20:00Z')).toEqual(['fallback', 'dismiss']);
    expect(failed('x_rate_limited', '2026-10-22T10:01:00Z')).toEqual(['retry', 'fallback', 'dismiss']);
    expect(failed('x_interrupted')).toEqual(['retry', 'dismiss']);
    expect(failed('x_duplicate')).toEqual(['dismiss']);
  });

  it('sends an uncertain post to the reconcile sheet, never to a retry button', () => {
    const view = jobView(job({ status: 'needs_reconciliation', uncertain: true, error: { code: 'x_uncertain', message: '…' } }), NOW)!;
    expect(view).toMatchObject({ reconcile: true, actions: ['check'] });
  });

  it('shows the current draft’s job first, and hides dismissed or canceled ones', () => {
    const mine = job({ id: 'mine', draftId: 'current', createdAt: '2026-10-22T09:00:00.000Z' });
    const newer = job({ id: 'newer', draftId: 'other', createdAt: '2026-10-22T10:00:00.000Z' });
    expect(pickJob([newer, mine], 'current', NOW)?.id).toBe('mine');
    expect(pickJob([newer, mine], 'unrelated', NOW)?.id).toBe('newer');
    expect(pickJob([job({ dismissed: true, status: 'published' }), job({ id: 'c', status: 'canceled' })], 'draft', NOW)).toBeNull();
  });
});

describe('fresh draft after a post', () => {
  const posted = job({ status: 'published', frozenText: 'Hello', mediaIds: ['m1'] });
  it('starts one only while the composer still shows exactly what was posted', () => {
    expect(shouldStartFreshDraft(posted, { draftId: 'draft', text: 'Hello', mediaIds: ['m1'] })).toBe(true);
    expect(shouldStartFreshDraft(posted, { draftId: 'draft', text: 'Hello, and more', mediaIds: ['m1'] })).toBe(false);
    expect(shouldStartFreshDraft(posted, { draftId: 'draft', text: 'Hello', mediaIds: ['m1', 'm2'] })).toBe(false);
    expect(shouldStartFreshDraft(posted, { draftId: 'another', text: 'Hello', mediaIds: ['m1'] })).toBe(false);
    expect(shouldStartFreshDraft({ ...posted, status: 'publishing' }, { draftId: 'draft', text: 'Hello', mediaIds: ['m1'] })).toBe(false);
  });
});
