// The single-open rule for popovers, menus and the account menu: one window
// has at most one open at a time, so opening one closes the other and the
// Studio canvas never has two settings panels fighting over it. Kept free of
// React and the DOM so unit tests load it in Node.

export type PopoverId = string;

export interface PopoverManager {
  /** The open popover's id, or null. */
  current(): PopoverId | null;
  /** Opens `id`, closing whichever popover was open. */
  open(id: PopoverId): void;
  /** Closes `id` if it is the open one; otherwise does nothing. */
  close(id: PopoverId): void;
  toggle(id: PopoverId): void;
  closeAll(): void;
  /** Called after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export function createPopoverManager(): PopoverManager {
  let openId: PopoverId | null = null;
  const listeners = new Set<() => void>();

  const set = (next: PopoverId | null) => {
    if (next === openId) return;
    openId = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    current: () => openId,
    open: (id) => set(id),
    close: (id) => {
      if (openId === id) set(null);
    },
    toggle: (id) => set(openId === id ? null : id),
    closeAll: () => set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** This window's manager. */
export const popovers = createPopoverManager();
