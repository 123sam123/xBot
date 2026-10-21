import { useEffect, useState, type RefObject } from 'react';
import type { StudioPreset } from '../../shared/contracts/studio';
import { CloseIcon, FrostedButton, IconButton, Popover, TextField, usePopoverOpen } from '../design-system';

export const PRESETS_POPOVER = 'studio-presets';

/** Saved visual styles: click one to apply it, ✕ to delete it, or save the current style under a name. */
export function PresetsPopover({
  anchor,
  onApply,
  onError,
  currentStyle,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  onApply(preset: StudioPreset): void;
  onError(message: string): void;
  /** The style "Save" stores. */
  currentStyle: StudioPreset['style'];
}) {
  const open = usePopoverOpen(PRESETS_POPOVER);
  const [presets, setPresets] = useState<StudioPreset[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void window.xbot.studio.listPresets().then((result) => {
      if (!alive) return;
      if (result.ok) setPresets(result.data);
      else onError(result.error.message);
    });
    return () => {
      alive = false;
    };
  }, [open, onError]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = await window.xbot.studio.savePreset(trimmed, currentStyle);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setPresets((list) => [...list, result.data]);
    setName('');
  };

  const remove = async (id: string) => {
    const result = await window.xbot.studio.deletePreset(id);
    if (result.ok) setPresets((list) => list.filter((preset) => preset.id !== id));
    else onError(result.error.message);
  };

  return (
    <Popover id={PRESETS_POPOVER} anchor={anchor} label="Presets" placement="bottom-end" className="tool-popover tool-popover-wide" testId="popover-presets">
      <h2 className="tool-popover-title">Presets</h2>
      {presets.length === 0 ? (
        <p className="tool-popover-note">No presets yet. Save the current style below.</p>
      ) : (
        <ul className="preset-list">
          {presets.map((preset) => (
            <li key={preset.id} className="preset-row">
              <button type="button" className="preset-apply" onClick={() => onApply(preset)}>
                {preset.name}
              </button>
              <IconButton label={`Delete ${preset.name}`} size="sm" bare onClick={() => void remove(preset.id)}>
                <CloseIcon size={14} strokeWidth={2} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="tool-popover-actions">
        <TextField label="Name" value={name} maxLength={60} placeholder="My style" onChange={setName} testId="preset-name" />
        <FrostedButton className="tool-popover-apply" disabled={name.trim() === ''} onClick={() => void save()} data-testid="preset-save">
          Save
        </FrostedButton>
      </div>
    </Popover>
  );
}
