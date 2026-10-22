import type { IntegrationStatus } from '../../shared/contracts/app';
import { StatusChip } from '../design-system';

/** Integration statuses as chips; a status's `detail` is its second line. */
export function StatusChips({ statuses }: { statuses: readonly IntegrationStatus[] }) {
  if (statuses.length === 0) return null;
  return (
    <ul className="status-chips" aria-label="Integration status">
      {statuses.map((status) => (
        <li key={status.id} className="status-chips-item" data-status={status.id} data-tone={status.tone}>
          <StatusChip tone={status.tone === 'warning' ? 'warning' : 'neutral'}>
            {status.tone === 'ok' && <span className="status-dot status-dot-ok" aria-hidden="true" />}
            {status.tone === 'busy' && <span className="status-dot status-dot-busy" aria-hidden="true" />}
            {status.label}
          </StatusChip>
          {status.detail && <span className="status-chips-detail">{status.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
