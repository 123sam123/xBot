import { useRef } from 'react';
import { aiCopy } from '../../../shared/aiCopy';
import type { AiAction, AiState } from '../../../shared/contracts/ai';
import { IconButton, Menu, popovers, SparkleIcon, usePopoverOpen, type MenuItem } from '../../design-system';

const MENU_ID = 'ai-menu';

export interface MenuContext {
  preview: boolean;
  draftLoaded: boolean;
  hasText: boolean;
  hasSelection: boolean;
  /** One of the user's own requests is running. */
  running: boolean;
}

/** Why an AI action can't run right now, or null when it can. Background work never blocks the user. */
export function unavailableReason(action: AiAction, state: AiState | null, ctx: MenuContext): string | null {
  const m = aiCopy.menu;
  if (ctx.preview) return m.preview;
  if (!ctx.draftLoaded) return m.loading;
  if (!state || state.phase === 'checking') return aiCopy.guidance.checking;
  if (state.phase === 'not_running') return m.notRunning;
  if (state.phase === 'model_needed') return m.modelNeeded;
  if (ctx.running) return m.running;
  if (action !== 'story' && !ctx.hasText) return m.emptyDraft;
  if (action === 'selection' && !ctx.hasSelection) return m.noSelection;
  return null;
}

/**
 * The composer header's ✦ button and its menu: restrained, so the default
 * view stays as in the reference. `onOpen` runs in the click handler, before
 * the menu opens (the composer captures the editor's selection there).
 */
export function AiMenu({
  state,
  context,
  onOpen,
  onAction,
  onSettings,
}: {
  state: AiState | null;
  context: MenuContext;
  onOpen(): void;
  onAction(action: AiAction): void;
  onSettings(): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const open = usePopoverOpen(MENU_ID);
  const item = (id: AiAction, label: string): MenuItem => {
    const reason = unavailableReason(id, state, context);
    return { id, label, detail: reason ?? undefined, disabled: reason !== null, onSelect: () => onAction(id) };
  };
  const items: MenuItem[] = [
    item('story', 'Suggest a post…'),
    item('shorter', 'Make shorter'),
    item('casual', 'More casual'),
    item('angle', 'Different angle'),
    item('selection', 'Rewrite selection'),
    { id: 'ai-settings', label: 'Local AI settings…', onSelect: onSettings },
  ];
  return (
    <>
      <IconButton
        ref={anchor}
        label="Local AI"
        size="sm"
        bare
        className="ai-menu-trigger"
        data-testid="ai-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen();
          popovers.toggle(MENU_ID);
        }}
      >
        <SparkleIcon size={20} />
      </IconButton>
      <Menu id={MENU_ID} anchor={anchor} label="Local AI" items={items} testId="ai-menu" />
    </>
  );
}
