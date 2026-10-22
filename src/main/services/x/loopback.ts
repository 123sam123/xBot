import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { IpcError } from '../../ipc/core';

// The OAuth callback listener: the one local HTTP server xBot runs, and only
// while a sign-in waits for X (ARCHITECTURE.md → Security rules). It binds
// 127.0.0.1 (X requires the loopback IP, not `localhost`), answers only
// `GET /callback` with the expected Host, and ignores a request whose `state`
// doesn't match, so another web page can't end or hijack the sign-in. It
// closes after the callback, on cancel, or after the timeout.

export const CALLBACK_PATH = '/callback';

export type CallbackResult = { kind: 'code'; code: string } | { kind: 'error'; error: string; description: string | null };

export interface Loopback {
  /** The port actually bound (the requested one, or a free one when 0 was asked for, in tests). */
  port: number;
  /** Resolves with the matching callback; rejects with `x_connect_canceled` on close or timeout. */
  result: Promise<CallbackResult>;
  close(): void;
}

export interface LoopbackOptions {
  port: number;
  state: string;
  timeoutMs: number;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>xBot</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;background:#1c1d21;color:#f2f2f4;display:grid;place-items:center;height:100vh;margin:0}p{max-width:28em;text-align:center;line-height:1.5}</style>
</head><body><p><strong>Return to xBot</strong><br>xBot is finishing the connection. You can close this tab.</p></body></html>`;

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  });
  res.end(body);
}

export function startLoopback({ port, state, timeoutMs }: LoopbackOptions): Promise<Loopback> {
  return new Promise((resolveStart, rejectStart) => {
    let settle: ((r: CallbackResult) => void) | null = null;
    let fail: ((e: Error) => void) | null = null;
    const result = new Promise<CallbackResult>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    result.catch(() => {}); // a cancel before anyone awaits must not be an unhandled rejection
    let boundPort = port;
    let timer: NodeJS.Timeout | null = null;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
      if (req.headers.host !== `127.0.0.1:${boundPort}`) return send(res, 400, 'Bad request');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${boundPort}`);
      if (url.pathname !== CALLBACK_PATH) return send(res, 404, 'Not found');
      if (url.searchParams.get('state') !== state) return send(res, 400, 'This sign-in link is not the one xBot is waiting for.');
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (!error && !code) return send(res, 400, 'Bad request');
      send(res, 200, PAGE, 'text/html; charset=utf-8');
      finish();
      settle?.(error ? { kind: 'error', error, description: url.searchParams.get('error_description') } : { kind: 'code', code: code! });
    });
    server.keepAliveTimeout = 1000;

    const finish = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      server.close();
      server.closeIdleConnections?.();
    };

    server.once('error', (err: NodeJS.ErrnoException) => {
      finish();
      rejectStart(
        err.code === 'EADDRINUSE'
          ? new IpcError(
              'x_callback_port_busy',
              `Port ${port} is in use by another app. Quit it, or choose another port in Settings → X and register the new callback URL in your X app.`,
            )
          : new IpcError('x_callback_failed', 'xBot couldn’t listen for X’s answer on this Mac.'),
      );
    });

    server.listen(port, '127.0.0.1', () => {
      boundPort = (server.address() as AddressInfo).port;
      timer = setTimeout(() => {
        finish();
        fail?.(new IpcError('x_connect_canceled', 'The sign-in timed out. Connect again when you’re ready.'));
      }, timeoutMs);
      resolveStart({
        port: boundPort,
        result,
        close() {
          finish();
          fail?.(new IpcError('x_connect_canceled', 'The sign-in was canceled.'));
        },
      });
    });
  });
}
