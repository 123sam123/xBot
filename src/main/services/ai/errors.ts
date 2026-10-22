import { aiCopy } from '../../../shared/aiCopy';
import { IpcError } from '../../ipc/core';
import { OllamaError } from './ollamaClient';

// Turns what went wrong into the `ai` domain's IpcError codes and their one
// copy of the text (ARCHITECTURE.md → "Local AI", the error table). No
// `electron` import: the service throws these, and IPC passes them through.

export type ErrorContext = { phase: 'probe' } | { phase: 'generate'; model: string } | { phase: 'pull'; model: string };

const CONTEXT_OVERFLOW = /context (length|size)/i;

export function toIpcError(err: unknown, ctx: ErrorContext, endpoint: string): IpcError {
  if (err instanceof IpcError) return err;
  if (!(err instanceof OllamaError)) {
    return new IpcError('ai_failed', aiCopy.errors.ai_failed('model' in ctx ? ctx.model : 'Ollama', err instanceof Error ? err.message : String(err)));
  }
  const model = 'model' in ctx ? ctx.model : '';
  const e = aiCopy.errors;
  switch (err.code) {
    case 'unreachable':
      return new IpcError('ollama_unavailable', e.ollama_unavailable);
    case 'timeout':
      return ctx.phase === 'probe' ? new IpcError('ollama_unavailable', e.ollama_unavailable) : ctx.phase === 'pull' ? new IpcError('pull_failed', e.pull_failed('the download stalled')) : new IpcError('ai_timeout', e.ai_timeout);
    case 'redirect_refused':
      return new IpcError('endpoint_refused', e.endpoint_refused);
    case 'endpoint_invalid':
      return new IpcError('endpoint_invalid', e.endpoint_invalid);
    case 'endpoint_proxied':
      return new IpcError('endpoint_proxied', e.endpoint_proxied);
    case 'remote_refused':
      return new IpcError('remote_refused', e.remote_refused(model || 'This model'));
    case 'bad_response':
      return ctx.phase === 'probe' ? new IpcError('endpoint_not_ollama', e.endpoint_not_ollama(endpoint)) : new IpcError('ai_failed', e.ai_failed(model, 'an unexpected response'));
    case 'stream_error':
      return ctx.phase === 'pull' ? new IpcError('pull_failed', e.pull_failed('the connection to Ollama dropped')) : new IpcError('ai_stopped', e.ai_stopped);
    case 'malformed':
    case 'too_long':
      return new IpcError('ai_malformed', e.ai_malformed);
    case 'aborted':
    case 'preempted':
      return new IpcError('ai_cancelled', 'Cancelled.');
    case 'http_error': {
      const detail = err.detail ?? `HTTP ${err.status ?? '?'}`;
      if (ctx.phase === 'pull') return new IpcError('pull_failed', e.pull_failed(detail));
      if (/^ollama cloud is disabled/i.test(detail) || err.status === 403) return new IpcError('remote_refused', e.remote_refused(model || 'This model'));
      if (CONTEXT_OVERFLOW.test(detail)) return new IpcError('ai_input_too_long', e.ai_input_too_long);
      if (err.status === 404 && ctx.phase === 'generate') return new IpcError('model_needed', e.model_needed);
      if (ctx.phase === 'probe') return new IpcError('endpoint_not_ollama', e.endpoint_not_ollama(endpoint));
      return new IpcError('ai_failed', e.ai_failed(model, detail));
    }
  }
}
