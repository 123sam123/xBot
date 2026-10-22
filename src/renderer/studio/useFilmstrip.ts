import { useEffect, useState } from 'react';

/**
 * The video document's filmstrip as blob: URLs (main sends the JPEG bytes;
 * `xbot-media:` only serves the media folder). Empty while it loads, when
 * FFmpeg is missing, and for an image document. URLs are revoked when the
 * document changes.
 */
export function useFilmstrip(documentId: string | null, enabled: boolean): string[] {
  const [frames, setFrames] = useState<{ documentId: string; urls: string[] } | null>(null);

  useEffect(() => {
    if (!documentId || !enabled) return;
    let alive = true;
    let urls: string[] = [];
    void window.xbot.studio.filmstrip(documentId).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        console.warn('studio: no filmstrip', result.error.message);
        return;
      }
      urls = result.data.map((bytes) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })));
      setFrames({ documentId, urls });
    });
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documentId, enabled]);

  return frames && frames.documentId === documentId && enabled ? frames.urls : [];
}
