import { useEffect, useMemo, useState } from 'react';
import type { Composition } from '../../shared/composition/model';
import type { MediaItem } from '../../shared/contracts/media';
import { createBitmapCache } from '../common/composition/assets';
import type { CompositionAssets } from '../common/composition/draw';
import type { History } from './history';

const cache = createBitmapCache();

/** The media ids a composition draws as images. A video source isn't one: the stage's <video> shows it. */
function mediaIds(comp: Composition): string[] {
  const background = comp.background.type === 'image' ? [comp.background.mediaId] : [];
  return comp.video ? background : [comp.source.mediaId, ...background];
}

export interface LoadedAssets {
  assets: CompositionAssets;
  /** Every image the composition draws has decoded (or, for a background, failed and fallen back). A video's source never decodes here. */
  ready: boolean;
  /** The source could not be decoded (missing or unreadable file). */
  sourceFailed: boolean;
}

/**
 * Decodes the images `composition` draws, once per media id. Bitmaps that
 * any history entry still refers to stay decoded, so undo is instant; the
 * rest are closed.
 */
export function useCompositionAssets(composition: Composition | null, media: ReadonlyMap<string, MediaItem>, history: History<Composition> | null): LoadedAssets {
  // Bumped when a decode settles; the bitmaps themselves live in the cache.
  const [decoded, setDecoded] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  const wanted = composition ? mediaIds(composition) : [];
  const wantedKey = wanted.map((id) => `${id} ${media.get(id)?.url ?? ''}`).join('\n');

  useEffect(() => {
    let alive = true;
    for (const id of wanted) {
      const item = media.get(id);
      if (!item || cache.peek(id)) continue;
      cache.get(id, item.url).then(
        () => alive && setDecoded((n) => n + 1),
        (err: unknown) => {
          console.error('studio: could not decode', item.name, err);
          if (alive) setFailed((current) => new Set(current).add(id));
        },
      );
    }
    return () => {
      alive = false;
    };
    // `wantedKey` names exactly the ids and URLs read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  // Keep what any undo/redo step can bring back; close the rest.
  useEffect(() => {
    if (history) cache.retain(new Set([history.present, ...history.past, ...history.future].flatMap(mediaIds)));
  }, [history]);

  return useMemo(() => {
    if (!composition) return { assets: { source: null, background: null }, ready: false, sourceFailed: false };
    const sourceId = composition.source.mediaId;
    const video = composition.video !== undefined;
    const backgroundId = composition.background.type === 'image' ? composition.background.mediaId : null;
    const source = video ? null : cache.peek(sourceId);
    const background = backgroundId ? cache.peek(backgroundId) : null;
    const backgroundSettled = !backgroundId || background !== null || failed.has(backgroundId) || !media.has(backgroundId);
    return {
      assets: { source, background },
      ready: (video || source !== null) && backgroundSettled,
      sourceFailed: !video && failed.has(sourceId),
    };
    // `decoded` changes whenever a bitmap becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, decoded, failed, media]);
}
