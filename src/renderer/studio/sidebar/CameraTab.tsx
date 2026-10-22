import { CAMERA_LIMITS, type CameraPosition, type CameraSettings, type CameraShape } from '../../../shared/composition/model';
import { CameraIcon, Segmented, Slider, Toggle } from '../../design-system';
import { Section, type TabProps } from './parts';

const POSITIONS: CameraPosition[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

/** Cap's camera inspector: where the bubble sits, whether it shows, mirroring, size and shape. */
export function CameraTab({ composition, onChange, onCommit }: TabProps) {
  const camera = composition.camera!;
  const set = (patch: Partial<CameraSettings>, gesture?: string) => onChange({ ...composition, camera: { ...camera, ...patch } }, gesture);
  return (
    <>
      <Section title="Camera" icon={<CameraIcon size={18} />}>
        <span className="sidebar-row-label">Position</span>
        <div className="camera-grid" role="radiogroup" aria-label="Camera position">
          {POSITIONS.map((position) => (
            <button
              key={position}
              type="button"
              role="radio"
              aria-checked={camera.position === position}
              aria-label={position.replace('-', ' ')}
              className={`camera-grid-dot${camera.position === position ? ' camera-grid-dot-active' : ''}`}
              onClick={() => set({ position })}
              data-testid={`camera-position-${position}`}
            >
              <span />
            </button>
          ))}
        </div>
      </Section>
      <Section title="Visibility">
        <Toggle label="Hide camera" checked={camera.hidden} onChange={(hidden) => set({ hidden })} />
        <Toggle label="Mirror camera" checked={camera.mirror} onChange={(mirror) => set({ mirror })} />
      </Section>
      <Section title="Size">
        <Slider label="Camera size" min={CAMERA_LIMITS.min} max={CAMERA_LIMITS.max} step={0.005} value={camera.size} onChange={(size) => set({ size }, 'camera-size')} onCommit={onCommit} testId="camera-size" />
      </Section>
      <Section title="Shape">
        <Segmented<CameraShape>
          label="Camera shape"
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'square', label: 'Square' },
          ]}
          value={camera.shape}
          onChange={(shape) => set({ shape })}
          testId="camera-shape"
        />
      </Section>
    </>
  );
}
