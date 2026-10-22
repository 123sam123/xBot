// Owned by T6 (XBOT-4BCGOR).
import type { AiApi } from '../../shared/contracts/ai';
import { aiChannels } from '../../shared/contracts/ai.channels';
import { invoke } from '../invoke';

export const ai: AiApi = {
  getState: (refresh) => invoke(aiChannels.getState, { refresh }),
  selectModel: (model) => invoke(aiChannels.selectModel, { model }),
  generate: (payload) => invoke(aiChannels.generate, payload),
  cancel: (requestId) => invoke(aiChannels.cancel, { requestId }),
  pull: (model) => invoke(aiChannels.pull, { model }),
  cancelPull: () => invoke(aiChannels.cancelPull),
  getVoice: () => invoke(aiChannels.getVoice),
  saveVoice: (patch) => invoke(aiChannels.saveVoice, patch),
  addExample: (text) => invoke(aiChannels.addExample, { text }),
  removeExample: (id) => invoke(aiChannels.removeExample, { id }),
  deriveStyleBrief: (requestId) => invoke(aiChannels.deriveStyleBrief, { requestId }),
};
