import { afterEach, describe, expect, it } from 'vitest';
import { pickDefault } from '../../src/main/services/ai/catalog';
import { assessModel, isCloudName, MIN_LOCAL_MODEL_BYTES } from '../../src/main/services/ai/locality';
import type { OllamaShow, OllamaTag } from '../../src/main/services/ai/ollamaClient';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import { GEMMA_TAG, json, makeService, startMockOllama, type MockOllama, type TestService } from './helpers/mockOllama';

// SPEC §22 "Cloud-model rejection": a model is used only when xBot can
// establish it runs on this Mac. Cloud names, remote metadata and anything
// unverifiable are refused, and refused models never reach /api/chat.

installLoopbackFetchSpy({ expectRequests: true });

const tag = (over: Partial<OllamaTag> = {}): OllamaTag => ({ ...GEMMA_TAG, ...over });
const show = (over: Partial<OllamaShow> = {}): OllamaShow => ({ capabilities: ['completion'], ...over });

describe('cloud model names (Ollama’s own modelref rule)', () => {
  it.each(['gemma4:cloud', 'gemma4:31b-cloud', 'gpt-oss:120b-cloud', 'kimi-k3:CLOUD', 'gpt-oss:20b:cloud', 'qwen3-coder:480b-cloud '])('%s is cloud', (name) => {
    expect(isCloudName(name)).toBe(true);
  });

  it.each(['gemma3:4b', 'llama3.2:3b', 'cloud-tools:latest', 'my-cloud-model', 'hf.co/user/repo-cloud', 'gemma3:4b:local'])('%s is not', (name) => {
    expect(isCloudName(name)).toBe(false);
  });
});

describe('assessModel', () => {
  it('accepts a model with local weights and the completion capability', () => {
    expect(assessModel(tag(), show()).verdict).toBe('local');
  });

  it('rejects a model with remote_host or remote_model, on the tag or on show', () => {
    expect(assessModel(tag({ remote_host: 'https://ollama.com:443' }), show()).verdict).toBe('remote');
    expect(assessModel(tag({ remote_model: 'gpt-oss:120b' }), show()).verdict).toBe('remote');
    expect(assessModel(tag(), show({ remote_host: 'https://ollama.com:443' })).verdict).toBe('remote');
    expect(assessModel(tag(), show({ remote_model: 'gpt-oss:120b' })).verdict).toBe('remote');
  });

  it('rejects a :cloud or -cloud name even when the metadata looks local', () => {
    expect(assessModel(tag({ name: 'gemma4:cloud' }), show()).verdict).toBe('remote');
    expect(assessModel(tag({ name: 'gpt-oss:120b-cloud' }), show()).verdict).toBe('remote');
  });

  it('treats unknown metadata as unverifiable', () => {
    expect(assessModel(tag(), null).verdict).toBe('unverifiable'); // /api/show failed
    expect(assessModel(tag(), { details: {} } as OllamaShow).verdict).toBe('unverifiable'); // no capabilities (older Ollama)
    expect(assessModel(tag({ size: MIN_LOCAL_MODEL_BYTES - 1 }), show()).verdict).toBe('unverifiable'); // a stub, not weights
  });

  it('rejects embedding-only models and anything without completion', () => {
    expect(assessModel(tag(), show({ capabilities: ['embedding'] })).verdict).toBe('unsuitable');
    expect(assessModel(tag(), show({ capabilities: ['vision'] })).verdict).toBe('unsuitable');
  });

  it('never picks a model that is not local by default', () => {
    const base = { digest: 'd', sizeBytes: 3e9, parameterSize: null, reason: '' };
    expect(
      pickDefault([
        { ...base, name: 'gemma3:4b', verdict: 'unverifiable' },
        { ...base, name: 'gemma4:cloud', verdict: 'remote' },
      ]),
    ).toBeNull();
    expect(
      pickDefault([
        { ...base, name: 'mistral:7b', verdict: 'local', sizeBytes: 4e9 },
        { ...base, name: 'gemma3:4b', verdict: 'local' },
      ]),
    ).toBe('gemma3:4b');
  });
});

describe('refused models never generate', () => {
  let mock: MockOllama;
  let t: TestService;
  afterEach(async () => {
    t?.close();
    await mock?.close();
  });

  const generate = () =>
    t.service.generate({ requestId: crypto.randomUUID(), action: 'shorter', sources: [{ name: 'draft', kind: 'draft', text: 'Shipped drafts today.' }], priority: 'interactive' });

  it('unknown metadata (no capabilities from /api/show) blocks generation', async () => {
    mock = await startMockOllama();
    mock.routes['POST /api/show'] = (_req, res) => json(res, { details: GEMMA_TAG.details, model_info: {} });
    t = makeService(mock.endpoint, { settings: { model: 'gemma3:4b' } });
    await expect(generate()).rejects.toMatchObject({ code: 'model_unverifiable' });
    expect(mock.hits('/api/chat')).toHaveLength(0);
  });
});
