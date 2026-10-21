import { StatusChips } from '../../status/StatusChips';
import { useIntegrationStatus } from '../../status/useIntegrationStatus';
import type { SettingsSection } from '../registry';

/** Every integration's chip ("Local AI ready", "X disconnected", "Export running", …); hidden while there are none. */
function Status() {
  return <StatusChips statuses={useIntegrationStatus()} />;
}

const section: SettingsSection = { id: 'status', order: 0, title: 'Status', Component: Status };
export default section;
