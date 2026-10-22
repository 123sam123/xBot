import { useEffect, useId, useRef, useState } from 'react';
import { aiCopy } from '../../../shared/aiCopy';
import type { VoicePatch, VoiceProfile } from '../../../shared/contracts/ai';
import { useAppInfo } from '../../common/useAppInfo';
import { useAiState } from '../../composer/ai';
import { CloseIcon, GhostButton, IconButton, Segmented, Slider, StatusChip, Tooltip } from '../../design-system';
import type { SettingsSection } from '../registry';

// Voice preferences for local AI (T6), stored on this Mac. Sliders save
// shortly after they stop moving, choices at once, text on blur or Save. The
// style brief is derived locally, only from examples the user approved.

type Scale = 'casualPolished' | 'dryPlayful' | 'technicalAccessible';
const SCALES: readonly { key: Scale; low: string; high: string }[] = [
  { key: 'casualPolished', low: 'Casual', high: 'Polished' },
  { key: 'dryPlayful', low: 'Dry', high: 'Playful' },
  { key: 'technicalAccessible', low: 'Technical', high: 'Accessible' },
];
const EMOJI = [
  { value: 'none', label: 'None' },
  { value: 'sparingly', label: 'Sparingly' },
  { value: 'freely', label: 'Freely' },
] as const;
const PROFANITY = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'ok', label: 'OK' },
] as const;
const SLIDER_SAVE_MS = 300;
const MAX_PHRASES = 50;
const MAX_PHRASE_LENGTH = 80;
const MAX_BRIEF = 1200;

const samePhrases = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

function Voice() {
  const { info } = useAppInfo();
  const preview = info?.isPreview ?? false;
  const ids = { banned: useId(), example: useId(), brief: useId() };
  const { state: ai } = useAiState(!preview);
  const [voice, setVoice] = useState<VoiceProfile | null>(null);
  const [banned, setBanned] = useState('');
  const [brief, setBrief] = useState('');
  const [example, setExample] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState<string | null>(null);
  /** Slider and choice changes not yet saved; a save's echo never overwrites them. */
  const pending = useRef<VoicePatch>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    void window.xbot.ai.getVoice().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setVoice(result.data);
      setBanned(result.data.bannedPhrases.join('\n'));
      setBrief(result.data.styleBrief);
    });
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [preview]);

  const accept = (result: Awaited<ReturnType<typeof window.xbot.ai.getVoice>>) => {
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setVoice({ ...result.data, ...(pending.current as Partial<VoiceProfile>) });
  };
  const flush = () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length > 0) void window.xbot.ai.saveVoice(patch).then(accept);
  };
  const change = (patch: VoicePatch, delay: number) => {
    setVoice((prev) => (prev ? { ...prev, ...(patch as Partial<VoiceProfile>) } : prev));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  };

  if (preview || !voice) return null;

  const saveBanned = () => {
    const phrases = [...new Set(banned.split('\n').map((line) => line.trim()).filter(Boolean))];
    if (phrases.length > MAX_PHRASES) return setError(`Keep it to ${MAX_PHRASES} phrases.`);
    if (phrases.some((p) => p.length > MAX_PHRASE_LENGTH)) return setError(`Each phrase can be up to ${MAX_PHRASE_LENGTH} characters.`);
    if (samePhrases(phrases, voice.bannedPhrases)) return;
    void window.xbot.ai.saveVoice({ bannedPhrases: phrases }).then(accept);
  };
  const saveBrief = () => {
    if (brief !== voice.styleBrief) void window.xbot.ai.saveVoice({ styleBrief: brief.slice(0, MAX_BRIEF) }).then(accept);
  };
  const addExample = async (text: string) => {
    const result = await window.xbot.ai.addExample(text);
    accept(result);
    if (result.ok) setExample('');
  };
  const addDraft = async () => {
    const result = await window.xbot.drafts.getCurrent();
    if (!result.ok) return setError(result.error.message);
    if (result.data.text.trim() === '') return setError('Your draft is empty.');
    await addExample(result.data.text.slice(0, 2000));
  };
  const derive = async () => {
    const requestId = crypto.randomUUID();
    setDeriving(requestId);
    setError(null);
    const result = await window.xbot.ai.deriveStyleBrief(requestId);
    setDeriving(null);
    if (!result.ok) setError(result.error.message);
    else if (result.data.status === 'done') setBrief(result.data.brief.slice(0, MAX_BRIEF));
  };

  const deriveReason =
    voice.examples.length === 0
      ? aiCopy.errors.voice_no_examples
      : ai?.phase === 'not_running'
        ? aiCopy.menu.notRunning
        : ai?.phase !== 'ready'
          ? aiCopy.menu.modelNeeded
          : ai.running?.priority === 'interactive'
            ? aiCopy.menu.running
            : null;
  const deriveButton = (
    <GhostButton className="ai-status-action" data-testid="voice-derive" disabled={deriveReason !== null} onClick={() => void derive()}>
      Derive from examples
    </GhostButton>
  );

  return (
    <>
      <p className="sheet-note">Your voice stays on this Mac. Local AI follows it when it writes for you.</p>
      {SCALES.map((scale) => (
        <div key={scale.key} className="voice-scale">
          <span className="voice-scale-end">{scale.low}</span>
          <Slider
            label={`${scale.low} to ${scale.high}`}
            min={0}
            max={100}
            step={5}
            value={voice[scale.key]}
            onChange={(value) => change({ [scale.key]: value }, SLIDER_SAVE_MS)}
          />
          <span className="voice-scale-end">{scale.high}</span>
        </div>
      ))}
      <div className="ai-row">
        <span className="ai-label">Emoji</span>
        <Segmented label="Emoji" options={EMOJI} value={voice.emoji} onChange={(value) => change({ emoji: value }, 0)} />
      </div>
      <div className="ai-row">
        <span className="ai-label">Profanity</span>
        <Segmented label="Profanity" options={PROFANITY} value={voice.profanity} onChange={(value) => change({ profanity: value }, 0)} />
      </div>

      <div className="ai-field">
        <label htmlFor={ids.banned} className="ai-label">
          Never use these phrases (one per line)
        </label>
        <textarea id={ids.banned} className="ai-textarea" rows={3} value={banned} onChange={(event) => setBanned(event.target.value)} onBlur={saveBanned} />
      </div>

      <div className="ai-field">
        <span className="ai-label">Approved examples</span>
        {voice.examples.length === 0 ? (
          <p className="sheet-note">Add posts you wrote and like. The style brief is learned only from these.</p>
        ) : (
          <ul className="voice-examples" aria-label="Approved examples">
            {voice.examples.map((e) => (
              <li key={e.id} className="voice-example">
                <p className="voice-example-text">{e.text}</p>
                <IconButton label="Remove example" size="sm" bare onClick={() => void window.xbot.ai.removeExample(e.id).then(accept)}>
                  <CloseIcon size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor={ids.example} className="visually-hidden">
          New example
        </label>
        <textarea
          id={ids.example}
          className="ai-textarea"
          rows={2}
          maxLength={2000}
          placeholder="Paste a post you wrote"
          value={example}
          onChange={(event) => setExample(event.target.value)}
        />
        <div className="ai-row">
          <GhostButton className="ai-status-action" onClick={() => void addDraft()}>
            Add current draft
          </GhostButton>
          <GhostButton className="ai-status-action" disabled={example.trim() === ''} onClick={() => void addExample(example)}>
            Add example
          </GhostButton>
        </div>
      </div>

      <div className="ai-field">
        <label htmlFor={ids.brief} className="ai-label">
          Style brief
        </label>
        <textarea
          id={ids.brief}
          className="ai-textarea"
          rows={4}
          maxLength={MAX_BRIEF}
          placeholder="How you write: tone, length, habits. Edit freely."
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          onBlur={saveBrief}
        />
        <div className="ai-row">
          {deriving ? (
            <span className="ai-running">
              <span>Running locally…</span>
              <GhostButton className="ai-status-action" onClick={() => void window.xbot.ai.cancel(deriving)}>
                Cancel
              </GhostButton>
            </span>
          ) : deriveReason ? (
            <Tooltip label={deriveReason}>{deriveButton}</Tooltip>
          ) : (
            deriveButton
          )}
          <GhostButton className="ai-status-action" disabled={brief === voice.styleBrief} onClick={saveBrief}>
            Save
          </GhostButton>
        </div>
      </div>

      {error && (
        <StatusChip tone="warning" className="ai-apply-error">
          {error}
        </StatusChip>
      )}
    </>
  );
}

const section: SettingsSection = { id: 'voice', order: 20, title: 'Voice', Component: Voice };
export default section;
