import type { CursorSettings, CursorType } from '../../../shared/composition/model';
import { CursorIcon, Slider, Toggle } from '../../design-system';
import { Section, type TabProps } from './parts';

const TYPES: { value: CursorType; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Uses the actual cursor from your recording.' },
  { value: 'circle', label: 'Circle', description: 'A touch-style circle cursor like mobile simulators.' },
];

/** Cap's cursor inspector: show it, its type, size and tilt, smooth movement, idle hiding and click ripples. */
export function CursorTab({ composition, onChange, onCommit }: TabProps) {
  const cursor = composition.cursor!;
  const set = (patch: Partial<CursorSettings>, gesture?: string) => onChange({ ...composition, cursor: { ...cursor, ...patch } }, gesture);
  return (
    <>
      <Section title="Show cursor">
        <Toggle label="Show cursor" checked={cursor.show} onChange={(show) => set({ show })} />
      </Section>
      <Section title="Cursor Type" icon={<CursorIcon size={18} />}>
        <div className="radio-cards" role="radiogroup" aria-label="Cursor type">
          {TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              role="radio"
              aria-checked={cursor.type === type.value}
              className={`radio-card${cursor.type === type.value ? ' radio-card-active' : ''}`}
              onClick={() => set({ type: type.value })}
              data-testid={`cursor-type-${type.value}`}
            >
              <span className="radio-card-dot" aria-hidden="true" />
              <span className="radio-card-text">
                <span className="radio-card-label">{type.label}</span>
                <span className="radio-card-description">{type.description}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Size">
        <Slider label="Cursor size" min={0.5} max={4} step={0.05} value={cursor.size} onChange={(size) => set({ size }, 'cursor-size')} onCommit={onCommit} testId="cursor-size" />
      </Section>
      <Section title="Tilt">
        <Slider label="Cursor tilt" min={0} max={1} step={0.01} value={cursor.tilt} onChange={(tilt) => set({ tilt }, 'cursor-tilt')} onCommit={onCommit} testId="cursor-tilt" />
      </Section>
      <Section title="Movement">
        <Toggle label="Smooth movement" description="Glides between positions instead of jumping." checked={cursor.smooth} onChange={(smooth) => set({ smooth })} />
        <Toggle label="Hide when idle" description="Fades out after a moment without moving." checked={cursor.hideWhenIdle} onChange={(hideWhenIdle) => set({ hideWhenIdle })} />
        <Toggle label="Click animation" description="A ripple wherever you click." checked={cursor.clickEffect} onChange={(clickEffect) => set({ clickEffect })} />
      </Section>
    </>
  );
}
