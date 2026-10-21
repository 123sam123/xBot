import type { RefObject } from 'react';
import { computeLayout } from '../../shared/composition/layout';
import { effectiveFormat, MAX_OUTPUT_SIDE, type Composition, type ExportFormat } from '../../shared/composition/model';
import { Popover, Segmented } from '../design-system';

export const OUTPUT_POPOVER = 'studio-output';

/** Format and scale of the export "Add to post" renders, and the size it comes out at. */
export function OutputPopover({
  anchor,
  composition,
  gif,
  onChange,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  composition: Composition;
  /** GIF sources export their first frame, as PNG. */
  gif: boolean;
  onChange(next: Composition): void;
}) {
  const format = effectiveFormat(composition, gif);
  const jpegReason = composition.background.type === 'transparent' ? 'Transparent backgrounds export as PNG' : gif ? 'GIFs export their first frame as PNG' : undefined;
  const layout = computeLayout(composition, { scale: composition.output.scale });
  const set = (patch: Partial<Composition['output']>) => onChange({ ...composition, output: { ...composition.output, ...patch } });
  return (
    <Popover id={OUTPUT_POPOVER} anchor={anchor} label="Output" placement="top-start" offset={10} className="tool-popover tool-popover-wide" testId="popover-output">
      <h2 className="tool-popover-title">Output</h2>
      <Segmented<ExportFormat>
        label="Format"
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG', disabled: jpegReason !== undefined, reason: jpegReason },
        ]}
        value={format}
        onChange={(next) => set({ format: next })}
        testId="output-format"
      />
      <Segmented<'1' | '2'>
        label="Scale"
        options={[
          { value: '1', label: '1×' },
          { value: '2', label: '2×' },
        ]}
        value={String(composition.output.scale) as '1' | '2'}
        onChange={(scale) => set({ scale: scale === '2' ? 2 : 1 })}
        testId="output-scale"
      />
      <p className="tool-popover-note" data-testid="output-size">
        {layout.canvas.width} × {layout.canvas.height} px {format.toUpperCase()}
      </p>
      {layout.capped && <p className="tool-popover-note tool-popover-warning">Capped at {MAX_OUTPUT_SIDE} px a side.</p>}
      {gif && <p className="tool-popover-note">GIFs export their first frame.</p>}
    </Popover>
  );
}
