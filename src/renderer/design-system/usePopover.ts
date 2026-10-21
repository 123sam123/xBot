import { useSyncExternalStore } from 'react';
import { popovers, type PopoverId } from './popoverManager';

/** Whether popover `id` is the open one in this window. */
export function usePopoverOpen(id: PopoverId): boolean {
  return useSyncExternalStore(popovers.subscribe, () => popovers.current() === id);
}

/** Whether any popover is open in this window. */
export function useAnyPopoverOpen(): boolean {
  return useSyncExternalStore(popovers.subscribe, () => popovers.current() !== null);
}
