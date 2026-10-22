import type { RefObject } from 'react';
import type { Composition, FrameStyle, FrameTheme } from '../../shared/composition/model';
import { Popover, Segmented, TextField, Toggle } from '../design-system';

export const FRAME_POPOVER = 'studio-frame';

/** The window chrome around the picture: browser, minimal or none, its theme and its details. */
export function FramePopover({
  anchor,
  composition,
  onChange,
  onCommit,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  composition: Composition;
  onChange(next: Composition, gesture?: string): void;
  onCommit(): void;
}) {
  const frame = composition.frame;
  const set = (patch: Partial<Composition['frame']>, gesture?: string) => onChange({ ...composition, frame: { ...frame, ...patch } }, gesture);
  return (
    <Popover id={FRAME_POPOVER} anchor={anchor} label="Frame" placement="bottom-start" className="tool-popover tool-popover-wide" testId="popover-frame">
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
    </Popover>
  );
}
