import { z } from 'zod';
import type { VideoInfo } from '../../../shared/contracts/studio';
import { runTool, type Runner } from './run';

// What a video is, according to ffprobe. Its output is untrusted input, so it
// is parsed with zod. "Readable" means ffprobe finds a real video stream (not
// cover art) with a size and a duration, and actually decodes its first frame:
// headers alone accept a box tree around garbage. No `electron` import.

/** Why a file isn't a usable video; `reason` picks the sentence the user sees. */
export class VideoProbeError extends Error {
  constructor(readonly reason: 'unreadable' | 'no-video') {
    super(reason);
    this.name = 'VideoProbeError';
  }
}

/** Above this the export is capped anyway; it is also X's limit. */
const MAX_FPS = 60;
const MAX_SIDE = 16_384;

const numeric = z.union([z.number(), z.string()]).optional();

const streamSchema = z.looseObject({
  index: z.number().int().min(0),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  sample_aspect_ratio: z.string().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  duration: numeric,
  channels: z.number().int().optional(),
  sample_rate: numeric,
  color_space: z.string().optional(),
  color_range: z.string().optional(),
  color_transfer: z.string().optional(),
  disposition: z.looseObject({ attached_pic: z.number().optional() }).optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
  side_data_list: z.array(z.looseObject({ rotation: numeric })).optional(),
});

const probeSchema = z.looseObject({
  streams: z.array(streamSchema).default([]),
  format: z.looseObject({ duration: numeric }).optional(),
});

const countSchema = z.looseObject({ streams: z.array(z.looseObject({ nb_read_frames: numeric })).default([]) });

type Stream = z.infer<typeof streamSchema>;

function number(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "30000/1001" → 29.97; null for "0/0" and the like. */
export function rational(text: string | undefined): number | null {
  if (!text) return null;
  const [num, den = '1'] = text.split('/');
  const value = Number(num) / Number(den);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Clockwise display rotation, from the display matrix (ffprobe ≥ 5) or the old `rotate` tag. */
function rotationOf(stream: Stream): VideoInfo['rotation'] {
  const fromMatrix = stream.side_data_list?.map((side) => number(side.rotation)).find((r) => r !== null);
  const raw = fromMatrix ?? number(stream.tags?.rotate as string | undefined) ?? 0;
  // ffprobe reports the matrix rotation counter-clockwise (e.g. -90 for a phone held upright).
  const quarter = ((Math.round(-raw / 90) % 4) + 4) % 4;
  return (quarter * 90) as VideoInfo['rotation'];
}

/**
 * The export rate: r_frame_rate, which keeps every frame of a variable-rate
 * screen recording (its avg_frame_rate can be ~12 fps across static stretches),
 * else avg_frame_rate, else 30; capped at 60.
 */
export function frameRate(stream: Pick<Stream, 'r_frame_rate' | 'avg_frame_rate'>): { fps: number; frameRate: string } {
  const r = rational(stream.r_frame_rate);
  const avg = rational(stream.avg_frame_rate);
  const [value, text] = r !== null && r <= 120 ? [r, stream.r_frame_rate!] : avg !== null ? [avg, stream.avg_frame_rate!] : [30, '30'];
  return value > MAX_FPS ? { fps: MAX_FPS, frameRate: String(MAX_FPS) } : { fps: Math.round(value * 1000) / 1000, frameRate: text };
}

/** Parses `ffprobe -show_format -show_streams -print_format json`. Throws VideoProbeError. */
export function parseProbe(json: string): VideoInfo {
  let data: z.infer<typeof probeSchema>;
  try {
    data = probeSchema.parse(JSON.parse(json));
  } catch {
    throw new VideoProbeError('unreadable');
  }
  const video = data.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new VideoProbeError('no-video');
  const codedWidth = video.width ?? 0;
  const codedHeight = video.height ?? 0;
  if (codedWidth < 2 || codedHeight < 2 || codedWidth > MAX_SIDE || codedHeight > MAX_SIDE) throw new VideoProbeError('unreadable');

  const sar = rational(video.sample_aspect_ratio?.replace(':', '/')) ?? 1;
  const sampleAspect = sar === 1 || !video.sample_aspect_ratio ? '1:1' : video.sample_aspect_ratio;
  const displayWidth = Math.max(2, Math.round(codedWidth * (sampleAspect === '1:1' ? 1 : sar)));
  const rotation = rotationOf(video);
  const quarterTurn = rotation === 90 || rotation === 270;

  const seconds = number(video.duration) ?? number(data.format?.duration);
  if (seconds === null || seconds <= 0) throw new VideoProbeError('unreadable');

  const audio = data.streams.find((s) => s.codec_type === 'audio');
  const range = video.color_range === 'pc' || video.color_range === 'tv' ? video.color_range : null;
  return {
    durationMs: Math.round(seconds * 1000),
    width: quarterTurn ? codedHeight : displayWidth,
    height: quarterTurn ? displayWidth : codedHeight,
    rotation,
    ...frameRate(video),
    videoStream: video.index,
    audioStream: audio?.index ?? null,
    videoCodec: video.codec_name ?? 'unknown',
    audioCodec: audio?.codec_name ?? null,
    audioChannels: audio?.channels ?? 0,
    audioSampleRate: number(audio?.sample_rate) ?? 0,
    codedWidth,
    codedHeight,
    sampleAspect,
    colorSpace: video.color_space && video.color_space !== 'unknown' ? video.color_space : null,
    colorRange: range,
    hdr: video.color_transfer === 'arib-std-b67' || video.color_transfer === 'smpte2084',
  };
}

/** Probes `file` and decodes its first video frame. Throws VideoProbeError, or ToolError when ffprobe itself misbehaves. */
export async function probeVideo(ffprobe: string, file: string, { run = runTool, timeoutMs = 15_000 }: { run?: Runner; timeoutMs?: number } = {}): Promise<VideoInfo> {
  let json: string;
  try {
    json = (await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs })).stdout;
  } catch {
    throw new VideoProbeError('unreadable');
  }
  const info = parseProbe(json);
  // -select_streams: without it a first audio packet would be the interval's only packet.
  let decoded: number | null = null;
  try {
    const { stdout } = await run(
      ffprobe,
      ['-v', 'error', '-select_streams', String(info.videoStream), '-count_frames', '-read_intervals', '%+#1', '-show_entries', 'stream=nb_read_frames', '-print_format', 'json', file],
      { timeoutMs },
    );
    decoded = number(countSchema.parse(JSON.parse(stdout)).streams[0]?.nb_read_frames);
  } catch {
    // counted as nothing decoded
  }
  if (!decoded || decoded < 1) throw new VideoProbeError('unreadable');
  return info;
}
