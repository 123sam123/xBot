import { totalmem } from 'node:os';
import { describe, expect, it } from 'vitest';
import { storyOutput } from '../../src/main/services/ai/schemas';
import { AI_ANGLES } from '../../src/shared/contracts/ai';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import { makeService } from './helpers/mockOllama';

// A live smoke test against this Mac's own Ollama with gemma3:4b, through the
// real service (locality check, memory rules, prompt, structured output). It
// skips, saying why, when Ollama or the model is not there.

installLoopbackFetchSpy({ expectRequests: true });

const ENDPOINT = 'http://127.0.0.1:11434';

describe('live local Ollama', () => {
  it('gemma3:4b returns three schema-valid options, one per angle', { timeout: 180_000 }, async (ctx) => {
    const t = makeService(ENDPOINT, { settings: { model: 'gemma3:4b' }, totalMemBytes: totalmem() });
    try {
      const state = await t.service.probe('force');
      if (state.phase === 'not_running') return ctx.skip('Ollama not reachable at 127.0.0.1:11434');
      const model = state.models.find((m) => m.name === 'gemma3:4b');
      if (!model) return ctx.skip('gemma3:4b not installed');
      if (model.verdict !== 'local') return ctx.skip(`gemma3:4b verdict is ${model.verdict}`);

      const result = await t.service.generate({
        requestId: crypto.randomUUID(),
        action: 'story',
        sources: [
          { name: 'draft', kind: 'draft', text: '' },
          { name: 'note', kind: 'note', text: 'Built a tiny macOS menu bar app that reminds me to post what I build, with drafts that survive a restart.' },
        ],
        priority: 'interactive',
      });

      expect(result.status).toBe('done');
      if (result.status !== 'done') return;
      expect(result.options.map((o) => o.angle)).toEqual(AI_ANGLES);
      const fields = Object.fromEntries(result.options.map((o) => [o.angle, o.text]));
      expect(storyOutput.safeParse(fields).success).toBe(true);
    } finally {
      t.close();
    }
  });
});
