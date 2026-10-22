import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraftsService } from '../../src/main/services/drafts/service';
import { statusFor } from '../../src/main/services/ai/status';
import type { ServiceContext } from '../../src/main/services/types';
import type { AiResult } from '../../src/shared/contracts/ai';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import {
  chatLines,
  closedPort,
  GEMMA_TAG,
  json,
  makeService,
  ndjson,
  startMockOllama,
  STORY_JSON,
  type MockOllama,
  type TestService,
} from './helpers/mockOllama';

// SPEC §22 "Ollama unavailable/model missing", "Cloud-model rejection" and
// "Generation cancellation and malformed responses", against a mock Ollama
// on 127.0.0.1. The draft is the user's: AI failures and cancels never touch it.

installLoopbackFetchSpy({ expectRequests: true });

let mock: MockOllama | null = null;
let t: TestService | null = null;
afterEach(async () => {
  t?.close();
  t = null;
  await mock?.close();
  mock = null;
});

const DRAFT = 'Shipped autosaved drafts for my menu bar app today.';

function seedDraft(s: TestService) {
  const drafts = createDraftsService(s.db, { events: new EventEmitter() as ServiceContext['events'] });
  const draft = drafts.getCurrent();
  const { updatedAt } = drafts.update(draft.id, DRAFT);
  return { drafts, id: draft.id, updatedAt };
}

function story(s: TestService, requestId: string = crypto.randomUUID()): Promise<AiResult> {
  return s.service.generate({ requestId, action: 'story', sources: [{ name: 'draft', kind: 'draft', text: DRAFT }], priority: 'interactive' });
}

describe('Ollama unavailable or model missing', () => {
  it('connection refused reads "Ollama not running", and generation says so', async () => {
    t = makeService(`http://127.0.0.1:${await closedPort()}`);
    const state = await t.service.probe('force');
    expect(state.phase).toBe('not_running');
    expect(statusFor(state)).toMatchObject({ label: 'Ollama not running', tone: 'warning' });
    await expect(story(t)).rejects.toMatchObject({ code: 'ollama_unavailable' });
  });

  it('an empty model list reads "Model needed"', async () => {
    mock = await startMockOllama();
    mock.routes['GET /api/tags'] = (_req, res) => json(res, { models: [] });
    t = makeService(mock.endpoint);
    const state = await t.service.probe('force');
    expect(state.phase).toBe('model_needed');
    expect(statusFor(state)).toMatchObject({ label: 'Model needed', tone: 'warning' });
    await expect(story(t)).rejects.toMatchObject({ code: 'model_needed' });
    expect(mock.hits('/api/chat')).toHaveLength(0);
  });

  it('a selected model that was deleted reads "Model needed"', async () => {
    mock = await startMockOllama();
    t = makeService(mock.endpoint, { settings: { model: 'llama3.2:3b' } });
    expect((await t.service.probe('force')).phase).toBe('model_needed');
    await expect(story(t)).rejects.toMatchObject({ code: 'model_needed' });
  });

  it('with gemma3:4b installed and local, it is picked and AI is ready', async () => {
    mock = await startMockOllama();
    t = makeService(mock.endpoint);
    const state = await t.service.probe('force');
    expect(state).toMatchObject({ phase: 'ready', selected: 'gemma3:4b', selectedVerdict: 'local', cloudDisabled: true });
    expect(statusFor(state)).toMatchObject({ label: 'Local AI ready', tone: 'ok' });
  });
});

describe('cloud and unverifiable models never reach /api/chat', () => {
  it('a :cloud model', async () => {
    mock = await startMockOllama();
    mock.routes['GET /api/tags'] = (_req, res) => json(res, { models: [{ ...GEMMA_TAG, name: 'gemma4:cloud', digest: 'c1' }] });
    t = makeService(mock.endpoint, { settings: { model: 'gemma4:cloud' } });
    await expect(story(t)).rejects.toMatchObject({ code: 'remote_refused' });
    expect(mock.hits('/api/chat')).toHaveLength(0);
  });

  it('remote_host reported by /api/show', async () => {
    mock = await startMockOllama();
    mock.routes['POST /api/show'] = (_req, res) => json(res, { capabilities: ['completion'], remote_host: 'https://ollama.com:443', remote_model: 'gemma3:4b' });
    t = makeService(mock.endpoint, { settings: { model: 'gemma3:4b' } });
    await expect(story(t)).rejects.toMatchObject({ code: 'remote_refused' });
    expect(mock.hits('/api/chat')).toHaveLength(0);
  });

  it('/api/show failing (locality unknown)', async () => {
    mock = await startMockOllama();
    mock.routes['POST /api/show'] = (_req, res) => json(res, { error: 'boom' }, 500);
    t = makeService(mock.endpoint, { settings: { model: 'gemma3:4b' } });
    await expect(story(t)).rejects.toMatchObject({ code: 'model_unverifiable' });
    expect(mock.hits('/api/chat')).toHaveLength(0);
  });

  it('a stream that turns out to come from a remote host is refused', async () => {
    mock = await startMockOllama();
    mock.routes['POST /api/chat'] = (_req, res) => ndjson(res, chatLines(STORY_JSON, { extra: { remote_host: 'https://ollama.com:443' } }));
    t = makeService(mock.endpoint);
    await expect(story(t)).rejects.toMatchObject({ code: 'remote_refused' });
  });
});

describe('malformed responses', () => {
  it('retries twice with a repair prompt, then fails gracefully and leaves the draft alone', async () => {
    mock = await startMockOllama();
    mock.routes['POST /api/chat'] = (_req, res) => ndjson(res, chatLines('Sure! Here are some posts: 1) shipped it'));
    t = makeService(mock.endpoint);
    const draft = seedDraft(t);

    await expect(story(t)).rejects.toMatchObject({ code: 'ai_malformed' });

    const chats = mock.hits('/api/chat').map((r) => r.body as { messages: { role: string; content: string }[]; options: { temperature: number } });
    expect(chats).toHaveLength(3);
    expect(chats[0]!.options.temperature).toBe(0.6);
    for (const repair of chats.slice(1)) {
      expect(repair.options.temperature).toBe(0.2);
      expect(repair.messages.at(-2)).toMatchObject({ role: 'assistant' });
      expect(repair.messages.at(-1)?.content).toMatch(/wasn’t valid for the requested shape/);
    }
    expect(draft.drafts.get(draft.id)).toMatchObject({ text: DRAFT, updatedAt: draft.updatedAt });
    expect(t.service.state().running).toBeNull();
  });

  it('a repaired answer is validated and returned as three options, one per angle', async () => {
    mock = await startMockOllama();
    let calls = 0;
    mock.routes['POST /api/chat'] = (_req, res) => {
      calls += 1;
      ndjson(res, chatLines(calls === 1 ? '{"problem_solution": "only one"' : STORY_JSON));
    };
    t = makeService(mock.endpoint);
    const result = await story(t);
    expect(calls).toBe(2);
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.options.map((o) => o.angle)).toEqual(['problem_solution', 'progress_lesson', 'funny_observation']);
    expect(result.options.every((o) => o.text.length > 0 && o.text.length <= 280)).toBe(true);
  });
});

describe('cancellation', () => {
  it('Cancel aborts the stream within 1 s, resolves "cancelled" and keeps the draft', async () => {
    mock = await startMockOllama();
    const endless = Array.from({ length: 600 }, () => ({ message: { role: 'assistant', content: 'x' }, done: false }));
    mock.routes['POST /api/chat'] = (_req, res) => ndjson(res, endless, { intervalMs: 100, end: false });
    t = makeService(mock.endpoint);
    const draft = seedDraft(t);
    const requestId = crypto.randomUUID();

    const pending = story(t, requestId);
    await expect.poll(() => mock!.hits('/api/chat').length, { timeout: 3000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300)); // let it stream a few lines

    const cancelledAt = Date.now();
    t.service.cancel(requestId);
    const result = await pending;
    const resolvedAt = Date.now();
    const socketClosedAt = await mock.hits('/api/chat')[0]!.closed;

    expect(result).toEqual({ status: 'cancelled' });
    expect(resolvedAt - cancelledAt).toBeLessThan(1000);
    expect(socketClosedAt - cancelledAt).toBeLessThan(1000);
    expect(draft.drafts.get(draft.id)).toMatchObject({ text: DRAFT, updatedAt: draft.updatedAt });
    expect(t.service.state().running).toBeNull();
  });

  it('a queued request cancels without sending anything', async () => {
    mock = await startMockOllama();
    const endless = Array.from({ length: 600 }, () => ({ message: { role: 'assistant', content: 'x' }, done: false }));
    mock.routes['POST /api/chat'] = (_req, res) => ndjson(res, endless, { intervalMs: 100, end: false });
    t = makeService(mock.endpoint);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const running = story(t, first);
    await expect.poll(() => mock!.hits('/api/chat').length, { timeout: 3000 }).toBe(1);
    const queued = story(t, second);
    t.service.cancel(second);
    await expect(queued).resolves.toEqual({ status: 'cancelled' });
    t.service.cancel(first);
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(mock.hits('/api/chat')).toHaveLength(1);
  });
});
