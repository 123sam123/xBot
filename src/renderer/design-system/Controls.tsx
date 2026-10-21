import { useId, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './Surfaces';

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
  /** Shown after the track, e.g. the sun icon. */
  endAdornment?: ReactNode;
  disabled?: boolean;
}

export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, endAdornment, disabled }: SliderProps) {
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
        style={{ '--fill': `${fill}%` } as CSSProperties}
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

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}) {
  const values = options.map((o) => o.value);
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={(e) => onRadioKeys(e, values, value, onChange)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={cx('segment', option.value === value && 'segment-selected')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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
