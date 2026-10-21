import { clampCrop, MIN_CROP_PX, type Rect, type SourceRef } from '../../shared/composition/model';

// Crop-rect maths in fractions of the source. An aspect lock is given in
// source px (width / height) and converted to fraction units here.

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

type Size = Pick<SourceRef, 'width' | 'height'>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The largest rect of `ratio` (source px) centred inside `within`, or `within` itself when free. */
export function fitAspect(within: Rect, ratio: number | null, source: Size): Rect {
  if (ratio === null) return within;
  const fr = (ratio * source.height) / source.width; // width / height in fraction units
  let width = within.width;
  let height = width / fr;
  if (height > within.height) {
    height = within.height;
    width = height * fr;
  }
  return clampCrop({ x: within.x + (within.width - width) / 2, y: within.y + (within.height - height) / 2, width, height }, source);
}

/**
 * The crop after dragging `handle` by (dx, dy) fractions from `start`. Edges
 * stay inside the source and at least MIN_CROP_PX apart; with a lock, the
 * corner or edge opposite the handle stays put.
 */
export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, ratio: number | null, source: Size): Rect {
  const minW = Math.min(MIN_CROP_PX, source.width) / source.width;
  const minH = Math.min(MIN_CROP_PX, source.height) / source.height;
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) };
  }

  if (ratio === null) {
    let { x, y } = start;
    let x2 = right;
    let y2 = bottom;
    if (handle.includes('w')) x = clamp(start.x + dx, 0, right - minW);
    if (handle.includes('e')) x2 = clamp(right + dx, start.x + minW, 1);
    if (handle.includes('n')) y = clamp(start.y + dy, 0, bottom - minH);
    if (handle.includes('s')) y2 = clamp(bottom + dy, start.y + minH, 1);
    return { x, y, width: x2 - x, height: y2 - y };
  }

  const fr = (ratio * source.height) / source.width;
  const minWidth = Math.max(minW, minH * fr);
  if (handle === 'n' || handle === 's' || handle === 'e' || handle === 'w') {
    // An edge: the opposite edge stays, the rect stays centred across it.
    const vertical = handle === 'n' || handle === 's';
    const cx = start.x + start.width / 2;
    const cy = start.y + start.height / 2;
    const room = vertical
      ? Math.min(handle === 's' ? 1 - start.y : bottom, 2 * Math.min(cx, 1 - cx) / fr)
      : Math.min(handle === 'e' ? 1 - start.x : right, 2 * Math.min(cy, 1 - cy) * fr);
    const along = vertical ? start.height + (handle === 's' ? dy : -dy) : start.width + (handle === 'e' ? dx : -dx);
    const size = clamp(along, vertical ? minWidth / fr : minWidth, room);
    const width = vertical ? size * fr : size;
    const height = vertical ? size : size / fr;
    return {
      x: vertical ? cx - width / 2 : handle === 'e' ? start.x : right - width,
      y: vertical ? (handle === 's' ? start.y : bottom - height) : cy - height / 2,
      width,
      height,
    };
  }

  // A corner: the opposite corner is the anchor.
  const east = handle.includes('e');
  const south = handle.includes('s');
  const anchorX = east ? start.x : right;
  const anchorY = south ? start.y : bottom;
  const wantW = Math.abs((east ? right + dx : start.x + dx) - anchorX);
  const wantH = Math.abs((south ? bottom + dy : start.y + dy) - anchorY);
  const maxW = Math.min(east ? 1 - anchorX : anchorX, (south ? 1 - anchorY : anchorY) * fr);
  const width = clamp(Math.max(wantW, wantH * fr), minWidth, maxW);
  const height = width / fr;
  return { x: east ? anchorX : anchorX - width, y: south ? anchorY : anchorY - height, width, height };
}
