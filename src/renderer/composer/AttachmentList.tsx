import type { ReactNode } from 'react';
import { ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, GhostButton, GlassCard, IconButton } from '../design-system';

export interface ComposerAttachment {
  id: string;
  /** Names the media for screen readers, e.g. "Screenshot 1". */
  label: string;
  thumbnail: ReactNode;
}

/** The post's media. Reorder controls appear only when there is something to reorder. */
export function AttachmentList({
  attachments,
  onRemove,
  onReorder,
  onEditInStudio,
}: {
  attachments: readonly ComposerAttachment[];
  onRemove(id: string): void;
  onReorder(from: number, to: number): void;
  onEditInStudio(id: string): void;
}) {
  if (attachments.length === 0) return null;
  const reorderable = attachments.length > 1;
  return (
    <ul className="attachment-list" aria-label="Attachments">
      {attachments.map((attachment, index) => (
        <li key={attachment.id}>
          <GlassCard className="attachment-card" data-testid="attachment-card">
            <div className="attachment-thumb">{attachment.thumbnail}</div>
            <GhostButton className="attachment-edit" iconAfter={<ArrowUpRightIcon size={18} />} onClick={() => onEditInStudio(attachment.id)}>
              Edit in Studio
            </GhostButton>
            <span className="attachment-actions">
              {reorderable && (
                <>
                  <IconButton label={`Move ${attachment.label} up`} size="sm" bare disabled={index === 0} onClick={() => onReorder(index, index - 1)}>
                    <ChevronUpIcon size={16} />
                  </IconButton>
                  <IconButton
                    label={`Move ${attachment.label} down`}
                    size="sm"
                    bare
                    disabled={index === attachments.length - 1}
                    onClick={() => onReorder(index, index + 1)}
                  >
                    <ChevronDownIcon size={16} />
                  </IconButton>
                </>
              )}
              <IconButton label={`Remove ${attachment.label}`} size="sm" onClick={() => onRemove(attachment.id)}>
                <CloseIcon size={16} strokeWidth={2} />
              </IconButton>
            </span>
          </GlassCard>
        </li>
      ))}
    </ul>
  );
}
