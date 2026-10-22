import type { RefObject } from 'react';
import { exportLayout } from '../../shared/composition/layout';
import { effectiveFormat, MAX_OUTPUT_SIDE, MAX_VIDEO_OUTPUT, type Composition, type ExportFormat } from '../../shared/composition/model';
import type { VideoInfo } from '../../shared/contracts/studio';
import { Popover, Segmented } from '../design-system';

export const OUTPUT_POPOVER = 'studio-output';

/** "00:02.5" for a clip length. */
function length(ms: number): string {
  const tenths = Math.round(ms / 100);
  const seconds = Math.floor(tenths / 10);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}

/**
 * Format and scale of the export "Add to post" renders, and the size it comes
 * out at. A video always exports as MP4 at 1×, inside the 1080p box.
 */
export function OutputPopover({
  anchor,
  composition,
  gif,
  video,
  onChange,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  composition: Composition;
  /** GIF sources export their first frame, as PNG. */
  gif: boolean;
  /** Set for a video document. */
  video?: VideoInfo | null;
  onChange(next: Composition): void;
}) {
  const layout = exportLayout(composition);
  const set = (patch: Partial<Composition['output']>) => onChange({ ...composition, output: { ...composition.output, ...patch } });

  if (video && composition.video) {
    const { trimStartMs, trimEndMs, muted } = composition.video;
    const sound = video.audioStream === null ? 'No sound' : muted ? 'Muted' : 'With sound';
    return (
      <Popover id={OUTPUT_POPOVER} anchor={anchor} label="Output" placement="top-start" offset={10} className="tool-popover tool-popover-wide" testId="popover-output">
        <h2 className="tool-popover-title">Output</h2>
        <p className="tool-popover-note" data-testid="output-size">
          {layout.canvas.width} × {layout.canvas.height} px MP4 (H.264)
        </p>
        <p className="tool-popover-note" data-testid="output-clip">
          {length(trimEndMs - trimStartMs)} · {sound}
        </p>
        {layout.capped && (
          <p className="tool-popover-note">
            Videos export at up to {MAX_VIDEO_OUTPUT.long} × {MAX_VIDEO_OUTPUT.short}.
          </p>
        )}
        {video.hdr && <p className="tool-popover-note tool-popover-warning">HDR video: colours in the export will be off (xBot doesn’t convert HDR).</p>}
      </Popover>
    );
  }

  const format = effectiveFormat(composition, gif);
  const jpegReason = composition.background.type === 'transparent' ? 'Transparent backgrounds export as PNG' : gif ? 'GIFs export their first frame as PNG' : undefined;
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
