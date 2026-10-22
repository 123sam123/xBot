import { useEffect, useState } from 'react';
import type { RecordingState } from '../../shared/contracts/recordings';
import { useSettings } from '../common/useSettings';
import { useAppearance } from '../design-system';
import { AreaPicker } from './AreaPicker';
import { Bar } from './Bar';
import { CameraBubble } from './CameraBubble';
import { Panel } from './Panel';

// The recorder's windows, one page: `?mode=` picks the panel, the camera
// bubble, the stop bar or the area overlay (main's windows/recorder.ts).

const mode = new URLSearchParams(window.location.search).get('mode') ?? 'panel';

const IDLE: RecordingState = { status: 'idle', id: null, elapsedMs: 0, at: 0, countdown: 0, camera: false };

/** Main's recording state, kept current. */
export function useRecordingState(): RecordingState {
  const [state, setState] = useState<RecordingState>(IDLE);
  useEffect(() => {
    void window.xbot.recordings.state().then((result) => result.ok && setState(result.data));
    return window.xbot.events.on('recording:state', setState);
  }, []);
  return state;
}

export function App() {
  const { values: settings } = useSettings();
  useAppearance(settings?.['ui.reduceTransparency'] ?? false, settings?.['ui.increaseContrast'] ?? false, settings?.['ui.glassClarity']);
  useEffect(() => {
    document.documentElement.dataset.recorder = mode;
    document.documentElement.setAttribute('data-ready', '');
  }, []);

  if (mode === 'camera') return <CameraBubble />;
  if (mode === 'bar') return <Bar />;
  if (mode === 'area') return <AreaPicker />;
  return <Panel />;
}
