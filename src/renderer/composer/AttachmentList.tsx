import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, cx, GhostButton, GlassCard, IconButton } from '../design-system';

export interface ComposerAttachment {
  id: string;
  /** Names the media for screen readers, e.g. "Screenshot 1". */
  label: string;
  thumbnail: ReactNode;
}

/** Drag type for reordering cards; never `Files`, so the window's file drop ignores it. */
const REORDER_TYPE = 'application/x-xbot-attachment';

/**
 * The post's media. Reorder controls appear only when there is something to
 * reorder: drag a card, or use its ↑/↓ buttons (focus follows the moved card).
 */
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
  const list = useRef<HTMLUListElement>(null);
  const refocus = useRef<{ id: string; direction: 'up' | 'down' } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // After a keyboard move, put focus back on the same button of the moved card.
  useLayoutEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    refocus.current = null;
    list.current?.querySelector<HTMLElement>(`[data-attachment="${pending.id}"] [data-move="${pending.direction}"]`)?.focus();
  }, [attachments]);

  if (attachments.length === 0) return null;
  const reorderable = attachments.length > 1;

  const move = (id: string, from: number, direction: 'up' | 'down') => {
    refocus.current = { id, direction };
    onReorder(from, direction === 'up' ? from - 1 : from + 1);
  };

  const onDragOver = (event: DragEvent, index: number) => {
    if (!event.dataTransfer.types.includes(REORDER_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropIndex(index);
  };

  const onDrop = (event: DragEvent, index: number) => {
    if (!event.dataTransfer.types.includes(REORDER_TYPE)) return;
    event.preventDefault();
    setDropIndex(null);
    const from = Number(event.dataTransfer.getData(REORDER_TYPE));
    if (Number.isInteger(from) && from !== index) onReorder(from, index);
  };

  return (
    <ul
      ref={list}
      className={cx('attachment-list', reorderable && 'attachment-list-reorderable', attachments.length > 2 && 'attachment-list-scroll')}
      aria-label="Attachments"
    >
      {attachments.map((attachment, index) => (
        <li
          key={attachment.id}
          data-attachment={attachment.id}
          className={cx(dropIndex === index && 'attachment-drop-target')}
          draggable={reorderable}
          onDragStart={(event) => {
            event.dataTransfer.setData(REORDER_TYPE, String(index));
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => onDragOver(event, index)}
          onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
          onDragEnd={() => setDropIndex(null)}
          onDrop={(event) => onDrop(event, index)}
        >
          <GlassCard className="attachment-card" data-testid="attachment-card">
            <div className="attachment-thumb">{attachment.thumbnail}</div>
            <GhostButton className="attachment-edit" iconAfter={<ArrowUpRightIcon size={18} />} onClick={() => onEditInStudio(attachment.id)}>
              Edit in Studio
            </GhostButton>
            <span className="attachment-actions">
              {reorderable && (
                <span className="attachment-move">
                  <IconButton
                    label={`Move ${attachment.label} up`}
                    size="sm"
                    bare
                    data-move="up"
                    disabled={index === 0}
                    onClick={() => move(attachment.id, index, 'up')}
                  >
                    <ChevronUpIcon size={16} />
                  </IconButton>
                  <IconButton
                    label={`Move ${attachment.label} down`}
                    size="sm"
                    bare
                    data-move="down"
                    disabled={index === attachments.length - 1}
                    onClick={() => move(attachment.id, index, 'down')}
                  >
                    <ChevronDownIcon size={16} />
                  </IconButton>
                </span>
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
