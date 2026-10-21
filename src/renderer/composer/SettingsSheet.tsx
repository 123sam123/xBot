import { Sheet, Toggle } from '../design-system';
import { setSetting } from '../common/useSettings';

/**
 * The composer's settings sheet (tray → "Settings…"). For now it holds only
 * Appearance; T3 (XBOT-6F4GAC) builds the full settings and onboarding sheets
 * on this one.
 */
export function SettingsSheet({
  open,
  onClose,
  reduceTransparency,
  increaseContrast,
}: {
  open: boolean;
  onClose(): void;
  reduceTransparency: boolean;
  increaseContrast: boolean;
}) {
  return (
    <Sheet open={open} title="Settings" onClose={onClose} testId="settings-sheet">
      <h3 className="sheet-section-title">Appearance</h3>
      <Toggle
        label="Reduce transparency"
        description="Solid graphite instead of glass. Also follows the macOS setting."
        checked={reduceTransparency}
        onChange={(value) => setSetting('ui.reduceTransparency', value)}
      />
      <Toggle
        label="Increase contrast"
        description="A darker layer behind text. Also follows the macOS setting."
        checked={increaseContrast}
        onChange={(value) => setSetting('ui.increaseContrast', value)}
      />
    </Sheet>
  );
}
