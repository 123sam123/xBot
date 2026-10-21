import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CompositionPreview } from '../common/CompositionPreview';
import { DEFAULT_COMPOSITION, type PreviewComposition } from '../common/previewComposition';
import { useAppInfo, useReadyMarker } from '../common/useAppInfo';
import { useEscapeToHide } from '../common/useEscapeToHide';
import { useSettings } from '../common/useSettings';
import { CropIcon, FrameIcon, GlassPanel, ImageIcon, PaddingIcon, popovers, ShadowIcon, StatusChip, useAppearance } from '../design-system';
import { PREVIEW_CLIP, PREVIEW_OUTPUT, PREVIEW_SOURCE, PREVIEW_ZOOM } from '../preview/fixtures';
import { StudioFooter, type FitMode } from './StudioFooter';
import { StudioToolbar, type ToolbarItem } from './StudioToolbar';
import { StudioTopBar } from './StudioTopBar';
import { Timeline } from './Timeline';
import { toolPopoverId, ToolPopovers, type ToolId } from './ToolPopovers';

// Media Studio. The composition and the clip are preview-local state here;
// T4 (XBOT-1N58PP) supplies real media and the shared composition model, and
// T5 (XBOT-G66JJK) real video, trim and export.

const NOTICE_MS = 3200;
const FILL_SCALE = 1.25;

async function backToPost() {
  await window.xbot.windows.hide();
  await window.xbot.windows.showComposer();
}

/** The toolbar item whose popover is open, if any. */
function useOpenTool(tools: readonly ToolId[]): ToolId | null {
  const current = useSyncExternalStore(popovers.subscribe, popovers.current);
  return tools.find((tool) => toolPopoverId(tool) === current) ?? null;
}

export function App() {
  const { info, ready: infoReady } = useAppInfo();
  const { values: settings, ready: settingsReady } = useSettings();

  useEscapeToHide();
  useAppearance(settings?.['ui.reduceTransparency'] ?? false, settings?.['ui.increaseContrast'] ?? false);
  useReadyMarker(infoReady && settingsReady);

  const preview = info?.isPreview ?? false;
  return (
    <GlassPanel className="studio" data-testid="studio-panel">
      {infoReady && <Studio key={preview ? 'preview' : 'normal'} preview={preview} />}
    </GlassPanel>
  );
}

function Studio({ preview }: { preview: boolean }) {
  const anchors = {
    background: useRef<HTMLButtonElement>(null),
    frame: useRef<HTMLButtonElement>(null),
    padding: useRef<HTMLButtonElement>(null),
    shadow: useRef<HTMLButtonElement>(null),
    crop: useRef<HTMLButtonElement>(null),
  };
  const tools: ToolbarItem<ToolId>[] = [
    { id: 'background', label: 'Background', icon: <ImageIcon size={24} strokeWidth={1.6} />, anchor: anchors.background },
    { id: 'frame', label: 'Frame', icon: <FrameIcon size={24} strokeWidth={1.6} />, anchor: anchors.frame },
    { id: 'padding', label: 'Padding', icon: <PaddingIcon size={24} strokeWidth={1.6} />, anchor: anchors.padding },
    { id: 'shadow', label: 'Shadow', icon: <ShadowIcon size={24} strokeWidth={1.6} />, anchor: anchors.shadow },
    { id: 'crop', label: 'Crop', icon: <CropIcon size={24} strokeWidth={1.6} />, anchor: anchors.crop },
  ].map((tool) => ({ ...tool, id: tool.id as ToolId, disabled: !preview }));
  const openTool = useOpenTool(tools.map((tool) => tool.id));

  const [composition, setComposition] = useState<PreviewComposition>(DEFAULT_COMPOSITION);
  const [fit, setFit] = useState<FitMode>('fit');
  const [zoom, setZoom] = useState(PREVIEW_ZOOM);
  const [current, setCurrent] = useState(PREVIEW_CLIP.current);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    <>
      <StudioTopBar
        onBack={() => void backToPost()}
        onAdd={() => setNotice('Preview sample: nothing is attached')}
        addDisabledReason={preview ? undefined : 'Add media first'}
        badge={preview ? 'Preview' : undefined}
        notice={notice && <StatusChip>{notice}</StatusChip>}
      />
      <div className="studio-canvas" data-testid="studio-canvas">
        {preview ? (
          <CompositionPreview
            composition={composition}
            source={PREVIEW_SOURCE}
            zoom={(zoom / PREVIEW_ZOOM) * (fit === 'fill' ? FILL_SCALE : 1)}
            className="studio-composition"
            testId="studio-composition"
          />
        ) : (
          <p className="studio-empty">No media yet</p>
        )}
      </div>
      <div className="studio-toolbar-row">
        <StudioToolbar
          items={tools}
          active={openTool}
          onSelect={(tool) => popovers.toggle(toolPopoverId(tool))}
          disabledReason="Add media first"
        />
      </div>
      {preview && (
        <Timeline
          duration={PREVIEW_CLIP.duration}
          current={current}
          trim={PREVIEW_CLIP.trim}
          frames={PREVIEW_CLIP.frames}
          playing={playing}
          onTogglePlay={() => setPlaying((value) => !value)}
          label="Sample clip timeline"
        />
      )}
      <StudioFooter
        dimensions={preview ? PREVIEW_OUTPUT : null}
        fit={fit}
        zoom={zoom}
        onFit={preview ? setFit : undefined}
        onZoom={preview ? setZoom : undefined}
      />
      <ToolPopovers anchors={anchors} composition={composition} onChange={(patch) => setComposition((c) => ({ ...c, ...patch }))} />
    </>
  );
}
