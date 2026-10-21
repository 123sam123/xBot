import type { RefObject } from 'react';
import {
  BACKGROUND_IDS,
  BACKGROUNDS,
  type CropAspect,
  type FrameStyle,
  type FrameTheme,
  type PreviewComposition,
  type ShadowLevel,
} from '../common/previewComposition';
import { Popover, Segmented, Slider, SunIcon, SwatchGroup } from '../design-system';

export type ToolId = 'background' | 'frame' | 'padding' | 'shadow' | 'crop';

export const toolPopoverId = (tool: ToolId) => `tool-${tool}`;

type Change = (patch: Partial<PreviewComposition>) => void;

/** The settings popover for each toolbar item, anchored above its button. One is open at a time. */
export function ToolPopovers({
  anchors,
  composition,
  onChange,
}: {
  anchors: Record<ToolId, RefObject<HTMLButtonElement | null>>;
  composition: PreviewComposition;
  onChange: Change;
}) {
  const common = { placement: 'top' as const, offset: 18 };
  return (
    <>
      <Popover
        id={toolPopoverId('background')}
        anchor={anchors.background}
        label="Background"
        className="tool-popover tool-popover-background"
        testId="popover-background"
        crossOffset={-27}
        {...common}
      >
        <h2 className="tool-popover-title">Background</h2>
        <SwatchGroup
          label="Background colour"
          options={BACKGROUND_IDS.map((id) => ({ id, label: BACKGROUNDS[id].label, paint: BACKGROUNDS[id].swatch }))}
          value={composition.background}
          onChange={(id) => onChange({ background: id as PreviewComposition['background'] })}
        />
        <Slider
          label="Background brightness"
          value={composition.backgroundLight}
          onChange={(backgroundLight) => onChange({ backgroundLight })}
          endAdornment={<SunIcon size={20} className="tool-popover-adornment" />}
        />
      </Popover>

      <Popover id={toolPopoverId('frame')} anchor={anchors.frame} label="Frame" className="tool-popover" testId="popover-frame" {...common}>
        <h2 className="tool-popover-title">Frame</h2>
        <Segmented<FrameStyle>
          label="Frame style"
          options={[
            { value: 'browser', label: 'Browser' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'none', label: 'None' },
          ]}
          value={composition.frame.style}
          onChange={(style) => onChange({ frame: { ...composition.frame, style } })}
        />
        <Segmented<FrameTheme>
          label="Frame theme"
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={composition.frame.theme}
          onChange={(theme) => onChange({ frame: { ...composition.frame, theme } })}
        />
      </Popover>

      <Popover id={toolPopoverId('padding')} anchor={anchors.padding} label="Padding" className="tool-popover" testId="popover-padding" {...common}>
        <h2 className="tool-popover-title">Padding</h2>
        <Slider label="Padding" min={0} max={0.3} value={composition.padding} onChange={(padding) => onChange({ padding })} />
      </Popover>

      <Popover id={toolPopoverId('shadow')} anchor={anchors.shadow} label="Shadow" className="tool-popover" testId="popover-shadow" {...common}>
        <h2 className="tool-popover-title">Shadow</h2>
        <Segmented<ShadowLevel>
          label="Shadow"
          options={[
            { value: 'none', label: 'None' },
            { value: 'soft', label: 'Soft' },
            { value: 'elevated', label: 'Elevated' },
          ]}
          value={composition.shadow}
          onChange={(shadow) => onChange({ shadow })}
        />
      </Popover>

      <Popover id={toolPopoverId('crop')} anchor={anchors.crop} label="Crop" className="tool-popover" testId="popover-crop" {...common}>
        <h2 className="tool-popover-title">Crop</h2>
        <Segmented<CropAspect>
          label="Aspect ratio"
          options={[
            { value: 'original', label: 'Original' },
            { value: '16:9', label: '16:9' },
            { value: '1:1', label: '1:1' },
            { value: '4:5', label: '4:5' },
          ]}
          value={composition.crop}
          onChange={(crop) => onChange({ crop })}
        />
      </Popover>
    </>
  );
}
