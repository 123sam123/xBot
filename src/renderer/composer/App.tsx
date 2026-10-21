import { useEffect, useRef, useState } from 'react';
import type { Draft } from '../../shared/contracts/drafts';
import type { IpcResult } from '../../shared/contracts/ipc';
import type { ImportResult, MediaItem } from '../../shared/contracts/media';
import { postLength } from '../../shared/postLength';
import { CompositionPreview } from '../common/CompositionPreview';
import { useAppInfo, useReadyMarker } from '../common/useAppInfo';
import { useEscapeToHide } from '../common/useEscapeToHide';
import { setSetting, useSettings } from '../common/useSettings';
import { Divider, GlassPanel, popovers, StatusChip, useAnyPopoverOpen, useAppearance, type MenuItem } from '../design-system';
import { OnboardingSheet } from '../onboarding/OnboardingSheet';
import { unseenSteps } from '../onboarding/registry';
import { PREVIEW_DRAFT_TEXT, PREVIEW_HANDLE, PREVIEW_REMINDER_LABEL, PREVIEW_SOURCE, PREVIEW_THUMBNAIL_COMPOSITION } from '../preview/fixtures';
import { SettingsSheet } from '../settings/SettingsSheet';
import type { AccountState } from './AccountMenu';
import { ActionRow } from './ActionRow';
import { AttachmentList, type ComposerAttachment } from './AttachmentList';
import { ComposerHeader } from './ComposerHeader';
import { HistorySheet } from './HistorySheet';
import { MediaThumb } from './MediaThumb';
import { PostEditor } from './PostEditor';
import { PublishSheet } from './PublishSheet';
import { ReminderRow } from './ReminderRow';
import { UploadZone } from './UploadZone';
import { useDraft } from './useDraft';
import { useFileDrop } from '../common/useFileDrop';

// The Write Post composer. In normal mode the draft and its media are
// persisted (useDraft, window.xbot.drafts / .media); preview mode keeps T2's
// fixed sample in local state. T8 wires the reminder row, T9 the X account
// and real posting (until then Post opens the publish-options sheet).

const NOTICE_MS = 3200;
/** The drafts contract's DRAFT_TEXT_MAX (not imported here: contract files bundle zod). */
const TEXT_MAX = 25_000;

type SheetId = 'onboarding' | 'history' | 'settings' | 'publish';

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

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return visible;
}

/**
 * Holds the window open on blur while `active` (a popover, menu or sheet is
 * open). Main resets every hold when the window hides, so the hold is asked
 * for again each time the window shows with something still open.
 */
function useHoldWhile(active: boolean): void {
  const visible = usePageVisible();
  useEffect(() => {
    if (!active || !visible) return;
    void window.xbot.windows.hold();
    return () => void window.xbot.windows.release();
  }, [active, visible]);
}

/** Popovers close when the window hides; sheets stay (and re-hold on show). */
function useClosePopoversOnHide(): void {
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

/** X's mix rules (T9 enforces them when posting): up to 4 images, or one video or GIF alone. */
function mixWarning(media: readonly MediaItem[]): string | null {
  const motion = media.filter((m) => m.kind === 'video' || m.mime === 'image/gif').length;
  if (motion > 0 && media.length > 1) return 'X takes one video or GIF per post, on its own.';
  if (media.length > 4) return 'X takes up to 4 images per post.';
  return null;
}

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export function App() {
  const panel = useRef<HTMLDivElement>(null);
  const { info, ready: infoReady } = useAppInfo();
  const { values: settings, ready: settingsReady } = useSettings();

  useEscapeToHide();
  useFitWindowToContent(panel);
  useAppearance(settings?.['ui.reduceTransparency'] ?? false, settings?.['ui.increaseContrast'] ?? false);
  useClosePopoversOnHide();

  const preview = info?.isPreview ?? false;
  return (
    <GlassPanel ref={panel} className="composer" data-testid="composer-panel">
      {infoReady && settingsReady && (
        <Composer
          key={preview ? 'preview' : 'normal'}
          preview={preview}
          emojiPanel={info?.emojiPanel ?? false}
          seenSteps={settings?.['ui.onboardingSeen'] ?? []}
        />
      )}
    </GlassPanel>
  );
}

function Composer({ preview, emojiPanel, seenSteps }: { preview: boolean; emojiPanel: boolean; seenSteps: readonly string[] }) {
  const model = useDraft(!preview);
  const { draft } = model;
  const editor = useRef<HTMLTextAreaElement>(null);

  // Onboarding shows its unseen steps once, on the first load, never in preview.
  const [onboarding] = useState(() => (preview ? [] : unseenSteps(seenSteps)));
  const [sheet, setSheet] = useState<SheetId | null>(() => (onboarding.length > 0 ? 'onboarding' : null));
  const seen = useRef<readonly string[]>(seenSteps);

  const [previewText, setPreviewText] = useState(PREVIEW_DRAFT_TEXT);
  const [previewAttachments, setPreviewAttachments] = useState<ComposerAttachment[]>(() =>
    preview
      ? [
          {
            id: 'preview-sample',
            label: 'sample screenshot',
            thumbnail: (
              <CompositionPreview composition={PREVIEW_THUMBNAIL_COMPOSITION} source={PREVIEW_SOURCE} fit="cover" className="attachment-composition" />
            ),
          },
        ]
      : [],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  useHoldWhile(useAnyPopoverOpen() || sheet !== null);
  useReadyMarker(preview || draft !== null);
  useEffect(() => window.xbot.events.on('ui:open-settings', () => setSheet('settings')), []);
  useEffect(() => {
    if (preview) return;
    // A drop on the menu-bar icon: main imported it; useDraft reloads the attachments.
    return window.xbot.events.on('media:imported', ({ rejected }) => setErrors(rejected.map((r) => r.message)));
  }, [preview]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setErrors([]);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const run = async (call: Promise<IpcResult<Draft>>): Promise<boolean> => {
    const result = await call;
    if (result.ok) model.apply(result.data);
    else setErrors([result.error.message]);
    return result.ok;
  };

  const importWith = async (call: (draftId: string) => Promise<IpcResult<ImportResult>>) => {
    if (!draft) return;
    setErrors([]);
    setImporting(true);
    try {
      const result = await call(draft.id);
      if (!result.ok) {
        setErrors([result.error.message]);
        return;
      }
      model.apply(result.data.draft);
      setErrors(result.data.rejected.map((r) => r.message));
    } finally {
      setImporting(false);
    }
  };
  const addFiles = (files: File[]) => void importWith((id) => window.xbot.media.importFiles(id, files));
  const dragActive = useFileDrop(!preview && draft !== null, addFiles);

  const text = preview ? previewText : model.text;
  const media = draft?.attachments.map((a) => a.media) ?? [];
  const attachments: ComposerAttachment[] = preview
    ? previewAttachments
    : (draft?.attachments ?? []).map((a, index) => ({
        id: a.id,
        label: `attachment ${index + 1}, ${a.media.name}`,
        thumbnail: <MediaThumb media={a.media} />,
      }));

  const remove = (id: string) => {
    if (preview) setPreviewAttachments((list) => list.filter((a) => a.id !== id));
    else if (draft) void run(window.xbot.drafts.removeAttachment(draft.id, id));
  };
  const reorder = (from: number, to: number) => {
    if (preview) {
      setPreviewAttachments((list) => move(list, from, to));
      return;
    }
    if (!draft) return;
    const next = move(draft.attachments, from, to);
    model.apply({ ...draft, attachments: next }); // at once, so focus can follow the moved card
    void run(
      window.xbot.drafts.reorderAttachments(
        draft.id,
        next.map((a) => a.id),
      ),
    );
  };
  const editInStudio = async (id: string) => {
    if (preview || !draft) {
      void window.xbot.windows.openStudio();
      return;
    }
    await model.flush();
    const result = await window.xbot.drafts.openInStudio(draft.id, id);
    if (!result.ok) setErrors([result.error.message]);
  };

  const startNew = async () => {
    await model.flush();
    if (await run(window.xbot.drafts.startNew())) {
      setErrors([]);
      editor.current?.focus();
    }
  };
  const restore = async (id: string) => {
    await model.flush();
    if (await run(window.xbot.drafts.restore(id))) {
      setErrors([]);
      setSheet(null);
      editor.current?.focus();
    }
  };
  const copyText = async (): Promise<string | null> => {
    if (!draft) return 'Your draft hasn’t loaded yet.';
    if (!(await model.flush())) return 'Your latest text isn’t saved yet. Try again.';
    const result = await window.xbot.drafts.copyText(draft.id);
    return result.ok ? null : result.error.message;
  };
  const exportMedia = async () => {
    if (!draft) return null;
    const result = await window.xbot.media.exportForDraft(draft.id);
    if (!result.ok) return { tone: 'warning' as const, text: result.error.message };
    if (!result.data) return null;
    const { count, folder } = result.data;
    return { tone: 'neutral' as const, text: `Exported ${count === 1 ? '1 file' : `${count} files`} to ${folderName(folder)}` };
  };
  const markSeen = (ids: readonly string[]) => {
    seen.current = [...new Set([...seen.current, ...ids])].slice(-200);
    setSetting('ui.onboardingSeen', [...seen.current]);
  };

  const { weightedLength, overLimit, limit } = postLength(text);
  const hasContent = text.trim() !== '' || attachments.length > 0;
  const postDisabledReason = preview
    ? overLimit
      ? `Over the ${limit}-character limit`
      : weightedLength === 0
        ? 'Write something first'
        : undefined
    : !draft
      ? 'Loading your draft…'
      : !hasContent
        ? 'Write something or add media first'
        : overLimit
          ? `Over the ${limit}-character limit`
          : undefined;

  const account: AccountState = preview ? { kind: 'preview', handle: PREVIEW_HANDLE } : { kind: 'disconnected' };
  const unavailableInPreview = preview ? 'Not available in preview' : undefined;
  const menuItems: MenuItem[] = [
    { id: 'new-draft', label: 'New draft', detail: unavailableInPreview, disabled: preview || !draft, onSelect: () => void startNew() },
    { id: 'history', label: 'Draft history…', detail: unavailableInPreview, disabled: preview, onSelect: () => setSheet('history') },
    { id: 'settings', label: 'Settings…', onSelect: () => setSheet('settings') },
  ];
  const warning = preview ? null : mixWarning(media);

  return (
    <>
      <ComposerHeader account={account} menuItems={menuItems} />
      <h1 className="composer-title">Write Post</h1>
      <PostEditor
        value={text}
        onChange={preview ? setPreviewText : model.setText}
        autoFocus
        readOnly={!preview && !draft}
        maxLength={TEXT_MAX}
        saveState={preview ? undefined : model.saveState}
        onEmoji={emojiPanel ? () => void window.xbot.windows.showEmojiPanel() : undefined}
        editorRef={editor}
      />
      <AttachmentList attachments={attachments} onRemove={remove} onReorder={reorder} onEditInStudio={(id) => void editInStudio(id)} />
      {warning && (
        <div className="composer-warning">
          <StatusChip tone="warning">{warning}</StatusChip>
        </div>
      )}
      <UploadZone
        onAdd={preview || !draft ? undefined : () => void importWith((id) => window.xbot.media.pick(id))}
        disabledReason={preview ? 'Adding media is off in preview' : 'Loading your draft…'}
        dragActive={dragActive}
        busy={importing}
      />
      {errors.length > 0 && (
        <div className="composer-errors" role="alert" data-testid="import-errors">
          {errors.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
      <ActionRow
        count={weightedLength}
        limit={limit}
        canPost={postDisabledReason === undefined}
        postDisabledReason={postDisabledReason}
        onPost={preview ? () => setNotice('Posting is off in preview') : () => setSheet('publish')}
        notice={notice && <StatusChip>{notice}</StatusChip>}
      />
      <Divider className="composer-divider" />
      <ReminderRow label={preview ? PREVIEW_REMINDER_LABEL : 'Reminders aren’t set up yet'} muted={!preview} />

      <OnboardingSheet
        open={sheet === 'onboarding'}
        steps={onboarding}
        onSeen={markSeen}
        onDone={() => {
          setSheet(null);
          editor.current?.focus();
        }}
      />
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} />
      <HistorySheet open={sheet === 'history'} onClose={() => setSheet(null)} onRestore={(id) => void restore(id)} />
      <PublishSheet
        open={sheet === 'publish'}
        onClose={() => setSheet(null)}
        hasText={text.trim() !== ''}
        mediaCount={attachments.length}
        onCopy={copyText}
        onExport={exportMedia}
      />
    </>
  );
}
