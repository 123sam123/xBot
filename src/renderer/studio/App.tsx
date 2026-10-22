import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyStyle, clampCrop, cropAspectRatio, effectiveFormat, outputSize, replaceSource, styleOf, type CanvasRatio, type CropAspect, type Rect, type VideoSettings } from '../../shared/composition/model';
import { clipStartTime, sourceTimeAt, splitAt, timelineDuration } from '../../shared/composition/timeline';
import type { IpcResult } from '../../shared/contracts/ipc';
import type { AddToPostResult, BeginExportResult, StudioPreset } from '../../shared/contracts/studio';
import { CompositionCanvas } from '../common/composition/CompositionCanvas';
import { loadCursor, type LoadedCursor } from '../common/composition/cursor';
import { renderComposition, RenderError } from '../common/composition/render';
import { exportVideo } from '../common/composition/videoExport';
import '../common/composition/composition.css';
import { useAppInfo, useReadyMarker } from '../common/useAppInfo';
import { useEscapeToHide } from '../common/useEscapeToHide';
import { useFileDrop } from '../common/useFileDrop';
import { useSettings } from '../common/useSettings';
import { FrostedButton, GhostButton, GlassPanel, Menu, popovers, Segmented, StatusChip, useAppearance, useEscapeLayer, useGlassShadow, type MenuItem } from '../design-system';
import { fitAspect } from './crop';
import { CropOverlay } from './CropOverlay';
import { EXPORT_DIALOG, ExportDialog, type ExportSettings } from './ExportDialog';
import { FfmpegCard, useFfmpegStatus } from './FfmpegCard';
import { FramePopover } from './FramePopover';
import { PRESETS_POPOVER, PresetsPopover } from './PresetsPopover';
import { PreviewPanel, SIZE_POPOVER, SizePopover, Transport, type PreviewQuality } from './PreviewPanel';
import { Sidebar } from './Sidebar';
import { SCENE_EDITOR, SceneEditor, ZOOM_EDITOR, ZoomEditor } from './timeline/SegmentEditors';
import { Timeline, type TimelineSelection } from './timeline/Timeline';
import { TopBar } from './TopBar';
import { useCompositionAssets } from './useCompositionAssets';
import { useFilmstrip } from './useFilmstrip';
import { useStudioEditor } from './useStudioEditor';
import { useCameraSync } from './useCameraSync';
import { useTimelinePlayback } from './useTimelinePlayback';

// Media Studio: Cap's editor in xBot's glass. A top bar, the preview with its
// toolbar and transport, the inspector on the right, and for a video the
// multi-track timeline (clips, zooms, scenes). Screenshots open in the same
// editor without the timeline. The preview and every export draw the same
// Composition with the same routine (common/composition): images render to
// PNG/JPEG here, videos are encoded here with WebCodecs and streamed to main,
// which puts the result on the post or saves it to a file. Without FFmpeg a
// video opens read-only with guidance (it is needed to read videos).

const NOTICE_MS = 3200;
const DELETE_MENU = 'studio-delete';
const FILE_MENU = 'studio-file';
const MIN_TIMELINE = 150;

async function backToPost() {
  await window.xbot.windows.hide();
  await window.xbot.windows.showComposer();
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'color');
}

function useElementSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function App() {
  const { info, ready: infoReady } = useAppInfo();
  const { values: settings, ready: settingsReady } = useSettings();

  useEscapeToHide();
  useAppearance(settings?.['ui.reduceTransparency'] ?? false, settings?.['ui.increaseContrast'] ?? false, settings?.['ui.glassClarity']);
  useGlassShadow();

  const preview = info?.isPreview ?? false;
  return infoReady ? <Studio key={preview ? 'preview' : 'normal'} preview={preview} settingsReady={settingsReady} /> : <GlassPanel className="studio" data-testid="studio-panel" />;
}

function Studio({ preview, settingsReady }: { preview: boolean; settingsReady: boolean }) {
  const editor = useStudioEditor();
  const { composition, document: doc, status } = editor;
  const loaded = useCompositionAssets(composition, editor.media, editor.history);
  useReadyMarker(settingsReady && status !== 'loading');

  const presetsAnchor = useRef<HTMLButtonElement>(null);
  const aspectAnchor = useRef<HTMLButtonElement>(null);
  const frameAnchor = useRef<HTMLButtonElement>(null);
  const qualityAnchor = useRef<HTMLButtonElement>(null);
  const exportAnchor = useRef<HTMLSpanElement>(null);
  const deleteAnchor = useRef<HTMLButtonElement>(null);
  const nameAnchor = useRef<HTMLButtonElement>(null);
  const zoomAnchor = useRef<HTMLElement | null>(null);
  const stageArea = useRef<HTMLDivElement>(null);
  const cropOverlay = useRef<HTMLDivElement>(null);
  const area = useElementSize(stageArea);

  const [fullscreen, setFullscreen] = useState(() => document.documentElement.hasAttribute('data-fullscreen'));
  const [busy, setBusy] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<{ crop: Rect; aspect: CropAspect } | null>(null);
  /** The playhead when cropping began: the frame cropped against. */
  const [cropTime, setCropTime] = useState(0);
  const [quality, setQuality] = useState<PreviewQuality>('full');
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineHeight, setTimelineHeight] = useState(250);
  const [selection, setSelection] = useState<TimelineSelection>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({ destination: 'post', resolution: '1080p', fps: 30 });
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const { notice, setNotice, error, setError } = editor;

  const videoInfo = status === 'document' ? (doc?.video ?? null) : null;
  const isVideo = videoInfo !== null && composition?.video !== undefined;
  const hasAudio = (videoInfo?.audioStream ?? null) !== null;
  const ffmpeg = useFfmpegStatus(true);
  const { ref: videoRef, element: videoElement, clock, playing, toggle: togglePlay, pause, seek } = useTimelinePlayback(composition?.video, hasAudio);
  const filmstrip = useFilmstrip(isVideo && doc ? doc.id : null, ffmpeg.state === 'ready');

  // A recording's camera (synced to the playhead) and cursor.
  const recording = status === 'document' ? (doc?.recording ?? null) : null;
  const { ref: cameraRef, element: cameraElement } = useCameraSync(composition?.video, clock, playing, recording?.camera?.offsetMs ?? null);
  const [cursor, setCursor] = useState<{ url: string; loaded: LoadedCursor } | null>(null);
  const cursorUrl = recording?.cursor?.url ?? null;
  const cursorBase = recording?.cursor?.base ?? '';
  useEffect(() => {
    if (!cursorUrl) return;
    let alive = true;
    loadCursor(cursorUrl, cursorBase).then(
      (loaded) => alive && setCursor({ url: cursorUrl, loaded }),
      (err: unknown) => console.error('studio: could not load the cursor track', err),
    );
    return () => {
      alive = false;
    };
  }, [cursorUrl, cursorBase]);
  const loadedCursor = cursor && cursor.url === cursorUrl ? cursor.loaded : null;
  const assets = useMemo(() => ({ ...loaded.assets, cursor: loadedCursor }), [loaded.assets, loadedCursor]);

  const sourceItem = composition ? editor.media.get(composition.source.mediaId) : undefined;
  const sourceMissing = Boolean(composition && doc && ((doc.sourceMissing && composition.source.mediaId === doc.source.id) || loaded.sourceFailed));
  const exporting = exportProgress !== null;
  const editable = status === 'document' && composition !== null && !sourceMissing && !busy && !exporting;
  const disabledReason =
    status === 'loading'
      ? 'Loading…'
      : status === 'empty'
        ? 'Add media first'
        : status === 'view'
          ? ffmpeg.state === 'checking'
            ? 'Looking for FFmpeg…'
            : 'Video editing needs FFmpeg'
          : sourceMissing
            ? 'Source missing — replace it first'
            : exporting
              ? 'Exporting…'
              : busy
                ? 'Rendering…'
                : undefined;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  useEffect(() => window.xbot.events.on('studio:fullscreen', ({ on }) => setFullscreen(on)), []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-fullscreen', fullscreen);
  }, [fullscreen]);
  const toggleFullscreen = () => void window.xbot.studio.toggleFullscreen().then((result) => result.ok && setFullscreen(result.data));
  useEscapeLayer(fullscreen, toggleFullscreen);

  // A new document starts at the beginning, with nothing selected.
  const [shownDocument, setShownDocument] = useState(doc?.id);
  if (shownDocument !== doc?.id) {
    setShownDocument(doc?.id);
    setSelection(null);
    setPendingCrop(null);
    setTimelineZoom(1);
  }
  useEffect(() => seek(0), [doc?.id, seek]);

  const change = editor.change;
  const cropping = pendingCrop !== null;
  useEscapeLayer(cropping, () => setPendingCrop(null));

  const startCrop = () => {
    if (!composition) return;
    if (cropping) return setPendingCrop(null);
    pause();
    popovers.closeAll();
    setCropTime(clock.get());
    setPendingCrop({ crop: composition.crop, aspect: composition.cropAspect });
  };
  const applyCrop = useCallback(() => {
    if (!pendingCrop || !composition) return;
    change({ ...composition, crop: clampCrop(pendingCrop.crop, composition.source), cropAspect: pendingCrop.aspect });
    setPendingCrop(null);
  }, [pendingCrop, composition, change]);

  const changeVideo = useCallback(
    (video: VideoSettings, gesture?: string) => {
      if (composition) change({ ...composition, video }, gesture);
    },
    [composition, change],
  );

  const split = useCallback(() => {
    if (!composition?.video || !videoInfo || !editable) return;
    const next = splitAt(composition.video, clock.get(), videoInfo.durationMs);
    if (next === composition.video) setNotice('Move the playhead further into the clip to split it.');
    else changeVideo(next);
  }, [composition, videoInfo, editable, clock, changeVideo, setNotice]);

  const jumpClip = (direction: -1 | 1) => {
    const video = composition?.video;
    if (!video) return;
    const now = clock.get();
    const starts = video.clips.map((_, index) => clipStartTime(video, index)).concat(timelineDuration(video));
    const target = direction < 0 ? [...starts].reverse().find((t) => t < now - 250) ?? 0 : (starts.find((t) => t > now + 1) ?? timelineDuration(video));
    seek(target);
  };

  // Keys: ⌘Z / ⇧⌘Z undo and redo; Space plays; S splits; ⌘+ / ⌘− zoom the timeline; Enter applies a crop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTextField(event.target)) return;
      if (event.key === 'Enter' && cropping) {
        event.preventDefault();
        applyCrop();
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && !event.altKey && editable) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) editor.undo();
        else if ((key === 'z' && event.shiftKey) || key === 'y') editor.redo();
        else if (isVideo && (key === '=' || key === '+')) setTimelineZoom((z) => Math.min(12, z * 1.5));
        else if (isVideo && key === '-') setTimelineZoom((z) => Math.max(1, z / 1.5));
        else return;
        event.preventDefault();
        return;
      }
      if (command || event.altKey || !isVideo) return;
      if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        togglePlay();
      } else if (event.key.toLowerCase() === 's' && editable) {
        event.preventDefault();
        split();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, editable, cropping, applyCrop, isVideo, togglePlay, split]);

  const out = composition ? outputSize(composition) : null;
  // Fitted, never above 100 %: a small screenshot previews pixel for pixel.
  const displayScale = area && out ? Math.min(1, (area.width - 32) / out.width, (area.height - 32) / out.height) : 0;

  const pickBackground = async () => {
    if (!composition) return;
    const result = await window.xbot.studio.pickMedia('background');
    if (!result.ok) return setError(result.error.message);
    if (!result.data) return;
    const { id } = result.data;
    editor.addMedia(result.data);
    editor.update((current) => ({
      ...current,
      background: { type: 'image', mediaId: id, blur: 0, brightness: current.background.type === 'transparent' ? 0.5 : current.background.brightness },
    }));
  };

  const pickDesktopPicture = async () => {
    if (!composition) return;
    const result = await window.xbot.studio.desktopWallpaper();
    if (!result.ok) return setError(result.error.message);
    const { id } = result.data;
    editor.addMedia(result.data);
    editor.update((current) => ({
      ...current,
      background: { type: 'image', mediaId: id, blur: 0, brightness: current.background.type === 'transparent' ? 0.5 : current.background.brightness },
    }));
  };

  const replaceSourceImage = async () => {
    const result = await window.xbot.studio.pickMedia('source');
    if (!result.ok) return setError(result.error.message);
    if (!result.data) return;
    const { id, width, height } = result.data;
    if (!width || !height) return setError('That image has no readable size.');
    editor.addMedia(result.data);
    setError(null);
    editor.update((current) => replaceSource(current, { mediaId: id, width, height }));
  };

  const openMedia = async () => {
    const result = await window.xbot.studio.pick();
    if (!result.ok) return setError(result.error.message);
    if (result.data) editor.openSession(result.data);
  };

  const dropActive = useFileDrop(!busy && !exporting, (files) => {
    void window.xbot.studio.importFiles(files).then((result) => {
      if (!result.ok) return setError(result.error.message);
      editor.openSession(result.data.opened);
      if (result.data.ignored.length > 0) setNotice(result.data.ignored.map((file) => `${file.name}: ${file.message}`).join(' '));
    });
  });

  const applyPreset = (preset: StudioPreset) => {
    if (!composition) return;
    if (preset.background) editor.addMedia(preset.background);
    const style = composition.video && preset.style.background.type === 'transparent' ? { ...preset.style, background: composition.background } : preset.style;
    change(applyStyle(composition, style));
    popovers.close(PRESETS_POPOVER);
  };

  /** Streams `bytes` (or a video export) into a main-side export file and finishes it. */
  const runExport = async () => {
    if (!doc || !composition || busy || exporting) return;
    pause();
    setBusy(true);
    setError(null);
    const frozen = composition;
    const { destination } = exportSettings;
    let token: string | null = null;
    try {
      if (!isVideo && destination === 'post') {
        const result = await editor.afterSaves(async (documentId, revision): Promise<IpcResult<AddToPostResult>> => {
          const rendered = await renderComposition(frozen, assets, effectiveFormat(frozen, doc.gif));
          return window.xbot.studio.addToPost(documentId, revision, frozen, rendered.bytes);
        });
        if (!result.ok) return setError(result.error.message);
        popovers.closeAll();
        await backToPost();
        return;
      }

      const format = isVideo ? 'mp4' : effectiveFormat(frozen, doc.gif);
      const begun = await editor.afterSaves((documentId, revision): Promise<IpcResult<BeginExportResult>> => window.xbot.studio.beginExport(documentId, revision, frozen, format));
      if (!begun.ok) return setError(begun.error.message);
      token = begun.data.token;
      const exportToken = token;
      const write = async (position: number, bytes: Uint8Array) => {
        const written = await window.xbot.studio.writeExport(exportToken, position, bytes);
        if (!written.ok) throw new RenderError('render_failed', written.error.message);
      };

      if (isVideo && sourceItem) {
        const abort = new AbortController();
        exportAbort.current = abort;
        setExportProgress(0);
        await exportVideo({
          composition: frozen,
          assets,
          sourceUrl: sourceItem.url,
          camera: recording?.camera ?? null,
          resolution: destination === 'post' && exportSettings.resolution === '4k' ? '1080p' : exportSettings.resolution,
          fps: exportSettings.fps,
          write,
          onProgress: (value) => setExportProgress(value),
          signal: abort.signal,
        });
      } else {
        const rendered = await renderComposition(frozen, assets, effectiveFormat(frozen, doc.gif));
        await write(0, rendered.bytes);
      }

      const finished = await window.xbot.studio.finishExport(exportToken, destination);
      token = null;
      if (!finished.ok) return setError(finished.error.message);
      popovers.closeAll();
      if (finished.data.destination === 'post') await backToPost();
      else if (finished.data.path) setNotice(`Saved to ${finished.data.path.split('/').slice(-2).join('/')}`);
    } catch (err) {
      if (err instanceof RenderError) {
        if (err.code === 'export_canceled') setNotice(err.message);
        else setError(err.message);
      } else throw err;
    } finally {
      if (token) void window.xbot.studio.cancelExport(token);
      exportAbort.current = null;
      setExportProgress(null);
      setBusy(false);
    }
  };

  const deleteItems: MenuItem[] = [
    {
      id: 'close',
      label: 'Close this document',
      detail: 'It stays on your post; reopen it with Edit in Studio',
      onSelect: () => void window.xbot.studio.close().then((result) => (result.ok ? editor.clear() : setError(result.error.message))),
    },
  ];
  const moreItems: MenuItem[] = [
    { id: 'open', label: 'Open image or video…', disabled: busy, onSelect: () => void openMedia() },
    { id: 'replace', label: 'Replace source…', detail: isVideo ? 'Images only' : undefined, disabled: busy || status !== 'document' || isVideo, onSelect: () => void replaceSourceImage() },
  ];

  const canUndo = editable && (editor.history?.past.length ?? 0) > 0;
  const canRedo = editable && (editor.history?.future.length ?? 0) > 0;
  const exportDisabledReason =
    disabledReason && !exporting
      ? disabledReason
      : isVideo && ffmpeg.state !== 'ready' && ffmpeg.state !== 'checking'
        ? ffmpeg.message
        : !loaded.ready && !exporting
          ? 'Loading the image…'
          : undefined;

  const video = composition?.video;
  const selectedZoom = selection?.kind === 'zoom' && video ? video.zooms.find((z) => z.id === selection.id) : undefined;
  const selectedScene = selection?.kind === 'scene' && video ? video.scenes.find((s) => s.id === selection.id) : undefined;
  const contentAspect = composition ? (composition.crop.width * composition.source.width) / (composition.crop.height * composition.source.height) : 16 / 9;
  const focusFrame = useMemo(() => {
    if (!selectedZoom || !video || filmstrip.length === 0 || !videoInfo) return undefined;
    const { sourceMs } = sourceTimeAt(video, (selectedZoom.startMs + selectedZoom.endMs) / 2);
    return filmstrip[Math.min(filmstrip.length - 1, Math.floor((sourceMs / videoInfo.durationMs) * filmstrip.length))];
  }, [selectedZoom, video, filmstrip, videoInfo]);

  const onSelect = (next: TimelineSelection, anchor?: HTMLElement) => {
    setSelection(next);
    if (next?.kind === 'zoom') {
      if (anchor) zoomAnchor.current = anchor;
      requestAnimationFrame(() => popovers.open(ZOOM_EDITOR));
    } else if (next?.kind === 'scene') {
      if (anchor) zoomAnchor.current = anchor;
      requestAnimationFrame(() => popovers.open(SCENE_EDITOR));
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY;
    const start = timelineHeight;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => setTimelineHeight(Math.min(window.innerHeight - 360, Math.max(MIN_TIMELINE, start - (e.clientY - startY))));
    const stop = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', stop);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', stop);
  };

  const stage = (
    <div ref={stageArea} className={`stage${dropActive ? ' stage-drop' : ''}`} data-testid="studio-canvas">
      {status === 'document' && composition && !sourceMissing && (
        <>
          {cropping && pendingCrop && sourceItem ? (
            <CropOverlay
              overlayRef={cropOverlay}
              url={sourceItem.url}
              source={composition.source}
              crop={pendingCrop.crop}
              ratio={cropAspectRatio(pendingCrop.aspect, composition.source)}
              onChange={(crop) => setPendingCrop((current) => current && { ...current, crop })}
              videoTime={video ? sourceTimeAt(video, cropTime).sourceMs / 1000 : undefined}
            />
          ) : (
            displayScale > 0 && (
              <CompositionCanvas
                composition={composition}
                assets={assets}
                assetsReady={loaded.ready}
                displayScale={displayScale}
                quality={quality === 'half' ? 0.5 : 1}
                video={isVideo ? { element: videoElement, clock, camera: cameraElement } : undefined}
                testId="studio-preview-canvas"
              />
            )
          )}
          {isVideo && sourceItem && (
            <video ref={videoRef} className="stage-source" src={sourceItem.url} preload="auto" playsInline crossOrigin="anonymous" data-testid="studio-video" />
          )}
          {isVideo && recording?.camera && (
            <video ref={cameraRef} className="stage-source" src={recording.camera.url} preload="auto" playsInline muted crossOrigin="anonymous" data-testid="studio-camera" />
          )}
        </>
      )}
      {status === 'document' && sourceMissing && (
        <div className="studio-empty" data-testid="studio-source-missing">
          <p>Source missing — {isVideo ? 'add the video again from Write Post.' : 'replace it to keep editing.'}</p>
          {!isVideo && (
            <GhostButton className="studio-empty-action" disabled={busy} onClick={() => void replaceSourceImage()}>
              Replace…
            </GhostButton>
          )}
        </div>
      )}
      {status === 'empty' && (
        <div className="studio-empty" data-testid="studio-empty">
          <p>Drop a screenshot or video here</p>
          <FrostedButton className="studio-empty-action" onClick={() => void openMedia()} data-testid="studio-choose">
            Choose image or video…
          </FrostedButton>
        </div>
      )}
      {status === 'view' && editor.view && (
        <>
          <video className="studio-target" src={editor.view.media.url} poster={editor.view.media.thumbUrl ?? undefined} controls muted playsInline data-testid="studio-target" />
          {ffmpeg.state !== 'ready' && (
            <div className="studio-ffmpeg">
              <FfmpegCard status={ffmpeg} />
            </div>
          )}
        </>
      )}
      {(error || notice || videoInfo?.hdr) && (
        <div className="studio-toast" role={error ? 'alert' : 'status'} data-testid={error ? 'studio-error' : notice ? 'studio-notice' : 'studio-hdr'}>
          <StatusChip tone={error ? 'warning' : 'neutral'}>{error ?? notice ?? 'HDR video: colours in the export will be off'}</StatusChip>
        </div>
      )}
    </div>
  );

  const cropBar = composition && pendingCrop && (
    <div className="crop-bar" data-testid="popover-crop">
      <Segmented<CropAspect>
        label="Aspect ratio"
        options={[
          { value: 'free', label: 'Free' },
          { value: 'original', label: 'Original' },
          { value: '16:9', label: '16:9' },
          { value: '1:1', label: '1:1' },
          { value: '4:5', label: '4:5' },
        ]}
        value={pendingCrop.aspect}
        onChange={(aspect) => setPendingCrop({ aspect, crop: fitAspect(pendingCrop.crop, cropAspectRatio(aspect, composition.source), composition.source) })}
        testId="crop-aspect"
      />
      <span className="preview-toolbar-spacer" />
      <GhostButton onClick={() => setPendingCrop({ aspect: 'original', crop: { x: 0, y: 0, width: 1, height: 1 } })} data-testid="crop-reset">
        Reset
      </GhostButton>
      <GhostButton onClick={() => setPendingCrop(null)} data-testid="crop-cancel">
        Cancel
      </GhostButton>
      <FrostedButton onClick={applyCrop} data-testid="crop-apply">
        Apply
      </FrostedButton>
    </div>
  );

  return (
    <GlassPanel
      className={`studio${isVideo ? ' studio-has-timeline' : ''}`}
      data-testid="studio-panel"
      data-document-id={doc?.id}
      data-revision={doc ? editor.revision : undefined}
      style={{ '--timeline-height': `${timelineHeight}px` } as React.CSSProperties}
    >
      <TopBar
        name={doc?.source.name ?? null}
        badge={preview ? 'Preview' : undefined}
        onClose={() => void backToPost()}
        onMinimize={() => void window.xbot.windows.minimize()}
        onFullscreen={toggleFullscreen}
        onDelete={doc ? () => popovers.toggle(DELETE_MENU) : undefined}
        onReveal={doc ? () => void window.xbot.studio.reveal(doc.id) : undefined}
        presetsAnchor={presetsAnchor}
        exportAnchor={exportAnchor}
        deleteAnchor={deleteAnchor}
        nameAnchor={nameAnchor}
        onName={() => popovers.toggle(FILE_MENU)}
        onPresets={editable ? () => popovers.toggle(PRESETS_POPOVER) : undefined}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onBack={() => void backToPost()}
        onExport={() => popovers.toggle(EXPORT_DIALOG)}
        exportDisabledReason={exportDisabledReason}
        exportLabel={exporting ? `Exporting ${Math.round((exportProgress ?? 0) * 100)}%` : busy ? 'Rendering…' : 'Export'}
        disabledReason={disabledReason}
      />

      <div className="studio-main">
        <PreviewPanel
          aspect={composition?.canvas.ratio ?? 'original'}
          onAspect={(ratio: CanvasRatio) => composition && change({ ...composition, canvas: { ...composition.canvas, ratio } })}
          onCustom={() => {
            if (composition) change({ ...composition, canvas: { ...composition.canvas, ratio: 'custom' } });
            requestAnimationFrame(() => popovers.open(SIZE_POPOVER));
          }}
          aspectAnchor={aspectAnchor}
          frameAnchor={frameAnchor}
          qualityAnchor={qualityAnchor}
          quality={quality}
          onQuality={setQuality}
          cropping={cropping}
          onCrop={startCrop}
          disabled={!editable}
          stage={stage}
          transport={
            cropping
              ? cropBar
              : isVideo &&
                video && (
                  <Transport
                    clock={clock}
                    totalMs={timelineDuration(video)}
                    playing={playing}
                    onToggle={togglePlay}
                    onPrevious={() => jumpClip(-1)}
                    onNext={() => jumpClip(1)}
                    onSplit={split}
                    zoom={timelineZoom}
                    onZoom={setTimelineZoom}
                  />
                )
          }
        />
        <Sidebar
          composition={composition ?? undefined}
          onChange={change}
          onCommit={editor.endGesture}
          disabledReason={editable ? undefined : disabledReason}
          hasAudio={hasAudio}
          onPickImage={() => void pickBackground()}
          onDesktop={() => void pickDesktopPicture()}
        />
      </div>

      {isVideo && video && videoInfo && (
        <>
          <div className="timeline-resize" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" onPointerDown={startResize} />
          <Timeline
            video={video}
            sourceDurationMs={videoInfo.durationMs}
            clock={clock}
            zoom={timelineZoom}
            onSeek={seek}
            onChange={changeVideo}
            onCommit={editor.endGesture}
            selection={selection}
            onSelect={onSelect}
            onSplit={split}
            hasCamera={composition?.camera !== undefined}
            zoomAnchor={zoomAnchor}
          />
        </>
      )}

      <Menu id={DELETE_MENU} anchor={deleteAnchor} label="Delete" placement="bottom-start" items={deleteItems} />
      <Menu id={FILE_MENU} anchor={nameAnchor} label="File" placement="bottom-start" items={moreItems} testId="studio-more-menu" />
      {composition && (
        <>
          <SizePopover anchor={aspectAnchor} composition={composition} onChange={(next) => change(next)} />
          <FramePopover anchor={frameAnchor} composition={composition} onChange={change} onCommit={editor.endGesture} />
          <PresetsPopover anchor={presetsAnchor} onApply={applyPreset} onError={setError} currentStyle={styleOf(composition)} />
          <ExportDialog
            anchor={exportAnchor}
            composition={composition}
            gif={doc?.gif ?? false}
            settings={exportSettings}
            onSettings={setExportSettings}
            onChange={(next) => change(next)}
            onExport={() => void runExport()}
            progress={exportProgress}
            onCancel={() => exportAbort.current?.abort()}
          />
        </>
      )}
      {selectedZoom && video && (
        <ZoomEditor
          anchor={zoomAnchor}
          segment={selectedZoom}
          aspect={contentAspect}
          frameUrl={focusFrame}
          autoAvailable={false}
          onChange={(segment, gesture) => changeVideo({ ...video, zooms: video.zooms.map((z) => (z.id === segment.id ? segment : z)) }, gesture)}
          onCommit={editor.endGesture}
          onDelete={() => {
            changeVideo({ ...video, zooms: video.zooms.filter((z) => z.id !== selectedZoom.id) });
            setSelection(null);
            popovers.close(ZOOM_EDITOR);
          }}
        />
      )}
      {selectedScene && video && (
        <SceneEditor
          anchor={zoomAnchor}
          segment={selectedScene}
          onChange={(segment) => changeVideo({ ...video, scenes: video.scenes.map((s) => (s.id === segment.id ? segment : s)) })}
          onDelete={() => {
            changeVideo({ ...video, scenes: video.scenes.filter((s) => s.id !== selectedScene.id) });
            setSelection(null);
            popovers.close(SCENE_EDITOR);
          }}
        />
      )}
    </GlassPanel>
  );
}
