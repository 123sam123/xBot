import type { PublishJobError } from '../../../shared/contracts/x';
import { IpcError } from '../../ipc/core';
import { XApiError } from './api';

// The error catalog (docs/X.md → Troubleshooting): what an X failure means for
// the user, in words, with a stable code the renderer maps to an action.

/** X's wording for a duplicate post (403). Matched exactly, not as a substring. */
const DUPLICATE_DETAIL = /^you are not allowed to create a (tweet|post) with duplicate content\.?$/i;

export function isDuplicate(err: XApiError): boolean {
  return err.status === 403 && DUPLICATE_DETAIL.test(err.detail.trim());
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Where the failing call was made, which changes what a 400 / 403 means. */
export type XCallSite = 'auth' | 'media' | 'create' | 'read';

/** A user-facing error for an X API failure. `handle` names the account in "Reconnect @handle". */
export function describeApiError(err: unknown, site: XCallSite, handle?: string): PublishJobError {
  if (!(err instanceof XApiError)) {
    if (err instanceof IpcError) return { code: err.code, message: err.message };
    return { code: 'x_failed', message: 'Something went wrong while talking to X.' };
  }
  const problem = err.problem ?? '';
  if (err.kind === 'timeout') return { code: 'x_timeout', message: 'X didn’t answer in time.' };
  if (err.kind === 'network') return { code: 'x_network', message: 'X couldn’t be reached. Check your connection.' };
  if (err.kind === 'aborted') return { code: 'x_canceled', message: 'Stopped.' };
  if (err.kind === 'invalid_response') return { code: 'x_failed', message: err.detail };

  if (err.status === 429) {
    const until = err.resetAt ? ` until ${clock(err.resetAt)}` : ' for now';
    return {
      code: 'x_rate_limited',
      message: `X rate-limited this account${until}.`,
      ...(err.resetAt ? { resetAt: new Date(err.resetAt).toISOString() } : {}),
    };
  }
  if (err.status === 401 || problem === 'invalid_grant') {
    return { code: 'x_reconnect', message: `X no longer accepts xBot’s sign-in${handle ? ` for @${handle}` : ''}. Reconnect to keep posting.` };
  }
  if (err.status === 402 || problem.endsWith('/usage-capped') || /credit/i.test(err.detail)) {
    return {
      code: 'x_credits',
      message: 'Your X developer account is out of API credits or hit its spending limit. Add credits or raise the limit in the X Developer Console.',
    };
  }
  if (site === 'create' && isDuplicate(err)) {
    return { code: 'x_duplicate', message: 'X already has an identical post from this account. Change the text to post it again.' };
  }
  if (site === 'media' && (err.status === 400 || err.status === 403 || err.status === 413 || err.status === 415)) {
    return { code: 'x_media_rejected', message: `X rejected the media: ${err.detail}` };
  }
  if (err.status === 403) {
    if (site === 'create' && /video|media|image|gif/i.test(err.detail)) return { code: 'x_media_rejected', message: `X rejected the media: ${err.detail}` };
    return { code: 'x_access', message: `Your X app doesn’t have access to this: ${err.detail}` };
  }
  if ((err.status ?? 0) >= 500) return { code: 'x_unavailable', message: 'X is having trouble right now. Try again in a moment.' };
  if (site === 'auth') return { code: 'x_connect_failed', message: `X refused the sign-in: ${err.detail}` };
  return { code: 'x_failed', message: `X refused the request: ${err.detail}` };
}

/** The same, thrown across IPC. */
export function apiIpcError(err: unknown, site: XCallSite, handle?: string): IpcError {
  const { code, message } = describeApiError(err, site, handle);
  return new IpcError(code, message);
}
