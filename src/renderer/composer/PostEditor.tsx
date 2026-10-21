import { useEffect, useRef } from 'react';
import { GlassCard } from '../design-system';

/**
 * The post text. No maxLength: text may run past the limit, and the counter
 * and Post button show the over-limit state instead.
 */
export function PostEditor({
  value,
  onChange,
  placeholder = 'What did you build today?',
  autoFocus = false,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = editor.current;
    if (!autoFocus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  return (
    <GlassCard className="post-editor-card">
      <textarea
        ref={editor}
        className="post-editor"
        data-testid="post-editor"
        aria-label="Post text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </GlassCard>
  );
}
