// Every user-facing string of the `ai` domain, in one place. Main uses it for
// error messages, status chips and guidance; the renderer for the sheet,
// onboarding and settings. Zod-free and Node-free, so both sides import it.

export const aiCopy = {
  honestCost:
    'Local AI runs on this Mac through Ollama. There are no per-request fees, but it uses this Mac’s memory, compute, storage and power. Small models write weaker drafts, so edit freely.',
  cloudOffIntro: 'To keep Ollama local-only, add this to ~/.ollama/server.json:',
  cloudOffConfig: '{ "disable_ollama_cloud": true }',
  cloudOffAlternative: 'or run: launchctl setenv OLLAMA_NO_CLOUD 1',
  cloudOffOutro: 'Then quit and reopen Ollama. Its log will say “Ollama cloud disabled: true”. xBot never changes this for you.',
  offline: 'Downloads use the network once. After that, local AI works offline.',
  lowResource: 'Smaller context, and the model is unloaded after each request.',
  installUrl: 'https://ollama.com/download',

  chip: {
    ready: 'Local AI ready',
    notRunning: 'Ollama not running',
    notRunningDetail: 'Open Ollama, or install it from ollama.com.',
    modelNeeded: 'Model needed',
    checking: 'Checking local AI…',
    downloading: (model: string, percent: number) => `Downloading ${model} · ${percent}%`,
  },

  guidance: {
    checking: 'Checking for Ollama on this Mac…',
    noModels: 'Choose a model to download. It runs on this Mac.',
    ready: (model: string) => `Local AI is ready with ${model}.`,
  },

  errors: {
    ollama_unavailable: 'Ollama isn’t running. Open Ollama, then try again.',
    endpoint_not_ollama: (endpoint: string) => `Something other than Ollama answered at ${endpoint}.`,
    endpoint_invalid:
      'Only this Mac’s Ollama is allowed: http://127.0.0.1:<port>, http://localhost:<port> or http://[::1]:<port>.',
    endpoint_refused: 'The Ollama endpoint redirected elsewhere, so xBot stopped.',
    endpoint_proxied:
      'A proxy is set for xBot (HTTP_PROXY), so xBot won’t send AI requests. Add 127.0.0.1 to NO_PROXY, or unset it.',
    model_needed: 'Choose a model on this Mac first.',
    model_unverifiable: (model: string) =>
      `xBot can’t confirm ${model} runs on this Mac, so it won’t use it. Update Ollama or choose another model.`,
    remote_refused: (model: string) => `${model} runs in the cloud. xBot only uses models on this Mac.`,
    ai_timeout: 'Local AI took too long. Ollama may be busy with something else. Try again, or turn on low-resource mode.',
    ai_stopped: 'Ollama stopped while writing. Your text is unchanged.',
    ai_input_too_long: 'That’s too much text for this model’s context. Shorten it, or turn off low-resource mode.',
    ai_would_evict: (model: string) =>
      `Ollama is holding other models in memory, and loading ${model} now could unload them. Try again when they’re idle.`,
    ai_malformed: 'The model’s answer didn’t fit the format. Your text is unchanged.',
    ai_failed: (model: string, detail: string) => `Ollama couldn’t run ${model}: ${detail}.`,
    ai_busy: 'Local AI is busy with another request.',
    ai_preview: 'Not available in preview.',
    ai_nothing_to_use: 'Write something, or say what you built, first.',
    pull_failed: (detail: string) => `Download stopped: ${detail}.`,
    voice_no_examples: 'Approve at least one example first.',
    voice_examples_full: 'You can keep 20 examples. Remove one first.',
  },

  /** Why an installed model can or can't be used (AiModel.reason). */
  verdicts: {
    local: 'Runs on this Mac',
    remote: 'Cloud model: xBot won’t use it',
    noShow: 'Ollama didn’t report its details. Update Ollama.',
    noCapabilities: 'Ollama didn’t report its capabilities. Update Ollama.',
    tooSmall: 'Too small to be a local model',
    noCompletion: 'Can’t write text (no completion capability)',
  },

  menu: {
    preview: 'Not available in preview',
    loading: 'Loading your draft…',
    notRunning: 'Ollama isn’t running',
    modelNeeded: 'Choose a model first',
    running: 'Running…',
    emptyDraft: 'Write something first',
    noSelection: 'Select some text first',
  },

  angles: {
    problem_solution: 'Problem → solution',
    progress_lesson: 'Honest progress or lesson',
    funny_observation: 'Funny or surprising observation',
  },
} as const;

/** Error codes the `ai` domain returns in IpcResult envelopes. */
export type AiErrorCode = keyof typeof aiCopy.errors;
