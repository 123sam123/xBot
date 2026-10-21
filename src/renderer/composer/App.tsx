import { useEffect, useRef, useState } from 'react';
import { CompositionPreview } from '../common/CompositionPreview';
import { DEFAULT_COMPOSITION, type PreviewComposition } from '../common/previewComposition';
import { useAppInfo, useReadyMarker } from '../common/useAppInfo';
import { useEscapeToHide } from '../common/useEscapeToHide';
import { useSettings } from '../common/useSettings';
import { Divider, GlassPanel, popovers, StatusChip, useAnyPopoverOpen, useAppearance } from '../design-system';
import { PREVIEW_DRAFT_TEXT, PREVIEW_HANDLE, PREVIEW_REMINDER_LABEL, PREVIEW_SOURCE } from '../preview/fixtures';
import type { AccountState } from './AccountMenu';
import { ActionRow } from './ActionRow';
import { AttachmentList, type ComposerAttachment } from './AttachmentList';
import { ComposerHeader } from './ComposerHeader';
import { PostEditor } from './PostEditor';
import { ReminderRow } from './ReminderRow';
import { SettingsSheet } from './SettingsSheet';
import { UploadZone } from './UploadZone';

// The Write Post composer. The draft lives in local state here; T3
// (XBOT-6F4GAC) persists it and wires media, T8 the reminder row, T9 the X
// account and Post.

const X_POST_LIMIT = 280;
const NOTICE_MS = 3200;

/** The attachment thumbnail is the same composition, with more room around the frame. */
const THUMBNAIL_COMPOSITION: PreviewComposition = { ...DEFAULT_COMPOSITION, padding: 0.13 };

/** Keeps the window exactly as tall as its content, so no empty region shows below it. */
function useFitWindowToContent(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const send = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      // Before the first content renders the panel is empty; don't shrink the window to nothing.
      if (height >= 80) void window.xbot.windows.resizeComposer(height);
    };
    const observer = new ResizeObserver(send);
    observer.observe(el);
    // A ResizeObserver may not fire while the window is hidden; re-send on show.
    document.addEventListener('visibilitychange', send);
    send();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', send);
    };
  }, [ref]);
}

/**
 * Holds the window open on blur while a popover is up. Main resets the hold
 * whenever the window hides, so every popover closes then too, keeping
 * hold and release paired.
 */
function useHoldWhilePopoverOpen(): void {
  const anyOpen = useAnyPopoverOpen();
  useEffect(() => {
    if (!anyOpen) return;
    void window.xbot.windows.hold();
    return () => void window.xbot.windows.release();
  }, [anyOpen]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') popovers.closeAll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function App() {
  const panel = useRef<HTMLDivElement>(null);
  const { info, ready: infoReady } = useAppInfo();
  const { values: settings, ready: settingsReady } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const reduceTransparency = settings?.['ui.reduceTransparency'] ?? false;
  const increaseContrast = settings?.['ui.increaseContrast'] ?? false;

  useEscapeToHide();
  useFitWindowToContent(panel);
  useAppearance(reduceTransparency, increaseContrast);
  useHoldWhilePopoverOpen();
  useReadyMarker(infoReady && settingsReady);
  useEffect(() => window.xbot.events.on('ui:open-settings', () => setSettingsOpen(true)), []);

  const preview = info?.isPreview ?? false;
  return (
    <GlassPanel ref={panel} className="composer" data-testid="composer-panel">
      {infoReady && <Composer key={preview ? 'preview' : 'normal'} preview={preview} />}
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        reduceTransparency={reduceTransparency}
        increaseContrast={increaseContrast}
      />
    </GlassPanel>
  );
}

function Composer({ preview }: { preview: boolean }) {
  const [text, setText] = useState(preview ? PREVIEW_DRAFT_TEXT : '');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() =>
    preview
      ? [
          {
            id: 'preview-sample',
            label: 'sample screenshot',
            thumbnail: <CompositionPreview composition={THUMBNAIL_COMPOSITION} source={PREVIEW_SOURCE} className="attachment-composition" />,
          },
        ]
      : [],
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Code points for now; X's weighted counting (URLs, emoji, CJK) comes with T9.
  const count = [...text].length;
  const overLimit = count > X_POST_LIMIT;
  const account: AccountState = preview ? { kind: 'preview', handle: PREVIEW_HANDLE } : { kind: 'disconnected' };
  const postDisabledReason = !preview
    ? 'Connect X to post'
    : overLimit
      ? `Over the ${X_POST_LIMIT}-character limit`
      : count === 0
        ? 'Write something first'
        : undefined;

  return (
    <>
      <ComposerHeader account={account} />
      <h1 className="composer-title">Write Post</h1>
      <PostEditor value={text} onChange={setText} autoFocus />
      <AttachmentList
        attachments={attachments}
        onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))}
        onReorder={(from, to) => setAttachments((list) => move(list, from, to))}
        onEditInStudio={() => void window.xbot.windows.openStudio()}
      />
      <UploadZone disabledReason="Adding media isn’t available yet" />
      <ActionRow
        count={count}
        limit={X_POST_LIMIT}
        canPost={postDisabledReason === undefined}
        postDisabledReason={postDisabledReason}
        onPost={() => setNotice('Posting is off in preview')}
        notice={notice && <StatusChip>{notice}</StatusChip>}
      />
      <Divider className="composer-divider" />
      <ReminderRow label={preview ? PREVIEW_REMINDER_LABEL : 'Reminders aren’t set up yet'} muted={!preview} />
    </>
  );
}
