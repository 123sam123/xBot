import { mediaUrl, type MediaItem, type MediaKind } from '../../../shared/contracts/media';

// The `media` table's row shape and how the renderer sees it. Shared by the
// drafts and media services; no `electron` import.

export interface MediaRow {
  id: string;
  kind: MediaKind;
  /** Relative to userData/media. */
  path: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  bytes: number;
  sha256: string;
  /** Relative to userData/media. */
  thumb_path: string | null;
  original_name: string;
  created_at: string;
}

export function toMediaItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    bytes: row.bytes,
    name: row.original_name,
    url: mediaUrl(row.path),
    thumbUrl: row.thumb_path ? mediaUrl(row.thumb_path) : null,
  };
}

/** What a history row shows: the thumbnail, else the image itself; null for a video without a poster. */
export function previewUrl(item: MediaItem): string | null {
  return item.thumbUrl ?? (item.kind === 'image' ? item.url : null);
}
