import { useId, useState } from 'react';
import { aiCopy } from '../../../shared/aiCopy';
import { isLoopbackEndpoint } from '../../../shared/aiEndpoint';
import { useAppInfo } from '../../common/useAppInfo';
import { setSetting, useSettings } from '../../common/useSettings';
import { CloudOffNote, ModelPicker, OllamaCheck, useAiState } from '../../composer/ai';
import { Segmented, Toggle } from '../../design-system';
import type { SettingsSection } from '../registry';

const TIMEOUTS = [
  { value: '60', label: '60 s' },
  { value: '90', label: '90 s' },
  { value: '180', label: '3 min' },
] as const;

/** The Ollama endpoint: loopback only, checked as you type, saved on blur when valid. */
function EndpointField({ saved }: { saved: string }) {
  const id = useId();
  const [value, setValue] = useState(saved);
  const valid = isLoopbackEndpoint(value);
  return (
    <div className="ai-field">
      <label htmlFor={id} className="ai-label">
        Ollama endpoint
      </label>
      <input
        id={id}
        className="ai-input"
        data-testid="ai-endpoint"
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={value}
        aria-invalid={!valid || undefined}
        aria-describedby={valid ? undefined : `${id}-error`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const next = value.trim();
          if (isLoopbackEndpoint(next) && next !== saved) setSetting('ai.endpoint', next);
        }}
      />
      {!valid && (
        <p id={`${id}-error`} className="ai-field-error">
          {aiCopy.errors.endpoint_invalid}
        </p>
      )}
    </div>
  );
}

function LocalAi() {
  const { info } = useAppInfo();
  const { values } = useSettings();
  const preview = info?.isPreview ?? false;
  const { state, refresh } = useAiState(!preview);
  if (preview) return <p className="sheet-note">{aiCopy.errors.ai_preview}</p>;
  if (!values) return null;
  return (
    <>
      <OllamaCheck state={state} refresh={refresh} />
      <ModelPicker state={state} />
      <EndpointField key={values['ai.endpoint']} saved={values['ai.endpoint']} />
      <Toggle
        label="Low-resource mode"
        description={aiCopy.lowResource}
        checked={values['ai.lowResource']}
        onChange={(value) => setSetting('ai.lowResource', value)}
      />
      <div className="ai-row">
        <span className="ai-label">Time limit per answer</span>
        <Segmented
          label="Time limit per answer"
          options={TIMEOUTS}
          value={String(values['ai.generationTimeoutSec']) as (typeof TIMEOUTS)[number]['value']}
          onChange={(value) => setSetting('ai.generationTimeoutSec', Number(value))}
        />
      </div>
      <CloudOffNote />
      <p className="sheet-note">{aiCopy.honestCost}</p>
    </>
  );
}

const section: SettingsSection = { id: 'ai', order: 10, title: 'Local AI', Component: LocalAi };
export default section;
