import { describe, expect, it, vi } from 'vitest';
import { createPopoverManager } from '../../src/renderer/design-system/popoverManager';

describe('popover manager (one settings popover open at a time)', () => {
  it('opening one popover closes the other', () => {
    const popovers = createPopoverManager();
    popovers.open('tool-background');
    expect(popovers.current()).toBe('tool-background');
    popovers.open('tool-frame');
    expect(popovers.current()).toBe('tool-frame');
  });

  it('close only affects the popover that is open', () => {
    const popovers = createPopoverManager();
    popovers.open('tool-frame');
    popovers.close('tool-background');
    expect(popovers.current()).toBe('tool-frame');
    popovers.close('tool-frame');
    expect(popovers.current()).toBeNull();
  });

  it('toggle opens a closed popover and closes the open one', () => {
    const popovers = createPopoverManager();
    popovers.toggle('account-menu');
    expect(popovers.current()).toBe('account-menu');
    popovers.toggle('tool-crop');
    expect(popovers.current()).toBe('tool-crop');
    popovers.toggle('tool-crop');
    expect(popovers.current()).toBeNull();
  });

  it('notifies subscribers once per change, and not after they unsubscribe', () => {
    const popovers = createPopoverManager();
    const listener = vi.fn();
    const unsubscribe = popovers.subscribe(listener);
    popovers.open('tool-background');
    popovers.open('tool-background');
    popovers.closeAll();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    popovers.open('tool-frame');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
