import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CaptureRect, CaptureSource, CaptureTarget, RecorderSetup } from '../../shared/contracts/recordings';
import {
  AppMark,
  AreaIcon,
  CameraIcon,
  ChevronDownIcon,
  CloseIcon,
  GlassPanel,
  IconButton,
  Menu,
  MicIcon,
  MonitorIcon,
  popovers,
  SpeakerIcon,
  Toggle,
  WindowIcon,
  type MenuItem,
} from '../design-system';
import { useRecordingState } from './App';

// The "New recording" panel, as in Cap: what to record (a display, a window or
// an area), the camera and microphone, system audio, and Start. It shows the
// 3-2-1 countdown, then main hides it and the stop bar takes over.

type Mode = 'display' | 'window' | 'area';

const CAMERA_MENU = 'recorder-camera';
const MIC_MENU = 'recorder-mic';

interface Camera {
  deviceId: string;
  label: string;
}

async function listCameras(ask: boolean): Promise<Camera[]> {
  if (ask) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      return [];
    }
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function Panel() {
  const state = useRecordingState();
  const [setup, setSetup] = useState<RecorderSetup | null>(null);
  const [mode, setMode] = useState<Mode>('display');
  const [displayId, setDisplayId] = useState<number | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [area, setArea] = useState<CaptureRect | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [micId, setMicId] = useState<string | null>(null);
  const [systemAudio, setSystemAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraAnchor = useRef<HTMLButtonElement>(null);
  const micAnchor = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const result = await window.xbot.recordings.setup();
    if (!result.ok) return setError(result.error.message);
    setSetup(result.data);
    setDisplayId((current) => current ?? result.data.displays[0]?.id ?? null);
  }, []);

  // Fresh sources each time the panel shows.
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => {
    void listCameras(false).then(setCameras);
  }, []);

  const close = () => {
    setCameraId(null);
    void window.xbot.recordings.closePanel();
  };

  const chooseCamera = (deviceId: string | null) => {
    setCameraId(deviceId);
    void window.xbot.recordings.setCamera(deviceId);
  };

  const pickArea = async () => {
    if (displayId === null) return;
    const result = await window.xbot.recordings.pickArea(displayId);
    if (result.ok && result.data) setArea(result.data);
  };

  const target: CaptureTarget | null =
    mode === 'window'
      ? windowId !== null
        ? { kind: 'window', windowId }
        : null
      : displayId === null
        ? null
        : mode === 'area'
          ? area
            ? { kind: 'area', displayId, rect: area }
            : null
          : { kind: 'display', displayId };

  const start = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    const result = await window.xbot.recordings.start({ target, cameraId, microphoneId: micId, systemAudio });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
  };

  const cameraItems: MenuItem[] = [
    { id: 'none', label: 'No camera', checked: cameraId === null, onSelect: () => chooseCamera(null) },
    ...cameras.map((camera) => ({ id: camera.deviceId, label: camera.label, checked: cameraId === camera.deviceId, onSelect: () => chooseCamera(camera.deviceId) })),
  ];
  const micItems: MenuItem[] = [
    { id: 'none', label: 'No microphone', checked: micId === null, onSelect: () => setMicId(null) },
    ...(setup?.microphones ?? []).map((mic) => ({ id: mic.id, label: mic.name, checked: micId === mic.id, onSelect: () => setMicId(mic.id) })),
  ];

  const counting = state.status === 'countdown';
  const cameraLabel = cameraId ? (cameras.find((c) => c.deviceId === cameraId)?.label ?? 'Camera') : 'No camera';
  const micLabel = micId ? (setup?.microphones.find((m) => m.id === micId)?.name ?? 'Microphone') : 'No microphone';

  return (
    <GlassPanel className="recorder-panel" data-testid="recorder-panel">
      <header className="recorder-head">
        <AppMark size={26} />
        <h1>New recording</h1>
        <IconButton label="Close" size="sm" bare onClick={close}>
          <CloseIcon size={18} />
        </IconButton>
      </header>

      {counting ? (
        <div className="recorder-countdown" aria-live="assertive" data-testid="recorder-countdown">
          <span key={state.countdown}>{state.countdown}</span>
          <p>Recording starts…</p>
        </div>
      ) : setup && !setup.supported ? (
        <p className="recorder-note">{setup.unsupportedReason}</p>
      ) : setup && setup.permission === 'denied' ? (
        <div className="recorder-permission">
          <MonitorIcon size={30} />
          <h2>Allow screen recording</h2>
          <p>macOS asks once. If you already said no, turn on xBot (or Electron while developing) in System Settings → Privacy &amp; Security → Screen Recording, then quit and reopen xBot.</p>
          <button type="button" className="recorder-start" onClick={() => void window.xbot.recordings.requestPermission().then(() => refresh())}>
            Allow…
          </button>
          <button type="button" className="recorder-link" onClick={() => void refresh()}>
            Check again
          </button>
        </div>
      ) : (
        <>
          <div className="recorder-modes" role="tablist" aria-label="What to record">
            <ModeTab mode="display" current={mode} onSelect={setMode} icon={<MonitorIcon size={18} />} label="Display" />
            <ModeTab mode="window" current={mode} onSelect={setMode} icon={<WindowIcon size={18} />} label="Window" />
            <ModeTab mode="area" current={mode} onSelect={setMode} icon={<AreaIcon size={18} />} label="Area" />
          </div>

          <div className="recorder-sources">
            {mode === 'window' ? (
              <SourceGrid sources={setup?.windows ?? []} selected={windowId} onSelect={setWindowId} empty="No windows to record." />
            ) : (
              <SourceGrid sources={setup?.displays ?? []} selected={displayId} onSelect={setDisplayId} empty="Looking for displays…" />
            )}
            {mode === 'area' && (
              <button type="button" className="recorder-area" onClick={() => void pickArea()} data-testid="recorder-pick-area">
                <AreaIcon size={18} />
                {area ? `${Math.round(area.width)} × ${Math.round(area.height)} — change` : 'Select an area…'}
              </button>
            )}
          </div>

          <div className="recorder-devices">
            <button
              ref={cameraAnchor}
              type="button"
              className="recorder-device"
              onClick={() => {
                void listCameras(cameras.length === 0 || cameras.every((c) => c.label.startsWith('Camera '))).then(setCameras);
                popovers.toggle(CAMERA_MENU);
              }}
              data-testid="recorder-camera"
            >
              <CameraIcon size={18} />
              <span>{cameraLabel}</span>
              <ChevronDownIcon size={14} strokeWidth={2.2} />
            </button>
            <button
              ref={micAnchor}
              type="button"
              className="recorder-device"
              aria-disabled={!setup?.microphoneSupported || undefined}
              title={setup?.microphoneSupported ? undefined : 'Recording a microphone needs macOS 15'}
              onClick={() => setup?.microphoneSupported && popovers.toggle(MIC_MENU)}
              data-testid="recorder-mic"
            >
              <MicIcon size={18} />
              <span>{micLabel}</span>
              <ChevronDownIcon size={14} strokeWidth={2.2} />
            </button>
            <div className="recorder-toggle">
              <SpeakerIcon size={18} />
              <Toggle label="System audio" checked={systemAudio} onChange={setSystemAudio} />
            </div>
          </div>

          {error && (
            <p className="recorder-error" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="recorder-start" aria-disabled={!target || busy || undefined} onClick={() => void start()} data-testid="recorder-start">
            <span className="recorder-dot" aria-hidden="true" />
            Start recording
          </button>
        </>
      )}
      <Menu id={CAMERA_MENU} anchor={cameraAnchor} label="Camera" placement="bottom-start" items={cameraItems} />
      <Menu id={MIC_MENU} anchor={micAnchor} label="Microphone" placement="bottom-start" items={micItems} />
    </GlassPanel>
  );
}

function ModeTab({ mode, current, onSelect, icon, label }: { mode: Mode; current: Mode; onSelect(mode: Mode): void; icon: ReactNode; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={mode === current} className={`recorder-mode${mode === current ? ' recorder-mode-active' : ''}`} onClick={() => onSelect(mode)} data-testid={`recorder-mode-${mode}`}>
      {icon}
      {label}
    </button>
  );
}

function SourceGrid({ sources, selected, onSelect, empty, wide = false }: { sources: CaptureSource[]; selected: number | null; onSelect(id: number): void; empty: string; wide?: boolean }) {
  if (sources.length === 0) return <p className="recorder-note">{empty}</p>;
  return (
    <div className={`recorder-grid${wide ? ' recorder-grid-wide' : ''}`} role="radiogroup">
      {sources.map((source) => (
        <button
          key={`${source.kind}-${source.id}`}
          type="button"
          role="radio"
          aria-checked={selected === source.id}
          className={`recorder-source${selected === source.id ? ' recorder-source-active' : ''}`}
          onClick={() => onSelect(source.id)}
          title={source.name}
        >
          <span className="recorder-thumb" style={source.thumbnail ? { backgroundImage: `url("${source.thumbnail}")` } : undefined} />
          <span className="recorder-source-name">{source.name}</span>
        </button>
      ))}
    </div>
  );
}
