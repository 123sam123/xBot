import { useState } from 'react';
import { ArrowUpRightIcon, CheckIcon, ImageIcon, Sheet, StatusChip } from '../design-system';

type Outcome = { tone: 'neutral' | 'warning'; text: string } | null;

/**
 * Post without an X account (T9 swaps in real publishing): copy the text,
 * export the media to a folder, and open X's composer in the browser.
 */
export function PublishSheet({ open, onClose, ...options }: { open: boolean; onClose(): void } & PublishOptionsProps) {
  return (
    <Sheet open={open} title="Post to X" onClose={onClose} testId="publish-sheet">
      <PublishOptions {...options} />
    </Sheet>
  );
}

interface PublishOptionsProps {
  hasText: boolean;
  mediaCount: number;
  /** Resolves to an error message, or null once the text is on the clipboard. */
  onCopy(): Promise<string | null>;
  /** Resolves to what happened, or null when the user cancelled. */
  onExport(): Promise<Outcome>;
}

/** Mounted only while the sheet is open, so "Copied" and results start fresh each time. */
function PublishOptions({ hasText, mediaCount, onCopy, onExport }: PublishOptionsProps) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const copy = async () => {
    const error = await onCopy();
    setCopied(error === null);
    if (error) setOutcome({ tone: 'warning', text: error });
  };

  const exportMedia = async () => {
    setExporting(true);
    try {
      const result = await onExport();
      if (result) setOutcome(result);
    } finally {
      setExporting(false);
    }
  };

  const files = mediaCount === 1 ? '1 file' : `${mediaCount} files`;
  return (
    <>
      <p className="sheet-lede">X isn’t connected, so post it yourself.</p>
      <div className="publish-options">
        <button
          type="button"
          className="publish-option"
          data-testid="publish-copy"
          aria-disabled={!hasText || undefined}
          onClick={() => hasText && void copy()}
        >
          <span className="publish-option-icon" aria-hidden="true">
            {copied ? <CheckIcon size={18} /> : '1'}
          </span>
          <span className="publish-option-text">
            <span className="publish-option-label">{copied ? 'Copied' : 'Copy text'}</span>
            <span className="publish-option-detail">{hasText ? 'Puts your post on the clipboard.' : 'This draft has no text.'}</span>
          </span>
        </button>
        <button
          type="button"
          className="publish-option"
          data-testid="publish-export"
          aria-disabled={mediaCount === 0 || exporting || undefined}
          aria-busy={exporting || undefined}
          onClick={() => mediaCount > 0 && !exporting && void exportMedia()}
        >
          <span className="publish-option-icon" aria-hidden="true">
            {mediaCount > 0 ? <ImageIcon size={18} /> : '2'}
          </span>
          <span className="publish-option-text">
            <span className="publish-option-label">{exporting ? 'Exporting…' : 'Export media'}</span>
            <span className="publish-option-detail">{mediaCount > 0 ? `Saves your ${files} to a folder, in order.` : 'This draft has no media.'}</span>
          </span>
        </button>
        <a className="publish-option" data-testid="publish-open-x" href="https://x.com/compose/post" target="_blank" rel="noreferrer">
          <span className="publish-option-icon" aria-hidden="true">
            <ArrowUpRightIcon size={18} />
          </span>
          <span className="publish-option-text">
            <span className="publish-option-label">Open X</span>
            <span className="publish-option-detail">Opens the X composer in your browser.</span>
          </span>
        </a>
      </div>
      <p className="sheet-note">X opens without your media. Attach the exported files there yourself.</p>
      {outcome && (
        <StatusChip tone={outcome.tone} className="publish-outcome">
          {outcome.text}
        </StatusChip>
      )}
    </>
  );
}
