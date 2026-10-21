import type { IntegrationStatus } from '../shared/contracts/app';

// The integration status registry. Each domain registers one provider for its
// own chip ("Local AI ready", "X disconnected", "Export running", …) and calls
// `statusChanged()` when its state moves; nobody edits anybody else's
// provider. No `electron` import: services that register here stay
// unit-testable. app.ts forwards changes as the `status:changed` event.

export interface StatusProvider {
  id: string;
  /** Chips sort by `order`, then `id`. */
  order: number;
  /** The current status, from cached state (synchronous); null hides the chip. */
  get(): IntegrationStatus | null;
}

const providers = new Map<string, StatusProvider>();
const listeners = new Set<(statuses: IntegrationStatus[]) => void>();

/** Registers (or replaces, by id) a provider; returns the function that removes it. */
export function registerStatusProvider(provider: StatusProvider): () => void {
  providers.set(provider.id, provider);
  statusChanged();
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
    statusChanged();
  };
}

export function currentStatuses(): IntegrationStatus[] {
  return [...providers.values()]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .flatMap((p) => {
      const status = p.get();
      return status ? [status] : [];
    });
}

/** Tells listeners a provider's status may have changed. */
export function statusChanged(): void {
  if (listeners.size === 0) return;
  const statuses = currentStatuses();
  for (const listener of listeners) listener(statuses);
}

export function onStatusChanged(listener: (statuses: IntegrationStatus[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
