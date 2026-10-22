import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  CanvasSink,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  UrlSource,
  type StreamTargetChunk,
} from 'mediabunny';
import { videoExportLayout } from '../../../shared/composition/layout';
import type { Composition, VideoResolution } from '../../../shared/composition/model';
import { clipLength, sceneAt, sourceTimeAt, timelineDuration, zoomAt } from '../../../shared/composition/timeline';
import { drawComposition, type CompositionAssets } from './draw';
import { RenderError } from './render';

// A video's export, entirely in the renderer: every output frame is drawn by
// the preview's own routine (background, frame, the source through the zoom)
// and encoded with WebCodecs (H.264, hardware where available) through
// Mediabunny, with the clips' audio laid end to end as AAC. The MP4 streams
// out through `write` as it is produced; main stores it.

export interface VideoExportOptions {
  composition: Composition;
  assets: CompositionAssets;
  /** The source video's xbot-media URL. */
  sourceUrl: string;
  /** A recording's camera video and where it starts in the recording, ms. */
  camera?: { url: string; offsetMs: number } | null;
  /** A recording's separate audio tracks and their volumes: mixed in place of the source's sound. */
  tracks?: { url: string; volume: number }[];
  resolution: VideoResolution;
  fps: 30 | 60;
  /** Writes `bytes` at `position` of the output file. */
  write(position: number, bytes: Uint8Array): Promise<void>;
  /** 0–1. */
  onProgress(progress: number): void;
  signal: AbortSignal;
}

const AUDIO_BITRATE = 160_000;
const MIX_RATE = 48_000;
const MIX_WINDOW_MS = 5000;

class Canceled extends Error {}

/** A copy of `buffer` from `from` s to `to` s of it. */
function sliceAudio(buffer: AudioBuffer, from: number, to: number): AudioBuffer | null {
  const start = Math.max(0, Math.round(from * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.round(to * buffer.sampleRate));
  if (end <= start) return null;
  if (start === 0 && end === buffer.length) return buffer;
  const out = new AudioBuffer({ length: end - start, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) out.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel);
  return out;
}

export async function exportVideo({ composition, assets, sourceUrl, camera, tracks = [], resolution, fps, write, onProgress, signal }: VideoExportOptions): Promise<void> {
  const video = composition.video;
  if (!video) throw new RenderError('render_failed', 'Only a video exports as MP4.');
  const layout = videoExportLayout(composition, resolution);
  const { width, height } = layout.canvas;
  if (!(await canEncodeVideo('avc', { width, height }))) throw new RenderError('render_failed', 'This Mac can’t encode H.264 video here.');

  const input = new Input({ source: new UrlSource(sourceUrl), formats: ALL_FORMATS });
  const cameraInput = camera && composition.camera && !composition.camera.hidden ? new Input({ source: new UrlSource(camera.url), formats: ALL_FORMATS }) : null;
  const disposables: Input[] = [];
  let output: Output | null = null;
  const check = () => {
    if (signal.aborted) throw new Canceled();
  };
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new RenderError('render_failed', 'The source has no video to export.');
    const mixing = tracks.length > 0;
    const audioTrack = video.muted || mixing ? null : await input.getPrimaryAudioTrack();
    const mixInputs = video.muted ? [] : tracks.map((track) => ({ input: new Input({ source: new UrlSource(track.url), formats: ALL_FORMATS }), volume: track.volume }));
    disposables.push(...mixInputs.map((m) => m.input));
    const mixSinks = (
      await Promise.all(mixInputs.map(async ({ input: trackInput, volume }) => ({ track: await trackInput.getPrimaryAudioTrack().catch(() => null), volume })))
    ).flatMap(({ track, volume }) => (track ? [{ sink: new AudioBufferSink(track), volume }] : []));
    const withAudio = mixing
      ? mixSinks.length > 0 && (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: MIX_RATE, bitrate: AUDIO_BITRATE }))
      : audioTrack !== null && (await audioTrack.canDecode()) && (await canEncodeAudio('aac', { numberOfChannels: audioTrack.numberOfChannels, sampleRate: audioTrack.sampleRate, bitrate: AUDIO_BITRATE }));

    // Writes land in order (the moov box last); `write` awaits main, which is the backpressure.
    const target = new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (chunk) => write(chunk.position, chunk.data) }), { chunked: true, chunkSize: 8 * 1024 * 1024 });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new RenderError('render_failed', 'Couldn’t start the video renderer.');
    const videoSource = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = withAudio ? new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    const totalMs = timelineDuration(video);
    const frames = Math.max(1, Math.round((totalMs / 1000) * fps));
    const frameSink = new CanvasSink(videoTrack, { poolSize: 2 });
    const times = function* () {
      for (let i = 0; i < frames; i++) yield sourceTimeAt(video, (i * 1000) / fps).sourceMs / 1000;
    };

    // The camera's frames, pulled in step with the screen's.
    const cameraTrack = cameraInput ? await cameraInput.getPrimaryVideoTrack().catch(() => null) : null;
    const cameraFrames = cameraTrack
      ? new CanvasSink(cameraTrack, { poolSize: 2 }).canvasesAtTimestamps(
          (function* () {
            for (let i = 0; i < frames; i++) yield Math.max(0, (sourceTimeAt(video, (i * 1000) / fps).sourceMs - camera!.offsetMs) / 1000);
          })(),
        )
      : null;

    const encodeVideo = async () => {
      let i = 0;
      for await (const frame of frameSink.canvasesAtTimestamps(times())) {
        check();
        const tMs = (i * 1000) / fps;
        const cameraFrame = cameraFrames ? ((await cameraFrames.next()).value ?? null) : null;
        drawComposition(ctx, composition, layout, assets, {
          frame: frame?.canvas ?? null,
          zoom: zoomAt(video.zooms, tMs),
          sourceMs: sourceTimeAt(video, tMs).sourceMs,
          camera: cameraFrame?.canvas ?? null,
          scene: sceneAt(video.scenes, tMs),
        });
        await videoSource.add(i / fps, 1 / fps);
        i++;
        onProgress(i / frames);
      }
      videoSource.close();
    };

    /** The tracks summed at their volumes, window by window, clip after clip. */
    const encodeMix = async () => {
      if (!audioSource) return;
      for (const clip of video.clips) {
        for (let from = clip.startMs; from < clip.endMs; from += MIX_WINDOW_MS) {
          const to = Math.min(clip.endMs, from + MIX_WINDOW_MS);
          const length = Math.max(1, Math.round(((to - from) / 1000) * MIX_RATE));
          const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: MIX_RATE });
          const left = out.getChannelData(0);
          const right = out.getChannelData(1);
          for (const { sink, volume } of mixSinks) {
            for await (const { buffer, timestamp } of sink.buffers(from / 1000, to / 1000)) {
              check();
              const ratio = MIX_RATE / buffer.sampleRate;
              const offset = (timestamp - from / 1000) * MIX_RATE;
              const l = buffer.getChannelData(0);
              const r = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
              for (let i = 0; i < buffer.length; i++) {
                const j = Math.round(offset + i * ratio);
                if (j < 0 || j >= length) continue;
                left[j]! += l[i]! * volume;
                right[j]! += r[i]! * volume;
              }
            }
          }
          await audioSource.add(out);
        }
      }
      audioSource.close();
    };

    const encodeAudio = async () => {
      if (mixing) return encodeMix();
      if (!audioSource || !audioTrack) return;
      const sink = new AudioBufferSink(audioTrack);
      for (const clip of video.clips) {
        const from = clip.startMs / 1000;
        const to = from + clipLength(clip) / 1000;
        for await (const { buffer, timestamp } of sink.buffers(from, to)) {
          check();
          const slice = sliceAudio(buffer, Math.max(from, timestamp) - timestamp, to - timestamp);
          if (slice) await audioSource.add(slice);
        }
      }
      audioSource.close();
    };

    await Promise.all([encodeVideo(), encodeAudio()]);
    check();
    await output.finalize();
  } catch (err) {
    await output?.cancel().catch(() => {});
    if (err instanceof Canceled) throw new RenderError('export_canceled', 'Export canceled.');
    if (err instanceof RenderError) throw err;
    console.error('studio: video export failed', err);
    throw new RenderError('render_failed', 'Couldn’t export this video.');
  } finally {
    input.dispose();
    cameraInput?.dispose();
    for (const extra of disposables) extra.dispose();
  }
}
