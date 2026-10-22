import { useEffect, useRef, type RefObject } from 'react';
import { GlassCard, IconButton, SmileIcon } from '../design-system';

/**
 * The post text. Its `maxLength` is only the storage bound: text may run past
 * X's limit, and the counter and Post button show the over-limit state.
 */
export function PostEditor({
  value,
  onChange,
  placeholder = 'What did you build today?',
  autoFocus = false,
  readOnly = false,
  maxLength,
  saveState,
  onEmoji,
  editorRef,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  autoFocus?: boolean;
  /** While the saved draft loads, so early keystrokes are not overwritten. */
  readOnly?: boolean;
  maxLength?: number;
  /** Exposed as `data-save-state` for tests. */
  saveState?: string;
  /** Shows the emoji button; called after the editor has focus. */
  onEmoji?: () => void;
  /** Lets the parent focus the editor. */
  editorRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const editor = editorRef ?? ownRef;

  useEffect(() => {
    const el = editor.current;
    if (!autoFocus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus, editor]);

  return (
    <GlassCard className="post-editor-card" data-save-state={saveState}>
      <textarea
        ref={editor}
        className="post-editor"
        data-testid="post-editor"
        aria-label="Post text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        readOnly={readOnly}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      {onEmoji && (
        <IconButton
          label="Emoji"
          size="sm"
          bare
          className="post-editor-emoji"
          data-testid="emoji-button"
          // Keep the caret in the editor: the OS picker types into the focused field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editor.current?.focus({ preventScroll: true });
            onEmoji();
          }}
        >
          <SmileIcon size={19} />
        </IconButton>
      )}
    </GlassCard>
  );
}
