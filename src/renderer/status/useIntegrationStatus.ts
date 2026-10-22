import { useEffect, useState } from 'react';
import type { IntegrationStatus } from '../../shared/contracts/app';

/** Every integration's status, from main's provider registry (src/main/status.ts), kept current. */
export function useIntegrationStatus(): IntegrationStatus[] {
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  useEffect(() => {
    let alive = true;
    void window.xbot.app.getStatus().then((result) => {
      if (alive && result.ok) setStatuses(result.data);
    });
    const off = window.xbot.events.on('status:changed', ({ statuses: next }) => setStatuses(next));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return statuses;
}
