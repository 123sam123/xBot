import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { StartupStatus } from '../../../shared/contracts/reminders';
import { acceleratorFromKeyPress, formatAccelerator, shortcutProblem } from '../../../shared/reminders/shortcut';
import { GhostButton, useEscapeLayer } from '../../design-system';

/**
 * The global shortcut that toggles the composer. Click, then press the keys:
 * the key comes from `event.code` (⌥ changes `event.key` on macOS), and main
 * suspends global shortcuts meanwhile, so pressing the current one records it
 * instead of hiding the window. Escape cancels; Backspace turns it off. Main
 * registers it before saving, and keeps the old one when another app has it.
 */
export function ShortcutField({ startup, mac, onChange }: { startup: StartupStatus; mac: boolean; onChange(next: StartupStatus): void }) {
  const noteId = useId();
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { accelerator, error } = startup.shortcut;

  useEffect(() => {
    if (!recording) return;
    void window.xbot.reminders.recordShortcut(true);
    return () => void window.xbot.reminders.recordShortcut(false);
  }, [recording]);
  // Escape ends recording, not the settings sheet.
  useEscapeLayer(recording, () => setRecording(false));

  const save = async (next: string) => {
    setRecording(false);
    const result = await window.xbot.reminders.setShortcut(next);
    if (!result.ok) {
      setProblem(result.error.message);
      return;
    }
    onChange(result.data);
    setProblem(result.data.shortcut.error);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    // Nothing reaches the window: not Escape-to-hide, not ⌘W.
    event.preventDefault();
    event.stopPropagation();
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (bare && event.key === 'Escape') return;
    if (bare && (event.code === 'Backspace' || event.code === 'Delete')) {
      void save('');
      return;
    }
    const next = acceleratorFromKeyPress(event, mac);
    if (!next) return; // only modifiers so far
    const why = shortcutProblem(next, mac);
    if (why) setProblem(why);
    else void save(next);
  };

  const note = problem ?? error;
  return (
    <div className="reminder-field">
      <div className="field">
        <span className="field-label">Show or hide Write Post</span>
        <button
          type="button"
          className="field-input reminder-shortcut"
          data-testid="shortcut-field"
          data-recording={recording || undefined}
          aria-describedby={note ? noteId : undefined}
          onClick={() => {
            setProblem(null);
            setRecording(!recording);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          {recording ? 'Press the keys…' : formatAccelerator(accelerator, mac)}
        </button>
        {accelerator !== '' && !recording && (
          <GhostButton className="ai-status-action" onClick={() => void save('')}>
            Turn off
          </GhostButton>
        )}
      </div>
      <p id={noteId} className={note ? 'reminder-note reminder-note-error' : 'reminder-note'} role={note ? 'alert' : undefined}>
        {note ?? (recording ? 'Escape cancels. Backspace turns the shortcut off.' : 'Works from any app.')}
      </p>
    </div>
  );
}
