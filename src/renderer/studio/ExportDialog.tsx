import type { RefObject } from 'react';
import { exportLayout, videoExportLayout } from '../../shared/composition/layout';
import { effectiveFormat, MAX_OUTPUT_SIDE, VIDEO_RESOLUTIONS, type Composition, type ExportFormat, type VideoResolution } from '../../shared/composition/model';
import type { ExportDestination } from '../../shared/contracts/studio';
import { timelineDuration } from '../../shared/composition/timeline';
import { FrostedButton, GhostButton, Popover, Segmented } from '../design-system';
import { formatClock } from './timeline/Timeline';

export const EXPORT_DIALOG = 'studio-export';

export interface ExportSettings {
  destination: ExportDestination;
  resolution: VideoResolution;
  fps: 30 | 60;
}

/** X plays video up to 1080p; bigger exports only go to a file. */
const POST_MAX: VideoResolution = '1080p';

/**
 * Cap's export dialog in xBot's terms: where it goes (the post, or a file),
 * and for a video its resolution and frame rate; for an image its format and
 * scale. While a video exports it shows the progress and Cancel.
 */
export function ExportDialog({
  anchor,
  composition,
  gif,
  settings,
  onSettings,
  onChange,
  onExport,
  progress,
  onCancel,
}: {
  anchor: RefObject<HTMLElement | null>;
  composition: Composition;
  gif: boolean;
  settings: ExportSettings;
  onSettings(next: ExportSettings): void;
  /** Format and scale live on the composition. */
  onChange(next: Composition): void;
  onExport(): void;
  /** 0–1 while exporting, null otherwise. */
  progress: number | null;
  onCancel(): void;
}) {
  const video = composition.video;
  const exporting = progress !== null;
  const resolution = settings.destination === 'post' && settings.resolution === '4k' ? POST_MAX : settings.resolution;
  const layout = video ? videoExportLayout(composition, resolution) : exportLayout(composition);
  const format: ExportFormat | 'mp4' = video ? 'mp4' : effectiveFormat(composition, gif);
  const jpegReason = composition.background.type === 'transparent' ? 'Transparent backgrounds export as PNG' : gif ? 'GIFs export their first frame as PNG' : undefined;
  const set = (patch: Partial<ExportSettings>) => onSettings({ ...settings, ...patch });

  return (
    <Popover id={EXPORT_DIALOG} anchor={anchor} label="Export" placement="bottom-end" offset={10} className="export-dialog" testId="export-dialog">
      <h2 className="export-title">Export</h2>

      <div className="export-field">
        <span className="export-label">Export to</span>
        <Segmented<ExportDestination>
          label="Export to"
          options={[
            { value: 'post', label: 'Add to post' },
            { value: 'file', label: 'Save to file' },
          ]}
          value={settings.destination}
          onChange={(destination) => !exporting && set({ destination })}
          testId="export-destination"
        />
      </div>

      {video ? (
        <>
          <div className="export-field">
            <span className="export-label">Resolution</span>
            <Segmented<VideoResolution>
              label="Resolution"
              options={(Object.keys(VIDEO_RESOLUTIONS) as VideoResolution[]).map((value) => ({
                value,
                label: VIDEO_RESOLUTIONS[value].label,
                disabled: settings.destination === 'post' && value === '4k',
                reason: 'X plays video up to 1080p: save 4K to a file',
              }))}
              value={resolution}
              onChange={(next) => !exporting && set({ resolution: next })}
              testId="export-resolution"
            />
          </div>
          <div className="export-field">
            <span className="export-label">Frame rate</span>
            <Segmented<'30' | '60'>
              label="Frame rate"
              options={[
                { value: '30', label: '30 fps' },
                { value: '60', label: '60 fps' },
              ]}
              value={String(settings.fps) as '30' | '60'}
              onChange={(fps) => !exporting && set({ fps: fps === '60' ? 60 : 30 })}
              testId="export-fps"
            />
          </div>
        </>
      ) : (
        <>
          <div className="export-field">
            <span className="export-label">Format</span>
            <Segmented<ExportFormat>
              label="Format"
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG', disabled: jpegReason !== undefined, reason: jpegReason },
              ]}
              value={format as ExportFormat}
              onChange={(next) => onChange({ ...composition, output: { ...composition.output, format: next } })}
              testId="output-format"
            />
          </div>
          <div className="export-field">
            <span className="export-label">Scale</span>
            <Segmented<'1' | '2'>
              label="Scale"
              options={[
                { value: '1', label: '1×' },
                { value: '2', label: '2×' },
              ]}
              value={String(composition.output.scale) as '1' | '2'}
              onChange={(scale) => onChange({ ...composition, output: { ...composition.output, scale: scale === '2' ? 2 : 1 } })}
              testId="output-scale"
            />
          </div>
        </>
      )}

      <p className="export-summary" data-testid="output-size">
        {layout.canvas.width} × {layout.canvas.height} · {video ? `MP4 (H.264) · ${formatClock(timelineDuration(video), true)}${video.muted ? ' · muted' : ''}` : format.toUpperCase()}
        {!video && layout.capped && ` · capped at ${MAX_OUTPUT_SIDE} px`}
      </p>

      {exporting ? (
        <div className="export-progress" role="status" data-testid="export-progress">
          <div className="export-bar">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="export-percent">{Math.round(progress * 100)}%</span>
          <GhostButton className="export-cancel" onClick={onCancel} data-testid="export-cancel">
            Cancel
          </GhostButton>
        </div>
      ) : (
        <FrostedButton className="export-go" onClick={onExport} data-testid="export-go">
          {settings.destination === 'post' ? 'Add to post' : 'Export to file…'}
        </FrostedButton>
      )}
    </Popover>
  );
}
