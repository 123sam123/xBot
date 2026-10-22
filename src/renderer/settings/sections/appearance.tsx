import { setSetting, useSettings } from '../../common/useSettings';
import { Toggle } from '../../design-system';
import type { SettingsSection } from '../registry';

function Appearance() {
  const { values } = useSettings();
  return (
    <>
      <Toggle
        label="Reduce transparency"
        description="Solid graphite instead of glass. Also follows the macOS setting."
        checked={values?.['ui.reduceTransparency'] ?? false}
        onChange={(value) => setSetting('ui.reduceTransparency', value)}
      />
      <Toggle
        label="Increase contrast"
        description="A darker layer behind text. Also follows the macOS setting."
        checked={values?.['ui.increaseContrast'] ?? false}
        onChange={(value) => setSetting('ui.increaseContrast', value)}
      />
    </>
  );
}

const section: SettingsSection = { id: 'appearance', order: 100, title: 'Appearance', Component: Appearance };
export default section;
