import { useEffect, useRef, useState } from 'react';

/**
 * Makes the whole window a drop target for files. Returns true while files
 * are dragged over it. Every drop's default is prevented, so a stray drop
 * never tries to open the file in the page. Drags of other kinds (an
 * attachment card being reordered) are left to their own handlers.
 */
export function useFileDrop(enabled: boolean, onFiles: (files: File[]) => void): boolean {
  const [active, setActive] = useState(false);
  const callback = useRef(onFiles);
  useEffect(() => {
    callback.current = onFiles;
  });

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setActive(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setActive(false);
      if (!enabled || !hasFiles(event)) return;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) callback.current(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [enabled]);

  return active && enabled;
}
