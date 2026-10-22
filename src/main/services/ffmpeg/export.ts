import { videoPlacement, type Layout } from '../../../shared/composition/layout';
import type { Composition } from '../../../shared/composition/model';
import type { H264Encoder, VideoInfo } from '../../../shared/contracts/studio';

// The MP4 export's FFmpeg arguments, built from the shared layout (pure, so
// tests read them). The renderer draws everything except the video into one
// PNG with a hole where the video shows (the frame layer). FFmpeg trims and
// crops the source, scales it into the hole's box, pads it to the canvas and
// lays the PNG over it. The video stays the main input, so its frames set the
// timing; the PNG is one frame that `eof_action=repeat` holds.

export interface ExportArgsInput {
  source: string;
  layer: string;
  output: string;
  info: VideoInfo;
  composition: Composition;
  /** `exportLayout(composition)`. */
  layout: Layout;
  encoder: H264Encoder;
  /** Read the input at its native rate (`-re`): tests use it to make an export take as long as the clip. */
  realtime?: boolean;
}

/** BT.709, limited range: what the output is tagged as and what both inputs are normalised to. */
const BT709 = 'setparams=colorspace=bt709:range=tv:color_primaries=bt709:color_trc=bt709';
const BT601 = new Set(['smpte170m', 'bt470bg']);

const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** The whole argument array, never a shell string. */
export function buildExportArgs({ source, layer, output, info, composition, layout, encoder, realtime = false }: ExportArgsInput): string[] {
  const video = composition.video;
  if (!video) throw new Error('not a video composition');
  const { box, crop } = videoPlacement(layout, composition.source);
  const { width, height } = layout.canvas;

  const chain: string[] = [];
  if (info.colorSpace && BT601.has(info.colorSpace)) chain.push(`colorspace=all=bt709:iall=${info.colorSpace}`);
  // Square pixels at the probed display size. (Autorotate's transpose would turn `iw*sar` the wrong way.)
  if (info.sampleAspect !== '1:1') chain.push(`scale=${info.width}:${info.height}`, 'setsar=1');
  chain.push(
    `scale=in_range=${info.colorRange ?? 'tv'}:out_range=tv`,
    // 4:4:4 before the crop, so odd offsets aren't snapped to the chroma grid.
    'format=yuv444p',
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`,
    `scale=${box.width}:${box.height}:flags=lanczos`,
    // A box a hair off the crop's aspect would otherwise get a non-square SAR.
    'setsar=1',
    `fps=${info.frameRate}`,
    BT709,
    `pad=${width}:${height}:${box.x}:${box.y}:color=black`,
  );
  const graph = [
    `[0:${info.videoStream}]${chain.join(',')}[base]`,
    `[1:v]setpts=PTS-STARTPTS,scale=out_color_matrix=bt709:out_range=tv,format=yuva444p,${BT709}[layer]`,
    '[base][layer]overlay=0:0:format=yuv444:eof_action=repeat,format=yuv420p[vout]',
  ].join(';');

  const audio =
    !video.muted && info.audioStream !== null
      ? [
          '-map',
          `0:${info.audioStream}`,
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          ...(info.audioChannels > 2 ? ['-ac', '2'] : []),
          ...(info.audioSampleRate > 48_000 ? ['-ar', '48000'] : []),
        ]
      : ['-an'];

  const codec =
    encoder === 'libx264'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'h264_videotoolbox', '-profile:v', 'high', '-b:v', String(videoToolboxBitrate(width, height, info.fps)), '-allow_sw', '1', '-pix_fmt', 'yuv420p'];

  return [
    '-hide_banner',
    '-nostdin',
    '-n',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:1',
    '-stats_period',
    '0.25',
    ...(realtime ? ['-re'] : []),
    '-ss',
    seconds(video.trimStartMs),
    '-t',
    seconds(video.trimEndMs - video.trimStartMs),
    '-i',
    source,
    '-i',
    layer,
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    ...audio,
    // Only picture and sound: no timecode or data tracks, subtitles, chapters or metadata (a phone's location tag).
    '-dn',
    '-sn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    ...codec,
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    output,
  ];
}

/** VideoToolbox takes a bitrate, not a quality: about 0.12 bits per pixel per frame, 2–20 Mbit/s. */
export function videoToolboxBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(20_000_000, Math.max(2_000_000, width * height * fps * 0.12)));
}

/** Reads `-progress pipe:1` lines; returns the progress (0–1) when the line carries one. */
export function progressFromLine(line: string, durationMs: number): number | null {
  const match = /^out_time_us=(-?\d+)\s*$/.exec(line);
  if (!match || durationMs <= 0) return null;
  return Math.min(1, Math.max(0, Number(match[1]) / (durationMs * 1000)));
}
