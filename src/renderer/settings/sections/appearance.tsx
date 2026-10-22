import { useEffect, useRef, useState } from 'react';
import { setSetting, useSettings } from '../../common/useSettings';
import { hasNativeGlass, Slider, Toggle } from '../../design-system';
import type { SettingsSection } from '../registry';

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Glass clarity, applied live by main as the slider moves. One save is in
 * flight at a time: when it settles, the newest value (if any) goes next. The
 * slider shows the value not yet saved, so a save's echo never moves it back.
 */
function GlassClarity({ stored, reason }: { stored: number; reason: string | null }) {
  const [pending, setPending] = useState<number | null>(null);
  const queued = useRef<number | null>(null);
  const saving = useRef(false);

  const save = () => {
    if (saving.current || queued.current === null) return;
    const value = queued.current;
    queued.current = null;
    saving.current = true;
    void window.xbot.settings.set('ui.glassClarity', value).then((result) => {
      if (!result.ok) console.error('settings: could not set ui.glassClarity', result.error);
      saving.current = false;
      if (queued.current === null) setPending(null);
      else save();
    });
  };
  const change = (percent: number) => {
    const value = percent / 100;
    setPending(value);
    queued.current = value;
    save();
  };

  const percent = Math.round((pending ?? stored) * 100);
  return (
    <div className="glass-clarity">
      <span className="toggle-text">
        <span className="toggle-label">Glass clarity</span>
        <span className="toggle-description">How much of your desktop shows through the glass.</span>
      </span>
      <Slider
        label="Glass clarity"
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={reason !== null}
        onChange={change}
        onCommit={change}
        endAdornment={<span className="glass-clarity-value">{percent}%</span>}
        testId="glass-clarity"
      />
      {reason && <p className="sheet-note">{reason}</p>}
    </div>
  );
}

function Appearance() {
  const { values } = useSettings();
  const reduceTransparency = values?.['ui.reduceTransparency'] ?? false;
  const osReducesTransparency = useMediaQuery(REDUCED_TRANSPARENCY);
  const clarityReason = !hasNativeGlass()
    ? 'Needs the native glass on macOS.'
    : reduceTransparency || osReducesTransparency
      ? 'Off while Reduce transparency is on.'
      : null;
  return (
    <>
      <Toggle
        label="Reduce transparency"
        description="Solid graphite instead of glass. Also follows the macOS setting."
        checked={reduceTransparency}
        onChange={(value) => setSetting('ui.reduceTransparency', value)}
      />
      <Toggle
        label="Increase contrast"
        description="A darker layer behind text. Also follows the macOS setting."
        checked={values?.['ui.increaseContrast'] ?? false}
        onChange={(value) => setSetting('ui.increaseContrast', value)}
      />
      <GlassClarity stored={values?.['ui.glassClarity'] ?? 0.8} reason={clarityReason} />
    </>
  );
}

const section: SettingsSection = { id: 'appearance', order: 100, title: 'Appearance', Component: Appearance };
export default section;
