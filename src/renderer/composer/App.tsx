import { useEffect, useRef, useState } from 'react';
import { aiCopy } from '../../shared/aiCopy';
import type { AiAction, AiOption } from '../../shared/contracts/ai';
import type { Idea } from '../../shared/contracts/projects';
import type { Draft } from '../../shared/contracts/drafts';
import type { IpcResult } from '../../shared/contracts/ipc';
import type { ImportResult, MediaItem } from '../../shared/contracts/media';
import type { PublishJob } from '../../shared/contracts/x';
import { postLength } from '../../shared/postLength';
import { isActiveStatus, mediaViolation } from '../../shared/xRules';
import { useAppInfo, useReadyMarker } from '../common/useAppInfo';
import { useEscapeToHide } from '../common/useEscapeToHide';
import { setSetting, useSettings } from '../common/useSettings';
import { Divider, GlassPanel, popovers, StatusChip, useAnyPopoverOpen, useAppearance, useGlassShadow, type MenuItem } from '../design-system';
import { OnboardingSheet } from '../onboarding/OnboardingSheet';
import { unseenSteps } from '../onboarding/registry';
import { PREVIEW_HANDLE } from '../preview/fixtures';
import { SettingsSheet } from '../settings/SettingsSheet';
import { accountMenuEntries, accountTrigger, activeAccount, type AccountAction } from './account/accountMenu';
import { connectX, useXState } from './account/useXState';
import type { AccountState } from './AccountMenu';
import { ActionRow } from './ActionRow';
import {
  AiMenu,
  AiStatusRow,
  canUndo,
  insertThroughEditor,
  planApply,
  SuggestionsSheet,
  useAiRun,
  useAiState,
  type AiStatus,
  type MenuContext,
  type SelectionRef,
  type UndoEntry,
} from './ai';
import { AttachmentList, type ComposerAttachment } from './AttachmentList';
import { ComposerHeader } from './ComposerHeader';
import { HistorySheet } from './HistorySheet';
import { IdeasMenu, ProjectsSheet, useIdeas, useProjects } from './ideas';
import { MediaThumb } from './MediaThumb';
import { PostEditor } from './PostEditor';
import { shouldStartFreshDraft } from './publish/freshDraft';
import type { JobAction } from './publish/jobView';
import { pickJob } from './publish/jobView';
import { PublishStatus } from './publish/PublishStatus';
import { ReconcileSheet } from './publish/ReconcileSheet';
import { useClock, usePublishJobs } from './publish/usePublishJobs';
import { PublishSheet } from './PublishSheet';
import { ReminderControl } from './reminders';
import { UploadZone } from './UploadZone';
import { useDraft } from './useDraft';
import { useFileDrop } from '../common/useFileDrop';

// The Write Post composer. The draft and its media are persisted (useDraft,
// window.xbot.drafts / .media), in preview mode too: there main seeds a
// labelled sample into the preview userData (T10), and only AI, X, project
// folders and reminders stay off. T8 wires the reminder row. T9: the header's X
// account menu, and Post ↑ — a publish job with a connected account
// (window.xbot.x), the post-it-yourself sheet without one. T6 adds local AI:
// the ✦ menu, the suggestions sheet and the AI status row; an AI change goes
// through the editor, so it autosaves and stays undoable. T7 adds project
// ideas: the header's bulb and its popover, and the projects sheet; using an
// idea goes through the same undoable path. T8: the reminder row and its menu
// (the idea a reminder brought uses that path too).

const NOTICE_MS = 3200;
/** The drafts contract's DRAFT_TEXT_MAX (not imported here: contract files bundle zod). */
const TEXT_MAX = 25_000;
const PREVIEW_POST_LEDE = 'Posting to X is off in preview. You can post it yourself.';

type SheetId = 'onboarding' | 'history' | 'settings' | 'publish' | 'suggestions' | 'reconcile' | 'projects';

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

/** X's media rules (src/shared/xRules.ts, also enforced by main): up to 4 images, or one video or GIF alone, within X's sizes. */
function mixWarning(media: readonly MediaItem[]): string | null {
  return mediaViolation(media)?.message ?? null;
}

const firstLine = (text: string) => {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
};

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export function App() {
  const panel = useRef<HTMLDivElement>(null);
  const { info, ready: infoReady } = useAppInfo();
  const { values: settings, ready: settingsReady } = useSettings();

  useEscapeToHide();
  useFitWindowToContent(panel);
  useAppearance(settings?.['ui.reduceTransparency'] ?? false, settings?.['ui.increaseContrast'] ?? false, settings?.['ui.glassClarity']);
  useGlassShadow();
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
  const model = useDraft(true);
  const { draft } = model;
  const editor = useRef<HTMLTextAreaElement>(null);

  // Onboarding shows its unseen steps once, on the first load, never in preview.
  const [onboarding] = useState(() => (preview ? [] : unseenSteps(seenSteps)));
  const [sheet, setSheet] = useState<SheetId | null>(() => (onboarding.length > 0 ? 'onboarding' : null));
  const seen = useRef<readonly string[]>(seenSteps);

  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const { state: aiState, refresh: refreshAi } = useAiState(!preview);
  const aiRun = useAiRun();
  const [aiSheetMode, setAiSheetMode] = useState<'story' | 'rewrite'>('story');
  const [aiSelection, setAiSelection] = useState<SelectionRef | null>(null);
  const [aiUndo, setAiUndo] = useState<UndoEntry | null>(null);
  /** The `aiRun.finished` count the user has seen, so "Suggestions ready" shows only for new results. */
  const [aiSeen, setAiSeen] = useState(0);
  const [settingsFocus, setSettingsFocus] = useState<string | undefined>(undefined);
  // Preview mode lists the seeded sample idea; finding new ones stays off.
  const ideasState = useIdeas(true);
  const projectList = useProjects(!preview) ?? [];

  // X (T9): accounts, publish jobs, and the sheets they open.
  const { state: xstate } = useXState(!preview);
  const [posting, setPosting] = useState(false);
  const [fallbackLede, setFallbackLede] = useState<string | null>(null);
  const [reconcileJobId, setReconcileJobId] = useState<string | null>(null);
  const freshDraftFor = useRef(new Set<string>());

  useHoldWhile(useAnyPopoverOpen() || sheet !== null);
  useReadyMarker(draft !== null);
  useEffect(() => window.xbot.events.on('ui:open-settings', () => setSheet('settings')), []);
  // A drop on the menu-bar icon: main imported it; useDraft reloads the attachments.
  useEffect(() => window.xbot.events.on('media:imported', ({ rejected }) => setErrors(rejected.map((r) => r.message))), []);
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
  const dragActive = useFileDrop(draft !== null, addFiles);

  const text = model.text;
  const media = draft?.attachments.map((a) => a.media) ?? [];
  const attachments: ComposerAttachment[] = (draft?.attachments ?? []).map((a, index) => ({
    id: a.id,
    label: `attachment ${index + 1}, ${a.media.name}`,
    thumbnail: <MediaThumb media={a.media} />,
  }));

  const remove = (id: string) => {
    if (draft) void run(window.xbot.drafts.removeAttachment(draft.id, id));
  };
  const reorder = (from: number, to: number) => {
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
    if (!draft) return;
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
  // ---------- Local AI ----------
  const aiRunning = aiRun.running || aiState?.running?.priority === 'interactive';
  const aiContext: MenuContext = {
    preview,
    draftLoaded: draft !== null,
    hasText: text.trim() !== '',
    hasSelection: aiSelection !== null,
    running: aiRunning,
  };
  const captureSelection = () => {
    const el = editor.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    setAiSelection(el && start < end ? { start, end, text: el.value.slice(start, end) } : null);
    void refreshAi('throttled');
  };
  const openAiSettings = () => {
    setSettingsFocus('ai');
    setSheet('settings');
  };
  const runAi = (action: AiAction) => {
    if (action === 'story') {
      setAiSheetMode('story');
      setAiSeen(aiRun.finished);
      setSheet('suggestions');
      return;
    }
    // Rewrites run with only the status row showing, so the text stays editable.
    setAiSheetMode('rewrite');
    void aiRun.start({ action, text: model.text, selection: action === 'selection' ? aiSelection : null });
  };
  const closeSuggestions = () => {
    setAiSeen(aiRun.finished);
    setSheet(null);
    editor.current?.focus();
  };
  /** Puts generated text in the post through the editor (autosaved, Cmd+Z reverts it) and keeps one undo entry. */
  const applyText = (text: string, target: 'whole' | 'selection', selection: SelectionRef | null): string | null => {
    if (!draft) return aiCopy.menu.loading;
    const before = model.text;
    const plan = planApply(before, text, target, selection);
    if ('error' in plan) return plan.error;
    const el = editor.current;
    let after: string;
    if (el && insertThroughEditor(el, plan.start, plan.end, plan.insert)) {
      after = el.value;
    } else {
      after = before.slice(0, plan.start) + plan.insert + before.slice(plan.end);
      model.setText(after);
    }
    setAiUndo({ draftId: draft.id, before, after });
    return null;
  };
  const applyAi = (option: AiOption, target: 'whole' | 'selection'): string | null => {
    const error = applyText(option.text, target, aiRun.selection);
    if (error) return error;
    setAiSeen(aiRun.finished);
    setSheet(null);
    return null;
  };
  const applyIdea = (idea: Idea): string | null => applyText(idea.text, 'whole', null);
  const undoAi = () => {
    if (!canUndo(aiUndo, draft?.id ?? null, model.text)) return;
    const el = editor.current;
    if (!(el && insertThroughEditor(el, 0, aiUndo.after.length, aiUndo.before))) model.setText(aiUndo.before);
    setAiUndo(null);
  };
  const cancelAi = () => {
    if (aiRun.running) aiRun.cancel();
    else if (aiState?.running) void window.xbot.ai.cancel(aiState.running.requestId);
  };
  const viewAi = () => {
    setAiSeen(aiRun.finished);
    setSheet('suggestions');
  };
  const suggestionsOpen = sheet === 'suggestions';
  const aiStatus: AiStatus | null = preview
    ? null
    : aiRunning
      ? { kind: 'running', model: aiState?.selected ?? null, onCancel: cancelAi }
      : aiRun.finished > aiSeen && aiRun.options.length > 0 && !suggestionsOpen
        ? { kind: 'ready', label: aiRun.action === 'story' ? 'Suggestions ready' : 'Suggestion ready', onView: viewAi }
        : canUndo(aiUndo, draft?.id ?? null, model.text)
          ? { kind: 'undo', onUndo: undoAi }
          : aiRun.error && !suggestionsOpen
            ? { kind: 'error', message: aiRun.error.message, onRetry: aiRun.retry, onSetup: openAiSettings }
            : null;

  const markSeen = (ids: readonly string[]) => {
    seen.current = [...new Set([...seen.current, ...ids])].slice(-200);
    setSetting('ui.onboardingSeen', [...seen.current]);
  };

  const onJobChanged = (job: PublishJob) => {
    if (job.status === 'needs_reconciliation' && sheet === null) {
      setReconcileJobId(job.id);
      setSheet('reconcile');
    }
    const current = draft ? { draftId: draft.id, text: model.text, mediaIds: draft.attachments.map((a) => a.media.id) } : null;
    if (!freshDraftFor.current.has(job.id) && shouldStartFreshDraft(job, current)) {
      freshDraftFor.current.add(job.id);
      void startNew();
    }
  };
  const jobs = usePublishJobs(!preview, onJobChanged);
  const now = useClock();
  const shownJob = pickJob(jobs, draft?.id ?? null, now);
  const draftJob = shownJob && draft && shownJob.draftId === draft.id ? shownJob : null;

  const openXSettings = () => {
    setSettingsFocus('x');
    setSheet('settings');
  };
  const connect = async (reconnectAccountId?: string) => {
    if (xstate && !xstate.clientIdSet) {
      openXSettings();
      return;
    }
    const outcome = await connectX(reconnectAccountId);
    if (!outcome) return;
    if (outcome.code === 'x_client_id_missing') openXSettings();
    if (outcome.tone === 'warning') setErrors([outcome.text]);
    else setNotice(outcome.text);
  };
  const reportError = (result: { ok: boolean; error?: { message: string } }) => {
    if (!result.ok && result.error) setErrors([result.error.message]);
  };
  const onAccountAction = (action: AccountAction) => {
    if (action.kind === 'connect') void connect();
    else if (action.kind === 'reconnect') void connect(action.accountId);
    else if (action.kind === 'cancel-connect') void window.xbot.x.cancelConnect();
    else if (action.kind === 'switch') void window.xbot.x.switchAccount(action.accountId).then(reportError);
    else if (action.kind === 'disconnect') void window.xbot.x.disconnect(action.accountId).then(reportError);
    else openXSettings();
  };
  const onJobAction = (action: JobAction, job: PublishJob) => {
    if (action === 'cancel') void window.xbot.x.cancelJob(job.id).then(reportError);
    else if (action === 'retry') void window.xbot.x.retryJob(job.id).then(reportError);
    else if (action === 'dismiss') void window.xbot.x.dismissJob(job.id).then(reportError);
    else if (action === 'reconnect') void connect(xstate?.accounts.find((a) => a.handle === job.accountHandle)?.id);
    else if (action === 'fallback') {
      setFallbackLede(`${job.error?.message ?? 'X didn’t take this post.'} You can post it yourself.`);
      setSheet('publish');
    } else if (action === 'check') {
      setReconcileJobId(job.id);
      setSheet('reconcile');
    }
  };

  /** Post ↑: with a connected account, one publish job for the saved draft; without one (and always in preview), the post-it-yourself sheet. */
  const post = async () => {
    if (!draft || posting) return;
    setErrors([]);
    if (preview || !activeAccount(xstate)) {
      setFallbackLede(preview ? PREVIEW_POST_LEDE : null);
      setSheet('publish');
      return;
    }
    setPosting(true);
    try {
      if (!(await model.flush())) {
        setErrors(['Your latest text isn’t saved yet. Try again.']);
        return;
      }
      const result = await window.xbot.x.post({ draftId: draft.id, text: model.text, attachmentIds: draft.attachments.map((a) => a.id) });
      if (!result.ok) setErrors([result.error.message]);
    } finally {
      setPosting(false);
    }
  };

  const { weightedLength, overLimit, limit } = postLength(text);
  const hasContent = text.trim() !== '' || attachments.length > 0;
  const warning = mixWarning(media);
  const jobBusy = posting || (draftJob !== null && isActiveStatus(draftJob.status) && draftJob.status !== 'needs_reconciliation');
  const postDisabledReason = !draft
    ? 'Loading your draft…'
    : !hasContent
      ? 'Write something or add media first'
      : overLimit
        ? `Over the ${limit}-character limit`
        : warning
          ? warning
          : importing
            ? 'Adding media…'
            : jobBusy
              ? 'This draft is being posted'
              : draftJob?.status === 'needs_reconciliation'
                ? 'Check X for this post first'
                : undefined;

  const trigger = accountTrigger(xstate);
  const account: AccountState = preview
    ? { kind: 'preview', handle: PREVIEW_HANDLE }
    : trigger.kind === 'connected'
      ? { kind: 'connected', handle: trigger.handle, reconnect: trigger.reconnect }
      : trigger;
  const menuItems: MenuItem[] = [
    { id: 'new-draft', label: 'New draft', disabled: !draft, onSelect: () => void startNew() },
    { id: 'history', label: 'Draft history…', onSelect: () => setSheet('history') },
    {
      id: 'settings',
      label: 'Settings…',
      onSelect: () => {
        setSettingsFocus(undefined);
        setSheet('settings');
      },
    },
  ];

  return (
    <>
      <ComposerHeader
        account={account}
        menuItems={menuItems}
        aiMenu={<AiMenu state={aiState} context={aiContext} onOpen={captureSelection} onAction={runAi} onSettings={openAiSettings} />}
        ideas={
          <IdeasMenu
            state={ideasState}
            projects={projectList}
            aiState={aiState}
            preview={preview}
            onUse={applyIdea}
            onProjects={() => setSheet('projects')}
            onAiSetup={openAiSettings}
          />
        }
        accountEntries={preview ? undefined : accountMenuEntries(xstate)}
        onAccountAction={onAccountAction}
      />
      <h1 className="composer-title">Write Post</h1>
      <PostEditor
        value={text}
        onChange={model.setText}
        autoFocus
        readOnly={!draft}
        maxLength={TEXT_MAX}
        saveState={model.saveState}
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
        onAdd={!draft ? undefined : () => void importWith((id) => window.xbot.media.pick(id))}
        disabledReason="Loading your draft…"
        dragActive={dragActive}
        busy={importing}
        onRecord={() => {
          void window.xbot.windows.hide();
          void window.xbot.recordings.openPanel();
        }}
      />
      {errors.length > 0 && (
        <div className="composer-errors" role="alert" data-testid="import-errors">
          {errors.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
      <AiStatusRow status={aiStatus} />
      <PublishStatus
        job={shownJob}
        now={now}
        draftLabel={shownJob && shownJob !== draftJob ? `“${firstLine(shownJob.frozenText) || 'Media only'}”` : null}
        onAction={onJobAction}
      />
      <ActionRow
        count={weightedLength}
        limit={limit}
        canPost={postDisabledReason === undefined}
        postDisabledReason={postDisabledReason}
        onPost={() => void post()}
        notice={notice && <StatusChip>{notice}</StatusChip>}
        busy={jobBusy}
      />
      <Divider className="composer-divider" />
      <ReminderControl
        preview={preview}
        onUseIdea={applyIdea}
        onSettings={() => {
          setSettingsFocus('reminders');
          setSheet('settings');
        }}
      />

      <OnboardingSheet
        open={sheet === 'onboarding'}
        steps={onboarding}
        onSeen={markSeen}
        onDone={() => {
          setSheet(null);
          editor.current?.focus();
        }}
      />
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} focusSection={settingsFocus} />
      <SuggestionsSheet
        open={suggestionsOpen}
        onClose={closeSuggestions}
        mode={aiSheetMode}
        run={aiRun}
        state={aiState}
        context={aiContext}
        draftText={text}
        onSuggest={() => void aiRun.start({ action: 'story', text: model.text, note: aiRun.note })}
        onApply={applyAi}
        onSetup={openAiSettings}
      />
      <ProjectsSheet open={sheet === 'projects'} onClose={() => setSheet(null)} projects={projectList} preview={preview} />
      <HistorySheet open={sheet === 'history'} onClose={() => setSheet(null)} onRestore={(id) => void restore(id)} />
      <PublishSheet
        open={sheet === 'publish'}
        onClose={() => setSheet(null)}
        lede={fallbackLede ?? undefined}
        onConnect={
          preview || activeAccount(xstate)
            ? undefined
            : () => {
                setSheet(null);
                void connect();
              }
        }
        hasText={text.trim() !== ''}
        mediaCount={attachments.length}
        onCopy={copyText}
        onExport={exportMedia}
      />
      <ReconcileSheet job={sheet === 'reconcile' ? (jobs.find((j) => j.id === reconcileJobId) ?? null) : null} onClose={() => setSheet(null)} />
    </>
  );
}
