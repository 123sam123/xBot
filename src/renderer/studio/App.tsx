import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  applyStyle,
  clampCrop,
  cropAspectRatio,
  effectiveFormat,
  outputSize,
  replaceSource,
  resetStyle,
  styleOf,
  type Composition,
  type CropAspect,
  type Rect,
} from '../../shared/composition/model';
import { computeLayout } from '../../shared/composition/layout';
import type { IpcResult } from '../../shared/contracts/ipc';
import type { AddToPostResult, StudioPreset } from '../../shared/contracts/studio';
import { CompositionCanvas } from '../common/composition/CompositionCanvas';
import type { CompositionAssets } from '../common/composition/draw';
import { renderComposition, RenderError } from '../common/composition/render';
import '../common/composition/composition.css';
import { useAppInfo, useReadyMarker } from '../common/useAppInfo';
import { useEscapeToHide } from '../common/useEscapeToHide';
import { useFileDrop } from '../common/useFileDrop';
import { useSettings } from '../common/useSettings';
import {
  CropIcon,
  FrameIcon,
  FrostedButton,
  GhostButton,
  GlassPanel,
  IconButton,
  ImageIcon,
  Menu,
  MoreIcon,
  PaddingIcon,
  popovers,
  RedoIcon,
  ShadowIcon,
  StatusChip,
  UndoIcon,
  useAppearance,
  useEscapeLayer,
  type MenuItem,
} from '../design-system';
import { PREVIEW_CLIP } from '../preview/fixtures';
import { fitAspect } from './crop';
import { CropOverlay } from './CropOverlay';
import { OUTPUT_POPOVER, OutputPopover } from './OutputPopover';
import { PRESETS_POPOVER, PresetsPopover } from './PresetsPopover';
import { StudioFooter, type FitMode } from './StudioFooter';
import { StudioToolbar, type ToolbarItem } from './StudioToolbar';
import { StudioTopBar } from './StudioTopBar';
import { Timeline } from './Timeline';
import { toolPopoverId, ToolPopovers, type ToolId } from './ToolPopovers';
import { useCompositionAssets } from './useCompositionAssets';
import { useStudioEditor } from './useStudioEditor';

// Media Studio: a non-destructive editor for one screenshot at a time. The
// preview and the export draw the same Composition with the same routine
// (common/composition); main stores documents, exports and presets (T4,
// XBOT-1N58PP). Video stays read-only until T5 (XBOT-G66JJK). Preview mode
// edits the sample locally and keeps T2's sample timeline.

const NOTICE_MS = 3200;

const TOOLS: { id: ToolId; label: string; icon: React.ReactNode }[] = [
  { id: 'background', label: 'Background', icon: <ImageIcon size={24} strokeWidth={1.6} /> },
  { id: 'frame', label: 'Frame', icon: <FrameIcon size={24} strokeWidth={1.6} /> },
  { id: 'padding', label: 'Padding', icon: <PaddingIcon size={24} strokeWidth={1.6} /> },
  { id: 'shadow', label: 'Shadow', icon: <ShadowIcon size={24} strokeWidth={1.6} /> },
  { id: 'crop', label: 'Crop', icon: <CropIcon size={24} strokeWidth={1.6} /> },
];
const TOOL_IDS = TOOLS.map((tool) => tool.id);
const MORE_MENU = 'studio-more';
const NOT_IN_PREVIEW = 'Not available in preview';

async function backToPost() {
  await window.xbot.windows.hide();
  await window.xbot.windows.showComposer();
}

/** The toolbar item whose popover is open, if any. */
function useOpenTool(tools: readonly ToolId[]): ToolId | null {
  const current = useSyncExternalStore(popovers.subscribe, popovers.current);
  return tools.find((tool) => toolPopoverId(tool) === current) ?? null;
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
  useAppearance(settings?.['ui.reduceTransparency'] ?? false, settings?.['ui.increaseContrast'] ?? false);

  const preview = info?.isPreview ?? false;
  return infoReady ? (
    <Studio key={preview ? 'preview' : 'normal'} preview={preview} settingsReady={settingsReady} />
  ) : (
    <GlassPanel className="studio" data-testid="studio-panel" />
  );
}

function Studio({ preview, settingsReady }: { preview: boolean; settingsReady: boolean }) {
  const editor = useStudioEditor(preview);
  const { composition, document: doc, status } = editor;
  const loaded = useCompositionAssets(composition, editor.media, editor.history);
  useReadyMarker(settingsReady && status !== 'loading');

  const anchors = {
    background: useRef<HTMLButtonElement>(null),
    frame: useRef<HTMLButtonElement>(null),
    padding: useRef<HTMLButtonElement>(null),
    shadow: useRef<HTMLButtonElement>(null),
    crop: useRef<HTMLButtonElement>(null),
  };
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const dimsAnchor = useRef<HTMLButtonElement>(null);
  const canvasArea = useRef<HTMLDivElement>(null);
  const cropOverlay = useRef<HTMLDivElement>(null);
  const area = useElementSize(canvasArea);

  const [fit, setFit] = useState<FitMode | null>('fit');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<{ crop: Rect; aspect: CropAspect } | null>(null);
  const { notice, setNotice, error, setError } = editor;

  const sourceItem = composition ? editor.media.get(composition.source.mediaId) : undefined;
  const sourceMissing = Boolean(composition && doc && ((doc.sourceMissing && composition.source.mediaId === doc.source.id) || loaded.sourceFailed));
  const editable = status === 'document' && composition !== null && !sourceMissing && !busy;
  const disabledReason =
    status === 'loading'
      ? 'Loading…'
      : status === 'empty'
        ? 'Add media first'
        : status === 'view'
          ? 'Video editing arrives with video export'
          : sourceMissing
            ? 'Source missing — replace it first'
            : busy
              ? 'Rendering…'
              : undefined;

  const tools: ToolbarItem<ToolId>[] = TOOLS.map((tool) => ({ ...tool, anchor: anchors[tool.id], disabled: !editable }));
  const openTool = useOpenTool(TOOL_IDS);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  useEffect(() => window.xbot.events.on('studio:fullscreen', ({ on }) => setFullscreen(on)), []);
  useEscapeLayer(fullscreen, () => void window.xbot.studio.toggleFullscreen().then((result) => result.ok && setFullscreen(result.data)));

  // Crop mode lasts while the Crop popover is open; closing it any other way than Apply discards the edit.
  const cropping = openTool === 'crop' && pendingCrop !== null;
  const selectTool = (tool: ToolId) => {
    if (tool === 'crop' && openTool !== 'crop' && composition) setPendingCrop({ crop: composition.crop, aspect: composition.cropAspect });
    popovers.toggle(toolPopoverId(tool));
  };

  const change = editor.change;
  const applyCrop = useCallback(() => {
    if (!cropping || !pendingCrop || !composition) return;
    change({ ...composition, crop: clampCrop(pendingCrop.crop, composition.source), cropAspect: pendingCrop.aspect });
    popovers.close(toolPopoverId('crop'));
  }, [cropping, pendingCrop, composition, change]);

  // ⌘Z / ⇧⌘Z / ⌘Y outside text fields (their own undo stays native), and Enter applies a crop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Enter' && cropping && !isTextField(event.target)) {
        event.preventDefault();
        applyCrop();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || isTextField(event.target) || !editable) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) editor.undo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') editor.redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, editable, cropping, applyCrop]);

  const out = composition ? outputSize(composition) : null;
  const fitScale = area && out ? (fit === 'fill' ? Math.max : Math.min)(area.width / out.width, area.height / out.height) : 0;
  const displayScale = fit ? fitScale : zoomLevel / 100;

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

  const openImage = async () => {
    const result = await window.xbot.studio.pick();
    if (!result.ok) return setError(result.error.message);
    if (result.data) editor.open(result.data);
  };

  const dropActive = useFileDrop(!preview && !busy, (files) => {
    void window.xbot.studio.importFiles(files).then((result) => {
      if (!result.ok) return setError(result.error.message);
      editor.open(result.data.document);
      if (result.data.ignored.length > 0) setNotice(result.data.ignored.map((file) => `${file.name}: ${file.message}`).join(' '));
    });
  });

  const applyPreset = (preset: StudioPreset) => {
    if (!composition) return;
    if (preset.background) editor.addMedia(preset.background);
    change(applyStyle(composition, preset.style));
    popovers.close(PRESETS_POPOVER);
  };

  const addToPost = async () => {
    if (preview) {
      setNotice('Preview sample: nothing is attached');
      return;
    }
    if (!doc || !composition || busy) return;
    popovers.closeAll();
    setBusy(true);
    setError(null);
    try {
      const frozen = composition;
      const assets: CompositionAssets = loaded.assets;
      const result = await editor.afterSaves(async (documentId, revision): Promise<IpcResult<AddToPostResult>> => {
        try {
          const rendered = await renderComposition(frozen, assets, effectiveFormat(frozen, doc.gif));
          return await window.xbot.studio.addToPost(documentId, revision, frozen, rendered.bytes);
        } catch (err) {
          if (err instanceof RenderError) return { ok: false, error: { code: err.code, message: err.message } };
          throw err;
        }
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await backToPost();
    } finally {
      setBusy(false);
    }
  };

  const menuItems: MenuItem[] = [
    { id: 'reset', label: 'Reset style', disabled: !editable, onSelect: () => composition && change(resetStyle(composition)) },
    {
      id: 'presets',
      label: 'Presets…',
      detail: preview ? NOT_IN_PREVIEW : undefined,
      disabled: preview || !editable,
      onSelect: () => popovers.open(PRESETS_POPOVER),
    },
    { id: 'open', label: 'Open image…', detail: preview ? NOT_IN_PREVIEW : undefined, disabled: preview || busy, onSelect: () => void openImage() },
    {
      id: 'replace',
      label: 'Replace source…',
      detail: preview ? NOT_IN_PREVIEW : undefined,
      disabled: preview || busy || status !== 'document',
      onSelect: () => void replaceSourceImage(),
    },
  ];

  const canUndo = editable && (editor.history?.past.length ?? 0) > 0;
  const canRedo = editable && (editor.history?.future.length ?? 0) > 0;
  const addDisabledReason = preview
    ? undefined
    : (disabledReason ?? (!loaded.ready ? 'Loading the image…' : undefined));

  const cropControls = {
    aspect: pendingCrop?.aspect ?? composition?.cropAspect ?? 'original',
    onAspect: (aspect: CropAspect) => {
      if (!pendingCrop || !composition) return;
      setPendingCrop({ aspect, crop: fitAspect(pendingCrop.crop, cropAspectRatio(aspect, composition.source), composition.source) });
    },
    onReset: () => composition && setPendingCrop({ aspect: 'original', crop: { x: 0, y: 0, width: 1, height: 1 } }),
    onCancel: () => popovers.close(toolPopoverId('crop')),
    onApply: applyCrop,
    overlay: cropOverlay,
  };

  // The footer shows exactly the export's pixels at the chosen scale.
  const exportSize = composition ? computeLayout(composition, { scale: composition.output.scale }).canvas : null;

  return (
    <GlassPanel className="studio" data-testid="studio-panel" data-document-id={doc?.id} data-revision={doc ? editor.revision : undefined}>
      <StudioTopBar
        onBack={() => void backToPost()}
        onAdd={() => void addToPost()}
        addDisabledReason={addDisabledReason}
        addLabel={busy ? 'Rendering…' : undefined}
        badge={preview ? 'Preview' : undefined}
        actions={
          <span className="studio-actions">
            <IconButton label="Undo" size="sm" bare disabled={!canUndo} onClick={editor.undo} data-testid="studio-undo">
              <UndoIcon size={20} />
            </IconButton>
            <IconButton label="Redo" size="sm" bare disabled={!canRedo} onClick={editor.redo} data-testid="studio-redo">
              <RedoIcon size={20} />
            </IconButton>
            <IconButton ref={moreAnchor} label="More" size="sm" bare aria-haspopup="menu" onClick={() => popovers.toggle(MORE_MENU)} data-testid="studio-more">
              <MoreIcon size={20} />
            </IconButton>
          </span>
        }
      />
      <div ref={canvasArea} className={['studio-canvas', dropActive && 'studio-canvas-drop'].filter(Boolean).join(' ')} data-testid="studio-canvas">
        {status === 'document' && composition && !sourceMissing && (
          cropping && pendingCrop && sourceItem ? (
            <CropOverlay
              overlayRef={cropOverlay}
              url={sourceItem.url}
              source={composition.source}
              crop={pendingCrop.crop}
              ratio={cropAspectRatio(pendingCrop.aspect, composition.source)}
              onChange={(crop) => setPendingCrop((current) => current && { ...current, crop })}
            />
          ) : (
            <StudioViewport composition={composition} assets={loaded.assets} ready={loaded.ready} displayScale={displayScale} />
          )
        )}
        {status === 'document' && sourceMissing && (
          <div className="studio-empty" data-testid="studio-source-missing">
            <p>Source missing — replace it to keep editing.</p>
            <GhostButton className="studio-empty-action" disabled={busy} onClick={() => void replaceSourceImage()}>
              Replace…
            </GhostButton>
          </div>
        )}
        {status === 'empty' && (
          <div className="studio-empty" data-testid="studio-empty">
            <p>Drop a screenshot here</p>
            <FrostedButton className="studio-empty-action" onClick={() => void openImage()} data-testid="studio-choose">
              Choose image…
            </FrostedButton>
          </div>
        )}
        {status === 'view' && editor.view && (
          <video className="studio-target" src={editor.view.media.url} poster={editor.view.media.thumbUrl ?? undefined} controls muted playsInline data-testid="studio-target" />
        )}
        {(error || notice) && (
          <div className="studio-toast" role={error ? 'alert' : 'status'} data-testid={error ? 'studio-error' : 'studio-notice'}>
            <StatusChip tone={error ? 'warning' : 'neutral'}>{error ?? notice}</StatusChip>
          </div>
        )}
      </div>
      <div className="studio-toolbar-row">
        <StudioToolbar
          items={tools}
          active={openTool}
          onSelect={selectTool}
          disabledReason={disabledReason}
        />
      </div>
      {preview && <PreviewTimeline />}
      <StudioFooter
        dimensions={exportSize}
        fit={fit}
        zoom={displayScale > 0 ? Math.round(displayScale * 100) : 100}
        onFit={composition ? (mode) => setFit(mode) : undefined}
        onZoom={
          composition
            ? (level) => {
                setFit(null);
                setZoomLevel(level);
              }
            : undefined
        }
        dimsAnchor={dimsAnchor}
        onDimensions={editable ? () => popovers.toggle(OUTPUT_POPOVER) : undefined}
        fullscreen={fullscreen}
        onFullscreen={() => void window.xbot.studio.toggleFullscreen().then((result) => result.ok && setFullscreen(result.data))}
      />

      <Menu id={MORE_MENU} anchor={moreAnchor} label="More" placement="bottom-end" items={menuItems} testId="studio-more-menu" />
      {composition && (
        <>
          <ToolPopovers
            anchors={anchors}
            composition={composition}
            onChange={change}
            onCommit={editor.endGesture}
            onPickBackground={() => void pickBackground()}
            pickDisabledReason={preview ? NOT_IN_PREVIEW : undefined}
            crop={cropControls}
          />
          <OutputPopover anchor={dimsAnchor} composition={composition} gif={doc?.gif ?? false} onChange={(next) => change(next)} />
          <PresetsPopover anchor={moreAnchor} onApply={applyPreset} onError={setError} currentStyle={styleOf(composition)} />
        </>
      )}
    </GlassPanel>
  );
}

/** The canvas area: the composition at `displayScale`, centred, scrolling when it is larger than the area. */
function StudioViewport({ composition, assets, ready, displayScale }: { composition: Composition; assets: CompositionAssets; ready: boolean; displayScale: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [displayScale]);
  return (
    <div ref={viewport} className="studio-viewport">
      <div className="studio-viewport-inner">
        {displayScale > 0 && <CompositionCanvas composition={composition} assets={assets} assetsReady={ready} displayScale={displayScale} testId="studio-preview-canvas" />}
      </div>
    </div>
  );
}

/** T2's sample clip, preview mode only; T5 (XBOT-G66JJK) brings real video. */
function PreviewTimeline() {
  const [current, setCurrent] = useState(PREVIEW_CLIP.current);
  const [playing, setPlaying] = useState(false);
  // Plays the sample clip's playhead through the trim range, looping.
  useEffect(() => {
    if (!playing) return;
    const start = PREVIEW_CLIP.trim[0] * PREVIEW_CLIP.duration;
    const end = PREVIEW_CLIP.trim[1] * PREVIEW_CLIP.duration;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = (now - last) / 1000;
      last = now;
      setCurrent((time) => (time + elapsed >= end || time < start ? start : time + elapsed));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  return (
    <Timeline
      duration={PREVIEW_CLIP.duration}
      current={current}
      trim={PREVIEW_CLIP.trim}
      frames={PREVIEW_CLIP.frames}
      playing={playing}
      onTogglePlay={() => setPlaying((value) => !value)}
      label="Sample clip timeline"
    />
  );
}

