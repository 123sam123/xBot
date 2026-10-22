import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createIpcHandler, isTrustedSender, type IpcEventLike, type TrustContext } from '../../src/main/ipc/core';
import type { Logger } from '../../src/main/log';

const rendererDir = '/Applications/xBot.app/Contents/Resources/app.asar/out/renderer';
const trust: TrustContext = {
  knownWebContentsIds: () => new Set([7]),
  devServerOrigin: null,
  rendererDir,
};
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function event(url: string, overrides: Partial<{ id: number; parent: unknown; frame: null }> = {}): IpcEventLike {
  return {
    sender: { id: overrides.id ?? 7 },
    senderFrame: overrides.frame === null ? null : { url, parent: overrides.parent ?? null },
  };
}

const composerUrl = `file://${rendererDir}/composer/index.html`;

function resizeHandler(fn = vi.fn(() => 'done')) {
  const handler = createIpcHandler({
    channel: 'windows:resize-composer',
    schema: z.strictObject({ height: z.number().int().min(80).max(2000) }),
    fn,
    trust: (e: IpcEventLike) => isTrustedSender(e, trust),
    log: silent,
  });
  return { handler, fn };
}

describe('IPC handler', () => {
  it('accepts a valid payload from an xBot window', async () => {
    const { handler, fn } = resizeHandler();
    await expect(handler(event(composerUrl), { height: 600 })).resolves.toEqual({ ok: true, data: 'done' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it.each([
    ['a missing field', {}],
    ['a wrong type', { height: '600' }],
    ['an out-of-range value', { height: 10 }],
    ['an unexpected extra field', { height: 600, x: 1 }],
    ['no payload at all', undefined],
  ])('rejects a bad payload: %s', async (_label, payload) => {
    const { handler, fn } = resizeHandler();
    const result = await handler(event(composerUrl), payload);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ['a remote page', event('https://evil.example/composer/index.html')],
    ['a local file outside the renderer folder', event('file:///Users/me/Downloads/evil.html')],
    ['a path that escapes the renderer folder', event(`file://${rendererDir}/../../evil.html`)],
    ['a webContents that is not an xBot window', event(composerUrl, { id: 99 })],
    ['a subframe of an xBot window', event(composerUrl, { parent: {} })],
    ['a sender without a frame', event(composerUrl, { frame: null })],
  ])('rejects a foreign sender: %s', async (_label, foreign) => {
    const { handler, fn } = resizeHandler();
    const result = await handler(foreign, { height: 600 });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(fn).not.toHaveBeenCalled();
  });

  it('in dev, trusts only the dev-server origin', () => {
    const dev: TrustContext = { ...trust, devServerOrigin: 'http://localhost:5173' };
    expect(isTrustedSender(event('http://localhost:5173/composer/index.html'), dev)).toBe(true);
    expect(isTrustedSender(event('http://localhost:5174/composer/index.html'), dev)).toBe(false);
    expect(isTrustedSender(event(composerUrl), dev)).toBe(false);
  });
});
