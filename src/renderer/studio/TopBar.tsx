import type { ReactNode, RefObject } from 'react';
import { ChevronDownIcon, FilmIcon, FolderIcon, IconButton, RedoIcon, Tooltip, TrashIcon, UndoIcon, UploadIcon, WandIcon } from '../design-system';

/**
 * The editor's top bar, laid out like Cap's: the window's lights, delete and
 * show-in-Finder, the file's name, Presets and undo/redo in the middle, and
 * "Back to post" and Export on the right. It also drags the frameless window.
 */
export function TopBar({
  name,
  badge,
  onClose,
  onMinimize,
  onFullscreen,
  onDelete,
  onReveal,
  presetsAnchor,
  exportAnchor,
  recordingsAnchor,
  onRecordings,
  deleteAnchor,
  nameAnchor,
  onName,
  onPresets,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBack,
  onExport,
  exportDisabledReason,
  exportLabel = 'Export',
  disabledReason,
  notice,
}: {
  name: string | null;
  badge?: string;
  onClose(): void;
  onMinimize(): void;
  onFullscreen(): void;
  onDelete?: () => void;
  onReveal?: () => void;
  presetsAnchor: RefObject<HTMLButtonElement | null>;
  exportAnchor: RefObject<HTMLSpanElement | null>;
  recordingsAnchor: RefObject<HTMLButtonElement | null>;
  onRecordings(): void;
  deleteAnchor: RefObject<HTMLButtonElement | null>;
  nameAnchor: RefObject<HTMLButtonElement | null>;
  /** Opens the file menu (open, replace). */
  onName(): void;
  onPresets?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onBack(): void;
  onExport(): void;
  exportDisabledReason?: string;
  exportLabel?: string;
  /** Why editing controls are off, if they are. */
  disabledReason?: string;
  notice?: ReactNode;
}) {
  const exportButton = (
    <button
      type="button"
      className="studio-export-btn"
      aria-disabled={exportDisabledReason !== undefined || undefined}
      onClick={() => exportDisabledReason === undefined && onExport()}
      data-testid="studio-export"
    >
      <UploadIcon size={18} strokeWidth={2} />
      {exportLabel}
    </button>
  );
  return (
    <header className="studio-topbar">
      <div className="studio-topbar-start">
        <span className="studio-lights">
          <button type="button" className="studio-light studio-light-close" aria-label="Close" onClick={onClose} />
          <button type="button" className="studio-light studio-light-min" aria-label="Minimize" onClick={onMinimize} />
          <button type="button" className="studio-light studio-light-full" aria-label="Full screen" onClick={onFullscreen} />
        </span>
        <IconButton ref={deleteAnchor} label="Delete" size="sm" bare disabled={!onDelete} onClick={onDelete} data-testid="studio-delete">
          <TrashIcon size={19} />
        </IconButton>
        <IconButton label="Show in Finder" size="sm" bare disabled={!onReveal} onClick={onReveal} data-testid="studio-reveal">
          <FolderIcon size={19} />
        </IconButton>
        <button ref={nameAnchor} type="button" className="studio-name" title={name ?? undefined} aria-haspopup="menu" onClick={onName} data-testid="studio-name">
          {name ? splitName(name) : <span className="studio-name-text">Media Studio</span>}
          <ChevronDownIcon size={13} strokeWidth={2.2} />
        </button>
        {badge && <span className="badge studio-badge">{badge}</span>}
      </div>

      <div className="studio-topbar-middle">
        <button
          ref={presetsAnchor}
          type="button"
          className="studio-bar-btn"
          aria-disabled={!onPresets || undefined}
          onClick={() => onPresets?.()}
          title={disabledReason}
          data-testid="studio-presets"
        >
          <WandIcon size={18} />
          Presets
          <ChevronDownIcon size={15} strokeWidth={2.2} />
        </button>
        <span className="studio-bar-sep" aria-hidden="true" />
        <IconButton label="Undo" size="sm" bare disabled={!canUndo} onClick={onUndo} data-testid="studio-undo">
          <UndoIcon size={19} />
        </IconButton>
        <IconButton label="Redo" size="sm" bare disabled={!canRedo} onClick={onRedo} data-testid="studio-redo">
          <RedoIcon size={19} />
        </IconButton>
      </div>

      <div className="studio-topbar-end">
        {notice}
        <button type="button" className="studio-bar-btn studio-back-btn" onClick={onBack} data-testid="studio-back">
          Back to post
        </button>
        <button ref={recordingsAnchor} type="button" className="studio-bar-btn studio-back-btn" onClick={onRecordings} data-testid="studio-recordings">
          <FilmIcon size={17} />
          Recordings
        </button>
        <span ref={exportAnchor} className="studio-export-wrap">
          {exportDisabledReason ? <Tooltip label={exportDisabledReason}>{exportButton}</Tooltip> : exportButton}
        </span>
      </div>
    </header>
  );
}

/** "Cap 2026-10-22.cap" → the stem, with the extension quieter. */
function splitName(name: string): ReactNode {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return (
    <span className="studio-name-text">
      {name.slice(0, dot)}
      <span className="studio-name-ext">{name.slice(dot)}</span>
    </span>
  );
}
