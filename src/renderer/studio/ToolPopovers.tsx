import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import {
  CANVAS_LIMITS,
  GRADIENT_PRESETS,
  GRADIENTS,
  gradientBackground,
  shadowPreset,
  type Background,
  type CanvasRatio,
  type Composition,
  type CropAspect,
  type FrameStyle,
  type FrameTheme,
  type ShadowStyle,
} from '../../shared/composition/model';
import {
  ColorField,
  FrostedButton,
  GhostButton,
  IconButton,
  MoreIcon,
  NumberField,
  Popover,
  Segmented,
  Slider,
  SunIcon,
  SwatchGroup,
  TextField,
  Toggle,
  cx,
} from '../design-system';

export type ToolId = 'background' | 'frame' | 'padding' | 'shadow' | 'crop';

export const toolPopoverId = (tool: ToolId) => `tool-${tool}`;

type Change = (next: Composition, gesture?: string) => void;

interface ToolProps {
  composition: Composition;
  onChange: Change;
  /** A slider drag or a typing run ended: the next change is a new undo step. */
  onCommit(): void;
}

/** A labelled row inside a tool popover. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tool-field">
      <span className="tool-field-label">{label}</span>
      {children}
    </div>
  );
}

const BACKGROUND_TYPES: { value: Background['type']; label: string }[] = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'solid', label: 'Solid' },
  { value: 'image', label: 'Image' },
  { value: 'transparent', label: 'None' },
];

function brightnessOf(background: Background): number {
  return background.type === 'transparent' ? 0.5 : background.brightness;
}

function BackgroundTool({
  composition,
  onChange,
  onCommit,
  onPickImage,
  pickDisabledReason,
}: ToolProps & { onPickImage(): void; pickDisabledReason?: string }) {
  const [more, setMore] = useState(false);
  const bg = composition.background;
  const set = (background: Background, gesture?: string) => onChange({ ...composition, background }, gesture);
  const brightness = brightnessOf(bg);

  const setType = (type: Background['type']) => {
    if (type === bg.type) return;
    if (type === 'gradient') set(gradientBackground('blue', brightness));
    else if (type === 'solid') set({ type: 'solid', color: bg.type === 'gradient' ? bg.from : '#5867ec', brightness });
    else if (type === 'transparent') set({ type: 'transparent' });
    else onPickImage();
  };

  return (
    <>
      <div className="tool-popover-heading">
        <h2 className="tool-popover-title">Background</h2>
        <IconButton
          label={more ? 'Fewer background options' : 'More background options'}
          size="sm"
          bare
          className={cx('tool-popover-more', more && 'tool-popover-more-open')}
          aria-expanded={more}
          data-testid="background-more"
          onClick={() => setMore((value) => !value)}
        >
          <MoreIcon size={18} />
        </IconButton>
      </div>
      <SwatchGroup
        label="Background colour"
        options={GRADIENT_PRESETS.map((id) => ({ id, label: GRADIENTS[id].label, paint: GRADIENTS[id].swatch }))}
        value={bg.type === 'gradient' && bg.preset ? bg.preset : ''}
        onChange={(id) => set(gradientBackground(id as (typeof GRADIENT_PRESETS)[number], brightness))}
      />
      <Slider
        label="Background brightness"
        value={brightness}
        disabled={bg.type === 'transparent'}
        onChange={(value) => bg.type !== 'transparent' && set({ ...bg, brightness: value }, 'background-brightness')}
        onCommit={onCommit}
        endAdornment={<SunIcon size={20} className="tool-popover-adornment" />}
        testId="background-brightness"
      />
      {more && (
        <div className="tool-popover-more-section">
          <Segmented<Background['type']> label="Background type" options={BACKGROUND_TYPES} value={bg.type} onChange={setType} testId="background-type" />
          {bg.type === 'gradient' && (
            <>
              <Field label="Angle">
                <Slider
                  label="Gradient angle"
                  min={0}
                  max={360}
                  step={1}
                  value={bg.angle}
                  onChange={(angle) => set({ ...bg, preset: null, angle }, 'gradient-angle')}
                  onCommit={onCommit}
                />
              </Field>
              <Field label="Colours">
                <span className="tool-field-colors">
                  <ColorField label="Gradient start colour" value={bg.from} onChange={(from) => set({ ...bg, preset: null, from }, 'gradient-from')} onCommit={onCommit} />
                  <ColorField label="Gradient end colour" value={bg.to} onChange={(to) => set({ ...bg, preset: null, to }, 'gradient-to')} onCommit={onCommit} />
                </span>
              </Field>
            </>
          )}
          {bg.type === 'solid' && (
            <Field label="Colour">
              <ColorField label="Background colour" value={bg.color} onChange={(color) => set({ ...bg, color }, 'solid-color')} onCommit={onCommit} testId="background-color" />
            </Field>
          )}
          {bg.type === 'image' && (
            <>
              <GhostButton className="tool-popover-action" disabled={pickDisabledReason !== undefined} onClick={onPickImage}>
                Choose image…
              </GhostButton>
              <Field label="Blur">
                <Slider label="Background blur" min={0} max={0.1} step={0.001} value={bg.blur} onChange={(blur) => set({ ...bg, blur }, 'background-blur')} onCommit={onCommit} />
              </Field>
            </>
          )}
          {bg.type === 'transparent' && <p className="tool-popover-note">Exports a transparent PNG.</p>}
        </div>
      )}
    </>
  );
}

function FrameTool({ composition, onChange, onCommit }: ToolProps) {
  const frame = composition.frame;
  const set = (patch: Partial<Composition['frame']>, gesture?: string) => onChange({ ...composition, frame: { ...frame, ...patch } }, gesture);
  return (
    <>
      <h2 className="tool-popover-title">Frame</h2>
      <Segmented<FrameStyle>
        label="Frame style"
        options={[
          { value: 'browser', label: 'Browser' },
          { value: 'minimal', label: 'Minimal' },
          { value: 'none', label: 'None' },
        ]}
        value={frame.style}
        onChange={(style) => set({ style })}
        testId="frame-style"
      />
      {frame.style !== 'none' && (
        <Segmented<FrameTheme>
          label="Frame theme"
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={frame.theme}
          onChange={(theme) => set({ theme })}
          testId="frame-theme"
        />
      )}
      {frame.style === 'browser' && (
        <>
          <TextField label="Address" value={frame.address} maxLength={120} onChange={(address) => set({ address }, 'frame-address')} onCommit={onCommit} testId="frame-address" />
          <Toggle label="Show address" checked={frame.showAddress} onChange={(showAddress) => set({ showAddress })} />
        </>
      )}
      {frame.style !== 'none' && <Toggle label="Show traffic lights" checked={frame.showLights} onChange={(showLights) => set({ showLights })} />}
      <Field label="Corners">
        <Slider label="Corner radius" min={0} max={0.08} step={0.001} value={frame.radius} onChange={(radius) => set({ radius }, 'frame-radius')} onCommit={onCommit} />
      </Field>
      <Toggle label="Fine border" checked={frame.border} onChange={(border) => set({ border })} />
    </>
  );
}

function PaddingTool({ composition, onChange, onCommit }: ToolProps) {
  const { padding, canvas } = composition;
  const setPadding = (patch: Partial<Composition['padding']>, gesture?: string) => onChange({ ...composition, padding: { ...padding, ...patch } }, gesture);
  const setCanvas = (patch: Partial<Composition['canvas']>) => onChange({ ...composition, canvas: { ...canvas, ...patch } });
  return (
    <>
      <h2 className="tool-popover-title">Padding</h2>
      {padding.linked ? (
        <Slider label="Padding" min={0} max={0.5} step={0.005} value={padding.x} onChange={(x) => setPadding({ x, y: x }, 'padding')} onCommit={onCommit} testId="padding" />
      ) : (
        <>
          <Field label="H">
            <Slider label="Horizontal padding" min={0} max={0.5} step={0.005} value={padding.x} onChange={(x) => setPadding({ x }, 'padding-x')} onCommit={onCommit} />
          </Field>
          <Field label="V">
            <Slider label="Vertical padding" min={0} max={0.5} step={0.005} value={padding.y} onChange={(y) => setPadding({ y }, 'padding-y')} onCommit={onCommit} />
          </Field>
        </>
      )}
      <Toggle label="Separate horizontal and vertical" checked={!padding.linked} onChange={(separate) => setPadding({ linked: !separate, y: padding.x })} />
      <Segmented<CanvasRatio>
        label="Output ratio"
        options={[
          { value: 'original', label: 'Original' },
          { value: '16:9', label: '16:9' },
          { value: '1:1', label: '1:1' },
          { value: '4:5', label: '4:5' },
          { value: 'custom', label: 'Custom' },
        ]}
        value={canvas.ratio}
        onChange={(ratio) => setCanvas({ ratio })}
        testId="output-ratio"
      />
      {canvas.ratio === 'custom' && (
        <div className="tool-field-pair">
          <NumberField label="W" value={canvas.width} min={CANVAS_LIMITS.min} max={CANVAS_LIMITS.max} suffix="px" onChange={(width) => setCanvas({ width })} testId="output-width" />
          <NumberField label="H" value={canvas.height} min={CANVAS_LIMITS.min} max={CANVAS_LIMITS.max} suffix="px" onChange={(height) => setCanvas({ height })} testId="output-height" />
        </div>
      )}
    </>
  );
}

function ShadowTool({ composition, onChange, onCommit }: ToolProps) {
  const shadow = composition.shadow;
  const off = shadow.style === 'none';
  const set = (patch: Partial<Composition['shadow']>, gesture: string) => onChange({ ...composition, shadow: { ...shadow, ...patch } }, gesture);
  return (
    <>
      <h2 className="tool-popover-title">Shadow</h2>
      <Segmented<ShadowStyle>
        label="Shadow"
        options={[
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'elevated', label: 'Elevated' },
        ]}
        value={shadow.style}
        onChange={(style) => onChange({ ...composition, shadow: shadowPreset(style, shadow) })}
        testId="shadow-style"
      />
      <Field label="Blur">
        <Slider label="Shadow blur" min={0} max={0.25} step={0.002} value={shadow.blur} disabled={off} onChange={(blur) => set({ blur }, 'shadow-blur')} onCommit={onCommit} />
      </Field>
      <Field label="Distance">
        <Slider label="Shadow distance" min={0} max={0.25} step={0.002} value={shadow.distance} disabled={off} onChange={(distance) => set({ distance }, 'shadow-distance')} onCommit={onCommit} />
      </Field>
      <Field label="Opacity">
        <Slider label="Shadow opacity" min={0} max={1} step={0.01} value={shadow.opacity} disabled={off} onChange={(opacity) => set({ opacity }, 'shadow-opacity')} onCommit={onCommit} />
      </Field>
    </>
  );
}

export interface CropControls {
  aspect: CropAspect;
  onAspect(aspect: CropAspect): void;
  onReset(): void;
  onCancel(): void;
  onApply(): void;
  /** The overlay the crop is dragged on: pointer-downs there keep the popover open. */
  overlay: RefObject<HTMLDivElement | null>;
}

/** One compact row, so it never covers the crop rect's handles (the overlay keeps clear of it). */
function CropTool({ crop }: { crop: CropControls }) {
  return (
    <>
      <h2 className="visually-hidden">Crop</h2>
      <Segmented<CropAspect>
        label="Aspect ratio"
        options={[
          { value: 'free', label: 'Free' },
          { value: 'original', label: 'Original' },
          { value: '16:9', label: '16:9' },
          { value: '1:1', label: '1:1' },
          { value: '4:5', label: '4:5' },
        ]}
        value={crop.aspect}
        onChange={crop.onAspect}
        testId="crop-aspect"
      />
      <GhostButton className="tool-popover-action" onClick={crop.onReset} data-testid="crop-reset">
        Reset
      </GhostButton>
      <GhostButton className="tool-popover-action" onClick={crop.onCancel} data-testid="crop-cancel">
        Cancel
      </GhostButton>
      <FrostedButton className="tool-popover-apply" onClick={crop.onApply} data-testid="crop-apply">
        Apply
      </FrostedButton>
    </>
  );
}

/** The settings popover for each toolbar item, anchored above its button. One is open at a time. */
export function ToolPopovers({
  anchors,
  composition,
  onChange,
  onCommit,
  onPickBackground,
  pickDisabledReason,
  crop,
}: ToolProps & {
  anchors: Record<ToolId, RefObject<HTMLButtonElement | null>>;
  onPickBackground(): void;
  pickDisabledReason?: string;
  crop: CropControls;
}) {
  // Measured from the reference: 12 px above the toolbar item, the Background one shifted left.
  const common = { placement: 'top' as const, offset: 12 };
  const tool = { composition, onChange, onCommit };
  const keepCropOpen = useMemo(() => [crop.overlay], [crop.overlay]);
  return (
    <>
      <Popover
        id={toolPopoverId('background')}
        anchor={anchors.background}
        label="Background"
        className="tool-popover tool-popover-background"
        testId="popover-background"
        crossOffset={-34}
        {...common}
      >
        <BackgroundTool {...tool} onPickImage={onPickBackground} pickDisabledReason={pickDisabledReason} />
      </Popover>

      <Popover id={toolPopoverId('frame')} anchor={anchors.frame} label="Frame" className="tool-popover tool-popover-wide" testId="popover-frame" {...common}>
        <FrameTool {...tool} />
      </Popover>

      <Popover id={toolPopoverId('padding')} anchor={anchors.padding} label="Padding" className="tool-popover tool-popover-wide" testId="popover-padding" {...common}>
        <PaddingTool {...tool} />
      </Popover>

      <Popover id={toolPopoverId('shadow')} anchor={anchors.shadow} label="Shadow" className="tool-popover tool-popover-wide" testId="popover-shadow" {...common}>
        <ShadowTool {...tool} />
      </Popover>

      <Popover
        id={toolPopoverId('crop')}
        anchor={anchors.crop}
        label="Crop"
        className="tool-popover tool-popover-crop"
        testId="popover-crop"
        keepOpenWithin={keepCropOpen}
        {...common}
      >
        <CropTool crop={crop} />
      </Popover>
    </>
  );
}
