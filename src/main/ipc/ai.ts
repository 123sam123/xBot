// Owned by T6 (XBOT-4BCGOR). A thin layer: payloads are validated here, and
// the service's IpcErrors pass straight through `handle()`.
import { z } from 'zod';
import { aiChannels } from '../../shared/contracts/ai.channels';
import {
  addExampleSchema,
  generateSchema,
  getStateSchema,
  pullSchema,
  removeExampleSchema,
  requestIdSchema,
  selectModelSchema,
  voicePatchSchema,
  type AiSource,
  type GeneratePayload,
} from '../../shared/contracts/ai';
import { ai } from '../services/ai';
import { handle } from './register';

/** The composer's request as prompt material: the draft, plus the note and the selected text when given. */
export function sourcesFor({ action, text, note, selection }: GeneratePayload): AiSource[] {
  const sources: AiSource[] = [{ name: 'draft', kind: 'draft', text }];
  if (note && note.trim() !== '') sources.push({ name: 'note', kind: 'note', text: note });
  if (action === 'selection' && selection) {
    sources.push({ name: 'selection', kind: 'selection', text: text.slice(selection.start, selection.end) });
  }
  return sources;
}

export function registerAiIpc(): void {
  handle(aiChannels.getState, getStateSchema, ({ refresh }) => ai().probe(refresh));
  handle(aiChannels.selectModel, selectModelSchema, ({ model }) => ai().selectModel(model));
  handle(aiChannels.generate, generateSchema, (payload) =>
    ai().generate({ requestId: payload.requestId, action: payload.action, sources: sourcesFor(payload), priority: 'interactive' }),
  );
  handle(aiChannels.cancel, requestIdSchema, ({ requestId }) => {
    ai().cancel(requestId);
    return null;
  });
  handle(aiChannels.pull, pullSchema, ({ model }) => {
    ai().pull(model);
    return null;
  });
  handle(aiChannels.cancelPull, z.undefined(), () => {
    ai().cancelPull();
    return null;
  });
  handle(aiChannels.getVoice, z.undefined(), () => ai().getVoice());
  handle(aiChannels.saveVoice, voicePatchSchema, (patch) => ai().saveVoice(patch));
  handle(aiChannels.addExample, addExampleSchema, ({ text }) => ai().addExample(text));
  handle(aiChannels.removeExample, removeExampleSchema, ({ id }) => ai().removeExample(id));
  handle(aiChannels.deriveStyleBrief, requestIdSchema, ({ requestId }) => ai().deriveStyleBrief(requestId));
}
