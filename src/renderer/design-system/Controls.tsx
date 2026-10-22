import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './Surfaces';
import { Tooltip } from './Tooltip';

/** Arrow keys move the selection inside a radiogroup, as native radios do. */
function onRadioKeys<T>(event: KeyboardEvent, values: readonly T[], current: T, select: (value: T) => void): void {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0 || values.length === 0) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const next = values[(index + step + values.length) % values.length]!;
  select(next);
  const group = event.currentTarget as HTMLElement;
  requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
}

export interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange(value: number): void;
  /** The end of a gesture: pointer released or key released (one undo step per drag). */
  onCommit?(value: number): void;
  /** Shown after the track, e.g. the sun icon. */
  endAdornment?: ReactNode;
  disabled?: boolean;
  testId?: string;
}

export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, onCommit, endAdornment, disabled, testId }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <input
        type="range"
        className="slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        data-testid={testId}
      />
      {endAdornment}
    </div>
  );
}

export interface SwatchOption {
  id: string;
  label: string;
  /** Any CSS background: a colour or a gradient. */
  paint: string;
}

export function SwatchGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly SwatchOption[];
  value: string;
  onChange(id: string): void;
}) {
  const ids = options.map((o) => o.id);
  return (
    <div className="swatches" role="radiogroup" aria-label={label} onKeyDown={(e) => onRadioKeys(e, ids, value, onChange)}>
      {options.map((option) => (
        <Swatch key={option.id} option={option} selected={option.id === value} onSelect={() => onChange(option.id)} />
      ))}
    </div>
  );
}

export function Swatch({ option, selected, onSelect }: { option: SwatchOption; selected: boolean; onSelect(): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={option.label}
      tabIndex={selected ? 0 : -1}
      className={cx('swatch', selected && 'swatch-selected')}
      style={{ '--swatch': option.paint } as CSSProperties}
      onClick={onSelect}
    />
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown but not selectable; `reason` becomes its tooltip. */
  disabled?: boolean;
  reason?: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Prefix for each option's test id: `<testId>-<value>`. */
  testId?: string;
}) {
  const values = options.filter((o) => !o.disabled).map((o) => o.value);
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={(e) => onRadioKeys(e, values, value, onChange)}>
      {options.map((option) => {
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-disabled={option.disabled || undefined}
            tabIndex={option.value === value ? 0 : -1}
            className={cx('segment', option.value === value && 'segment-selected')}
            data-testid={testId && `${testId}-${option.value}`}
            onClick={() => !option.disabled && onChange(option.value)}
          >
            {option.label}
          </button>
        );
        return option.disabled && option.reason ? (
          <Tooltip key={option.value} label={option.reason} className="segment-tooltip">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

/** A labelled single-line text input. `onCommit` runs on blur and Enter. */
export function TextField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  maxLength,
  testId,
  stacked,
  description,
  error,
  readOnly,
  selectOnFocus,
  code,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  onCommit?(value: string): void;
  placeholder?: string;
  maxLength?: number;
  testId?: string;
  /** The label above a full-width input, for long values such as URLs and ids (T9). */
  stacked?: boolean;
  /** A quieter line under the field (T9). */
  description?: string;
  /** Shown instead of the description, as an alert (T9). */
  error?: string | null;
  readOnly?: boolean;
  /** Selects everything on focus, for a value meant to be copied with ⌘C (T9). */
  selectOnFocus?: boolean;
  /** Monospaced text, for ids and URLs (T9). */
  code?: boolean;
}) {
  const noteId = useId();
  const note = error ?? description;
  return (
    <label className={cx('field', stacked && 'field-stacked', error && 'field-invalid')}>
      <span className="field-label">{label}</span>
      <input
        type="text"
        className={cx('field-input', code && 'field-input-code')}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        readOnly={readOnly}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onCommit?.(event.target.value)}
        onFocus={selectOnFocus ? (event) => event.currentTarget.select() : undefined}
        onKeyDown={(event) => event.key === 'Enter' && onCommit?.(event.currentTarget.value)}
      />
      {note && (
        <span id={noteId} className={cx('field-note', error && 'field-note-error')} role={error ? 'alert' : undefined}>
          {note}
        </span>
      )}
    </label>
  );
}

/** A labelled whole-number input; the typed text applies (clamped) on blur and Enter. */
export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  suffix?: string;
  testId?: string;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // The value changed from outside (undo, a preset): show it.
    setShown(value);
    setText(String(value));
  }
  const apply = () => {
    const parsed = Math.round(Number(text));
    if (!Number.isFinite(parsed) || text.trim() === '') {
      setText(String(value));
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <label className="field field-number">
      <span className="field-label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        className="field-input"
        value={text}
        data-testid={testId}
        onChange={(event) => setText(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => event.key === 'Enter' && apply()}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
    </label>
  );
}

/** A colour swatch that opens the system colour picker. `onCommit` runs when the picker closes. */
export function ColorField({
  label,
  value,
  onChange,
  onCommit,
  testId,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  onCommit?(value: string): void;
  testId?: string;
}) {
  return (
    <label className="color-field" style={{ '--swatch': value } as CSSProperties}>
      <input
        type="color"
        className="color-field-input"
        aria-label={label}
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onCommit?.(event.target.value)}
      />
    </label>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <span className="toggle-text">
        <span id={`${id}-label`} className="toggle-label">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="toggle-description">
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cx('toggle', checked && 'toggle-on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}
