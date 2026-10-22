// Decoded images for the composition, cached per media id. The preview and
// the export draw the same full-resolution bitmap, so they agree.
//
// `xbot-media:` URLs are fetched (the scheme sends CORS headers, so the
// canvas stays readable); anything else, such as the bundled preview sample
// (a `file:` URL in builds), goes through an <img>. EXIF orientation is
// applied, and an animated GIF yields its first frame.

const MEDIA_SCHEME = 'xbot-media:';

async function decode(url: string): Promise<ImageBitmap> {
  if (url.startsWith(MEDIA_SCHEME)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);
    return createImageBitmap(await response.blob(), { imageOrientation: 'from-image' });
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return createImageBitmap(img);
}

export interface BitmapCache {
  /** The decoded image for `id`, decoding `url` the first time. A failure is not cached. */
  get(id: string, url: string): Promise<ImageBitmap>;
  /** The decoded image for `id` if it is ready and still open. */
  peek(id: string): ImageBitmap | null;
  /** Closes every bitmap whose id is not in `keep`. */
  retain(keep: ReadonlySet<string>): void;
}

export function createBitmapCache(): BitmapCache {
  const entries = new Map<string, { url: string; bitmap: Promise<ImageBitmap>; ready: ImageBitmap | null }>();
  return {
    get(id, url) {
      const hit = entries.get(id);
      if (hit && hit.url === url) return hit.bitmap;
      const bitmap = decode(url);
      const entry = { url, bitmap, ready: null as ImageBitmap | null };
      entries.set(id, entry);
      bitmap.then(
        (decoded) => {
          entry.ready = decoded;
        },
        () => {
          if (entries.get(id) === entry) entries.delete(id);
        },
      );
      return bitmap;
    },
    peek: (id) => entries.get(id)?.ready ?? null,
    retain(keep) {
      for (const [id, entry] of entries) {
        if (keep.has(id)) continue;
        entries.delete(id);
        void entry.bitmap.then((bitmap) => bitmap.close(), () => {});
      }
    },
  };
}
