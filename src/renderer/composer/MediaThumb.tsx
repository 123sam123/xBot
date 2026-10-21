import type { MediaItem } from '../../shared/contracts/media';
import { PlayIcon } from '../design-system';

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** An attachment's thumbnail: the generated PNG, else the image itself, else a video tile. */
export function MediaThumb({ media }: { media: MediaItem }) {
  const src = media.thumbUrl ?? (media.kind === 'image' ? media.url : null);
  return (
    <span className="media-thumb">
      {src ? (
        <img className="media-thumb-image" src={src} alt="" draggable={false} data-testid="attachment-thumbnail" />
      ) : (
        <span className="media-thumb-tile" aria-hidden="true" />
      )}
      {media.kind === 'video' && (
        <span className="media-thumb-video" aria-hidden="true">
          <PlayIcon size={14} />
          {media.durationMs !== null && <span>{duration(media.durationMs)}</span>}
        </span>
      )}
    </span>
  );
}
