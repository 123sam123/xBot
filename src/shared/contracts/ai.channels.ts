// Owned by T6 (XBOT-4BCGOR).
export const aiChannels = {
  getState: 'ai:get-state',
  selectModel: 'ai:select-model',
  generate: 'ai:generate',
  cancel: 'ai:cancel',
  /** Starts a catalog download; progress and completion arrive through `ai:state`. */
  pull: 'ai:pull',
  cancelPull: 'ai:cancel-pull',
  getVoice: 'ai:get-voice',
  saveVoice: 'ai:save-voice',
  addExample: 'ai:add-example',
  removeExample: 'ai:remove-example',
  deriveStyleBrief: 'ai:derive-style-brief',
} as const;
