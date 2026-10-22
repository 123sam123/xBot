import { useId, type KeyboardEvent } from 'react';
import { cx } from './Surfaces';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  /** Runs on blur and on Enter, e.g. to validate and save. */
  onCommit?(value: string): void;
  placeholder?: string;
  /** A quieter line under the field. */
  description?: string;
  /** Shown instead of the description, as an alert. */
  error?: string | null;
  readOnly?: boolean;
  /** Selects everything on focus, for values meant to be copied (Cmd+C). */
  selectOnFocus?: boolean;
  inputMode?: 'text' | 'numeric';
  /** Monospaced text, for ids and URLs. */
  code?: boolean;
  testId?: string;
}

/** A labelled single-line text field on glass. */
export function TextField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  description,
  error,
  readOnly,
  selectOnFocus,
  inputMode,
  code,
  testId,
}: TextFieldProps) {
  const id = useId();
  const note = error ?? description;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onCommit?.(event.currentTarget.value);
    }
  };
  return (
    <div className={cx('field', error && 'field-invalid')}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={cx('field-input', code && 'field-input-code')}
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        inputMode={inputMode}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onCommit?.(event.target.value)}
        onFocus={selectOnFocus ? (event) => event.currentTarget.select() : undefined}
        onKeyDown={onKeyDown}
      />
      {note && (
        <span id={`${id}-note`} className={error ? 'field-error' : 'field-description'} role={error ? 'alert' : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}
