import { open, type FileHandle } from 'node:fs/promises';

// Media validation by content, never by extension. Pure Node (no `electron`),
// so unit tests load it. `sniff` names the format from the first bytes;
// `probe` reads the size (and a video's duration) from the headers and rejects
// files whose structure does not hold up.

export type MediaFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'mp4' | 'mov';

export interface SniffedType {
  format: MediaFormat;
  kind: 'image' | 'video';
  mime: string;
  ext: string;
}

export interface Probe extends SniffedType {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Why a file was refused; `reason` picks the message the user sees. */
export class ProbeError extends Error {
  constructor(readonly reason: 'unsupported' | 'unreadable' | 'too-many-pixels') {
    super(reason);
    this.name = 'ProbeError';
  }
}

/** Bytes `sniff` needs. */
export const SNIFF_BYTES = 32;
/** Larger images are refused before anything decodes them. */
export const MAX_IMAGE_SIDE = 16_384;

const TYPES: Record<MediaFormat, SniffedType> = {
  png: { format: 'png', kind: 'image', mime: 'image/png', ext: 'png' },
  jpeg: { format: 'jpeg', kind: 'image', mime: 'image/jpeg', ext: 'jpg' },
  gif: { format: 'gif', kind: 'image', mime: 'image/gif', ext: 'gif' },
  webp: { format: 'webp', kind: 'image', mime: 'image/webp', ext: 'webp' },
  mp4: { format: 'mp4', kind: 'video', mime: 'video/mp4', ext: 'mp4' },
  mov: { format: 'mov', kind: 'video', mime: 'video/quicktime', ext: 'mov' },
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);
/** First atoms of QuickTime files written without an `ftyp` box. */
const LEGACY_QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip']);

const ascii = (buf: Buffer, start: number, end: number) => buf.toString('latin1', start, end);

/** The format named by a file's first bytes, or null when it is not one xBot takes. */
export function sniff(head: Buffer): SniffedType | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return TYPES.png;
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return TYPES.jpeg;
  if (head.length >= 6 && (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a')) return TYPES.gif;
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return TYPES.webp;
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (brand === 'qt  ') return TYPES.mov;
    return MP4_BRANDS.has(brand) ? TYPES.mp4 : null;
  }
  if (head.length >= 8 && LEGACY_QUICKTIME_ATOMS.has(ascii(head, 4, 8))) return TYPES.mov;
  return null;
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await file.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** Validates `path` as `type` and reads its size. Throws ProbeError. */
export async function probe(path: string, type: SniffedType, size: number): Promise<Probe> {
  const file = await open(path, 'r');
  try {
    if (type.kind === 'video') return { ...type, ...(await probeVideo(file, size)) };
    const { width, height } = await probeImage(file, type.format, size);
    if (width < 1 || height < 1) throw new ProbeError('unreadable');
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) throw new ProbeError('too-many-pixels');
    return { ...type, width, height, durationMs: null };
  } finally {
    await file.close();
  }
}

// ---------------------------------------------------------------- images

async function probeImage(file: FileHandle, format: MediaFormat, size: number): Promise<{ width: number; height: number }> {
  if (format === 'jpeg') return jpegSize(await readAt(file, 0, Math.min(size, 2 * 1024 * 1024)));
  const head = await readAt(file, 0, 32);
  switch (format) {
    case 'png':
      if (head.length < 24 || ascii(head, 12, 16) !== 'IHDR') throw new ProbeError('unreadable');
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    case 'gif':
      if (head.length < 10) throw new ProbeError('unreadable');
      return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    case 'webp':
      return webpSize(head);
    default:
      throw new ProbeError('unsupported');
  }
}

function webpSize(head: Buffer): { width: number; height: number } {
  if (head.length < 30) throw new ProbeError('unreadable');
  const chunk = ascii(head, 12, 16);
  if (chunk === 'VP8 ') {
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) throw new ProbeError('unreadable');
    return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (head[20] !== 0x2f) throw new ProbeError('unreadable');
    const bits = head.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 };
  throw new ProbeError('unreadable');
}

/** SOFn size, swapped when the EXIF orientation turns the picture by 90°. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  let orientation = 1;
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) throw new ProbeError('unreadable');
    const marker = buf[pos + 1]!;
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan before any frame header
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) throw new ProbeError('unreadable');
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (pos + 9 > buf.length) break;
      const height = buf.readUInt16BE(pos + 5);
      const width = buf.readUInt16BE(pos + 7);
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
    }
    if (marker === 0xe1 && ascii(buf, pos + 4, pos + 10) === 'Exif\0\0') {
      orientation = exifOrientation(buf.subarray(pos + 10, pos + 2 + length)) ?? orientation;
    }
    pos += 2 + length;
  }
  throw new ProbeError('unreadable');
}

function exifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (at: number) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

// ---------------------------------------------------------------- video

interface Box {
  type: string;
  /** Offset of the payload (after the header). */
  start: number;
  /** Offset just past the box. */
  end: number;
}

/** Reads one box header at `offset`; null when the box does not fit inside `limit`. */
function boxAt(buf: Buffer, offset: number, limit: number, base = 0): Box | null {
  if (offset + 8 > buf.length) return null;
  const size32 = buf.readUInt32BE(offset);
  const type = ascii(buf, offset + 4, offset + 8);
  let header = 8;
  let size: number;
  if (size32 === 1) {
    if (offset + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(offset + 8));
    header = 16;
  } else if (size32 === 0) {
    size = limit - (base + offset); // runs to the end
  } else {
    size = size32;
  }
  if (size < header || base + offset + size > limit) return null;
  return { type, start: base + offset + header, end: base + offset + size };
}

/** Child boxes of a payload held in `buf` (which starts at file offset `base`). */
function* children(buf: Buffer, base: number, start: number, end: number): Generator<Box> {
  let offset = start - base;
  let guard = 0;
  while (offset + 8 <= end - base && guard++ < 10_000) {
    const box = boxAt(buf, offset, end, base);
    if (!box) return;
    yield box;
    offset = box.end - base;
  }
}

/** Largest `moov` box xBot reads to find the duration and size. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/**
 * Walks the top-level ISO-BMFF / QuickTime boxes: every box must fit inside
 * the file (a cut-off download fails here) and a `moov` box must exist. The
 * duration comes from `mvhd`, the size from the first video `tkhd`.
 */
async function probeVideo(file: FileHandle, size: number): Promise<{ width: number | null; height: number | null; durationMs: number | null }> {
  let offset = 0;
  let moov: Box | null = null;
  let guard = 0;
  while (offset < size) {
    if (guard++ > 10_000) throw new ProbeError('unreadable');
    const header = await readAt(file, offset, 16);
    const box = boxAt(header, 0, size, offset);
    if (!box) throw new ProbeError('unreadable');
    if (box.type === 'moov') moov = box;
    offset = box.end;
  }
  if (!moov) throw new ProbeError('unreadable');
  if (moov.end - moov.start > MAX_MOOV_BYTES) return { width: null, height: null, durationMs: null };

  const buf = await readAt(file, moov.start, moov.end - moov.start);
  let durationMs: number | null = null;
  let dims: { width: number; height: number } | null = null;
  for (const box of children(buf, moov.start, moov.start, moov.end)) {
    if (box.type === 'mvhd') durationMs = mvhdDuration(buf.subarray(box.start - moov.start, box.end - moov.start));
    if (box.type === 'trak' && !dims) {
      for (const inner of children(buf, moov.start, box.start, box.end)) {
        if (inner.type !== 'tkhd') continue;
        const found = tkhdSize(buf.subarray(inner.start - moov.start, inner.end - moov.start));
        if (found) dims = found;
      }
    }
  }
  return { width: dims?.width ?? null, height: dims?.height ?? null, durationMs };
}

function mvhdDuration(payload: Buffer): number | null {
  const version = payload[0];
  if (version === 1) {
    if (payload.length < 32) return null;
    const timescale = payload.readUInt32BE(20);
    const duration = Number(payload.readBigUInt64BE(24));
    return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
  }
  if (payload.length < 20) return null;
  const timescale = payload.readUInt32BE(12);
  const duration = payload.readUInt32BE(16);
  return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
}

/** A track's display size; null for tracks without one (audio). Applies a 90° / 270° matrix. */
function tkhdSize(payload: Buffer): { width: number; height: number } | null {
  // version/flags, times, track id, duration, reserved, layer, group, volume: 40 bytes (52 in version 1).
  const matrixAt = payload[0] === 1 ? 52 : 40;
  if (payload.length < matrixAt + 44) return null;
  const width = Math.round(payload.readUInt32BE(matrixAt + 36) / 65536);
  const height = Math.round(payload.readUInt32BE(matrixAt + 40) / 65536);
  if (width === 0 || height === 0) return null;
  const a = payload.readInt32BE(matrixAt);
  const d = payload.readInt32BE(matrixAt + 16);
  const quarterTurn = a === 0 && d === 0;
  return quarterTurn ? { width: height, height: width } : { width, height };
}
