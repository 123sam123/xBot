import type { ReactNode } from 'react';
import { ArrowUpIcon, cx, FrostedButton, Tooltip } from '../design-system';

/** The character counter and the frosted "Post ↑" button. */
export function ActionRow({
  count,
  limit,
  canPost,
  postDisabledReason,
  onPost,
  notice,
  busy = false,
}: {
  count: number;
  limit: number;
  canPost: boolean;
  /** Why Post is unavailable; shown as its tooltip and accessible description. */
  postDisabledReason?: string;
  onPost(): void;
  /** A transient status, e.g. a StatusChip, shown beside the button. */
  notice?: ReactNode;
  /** A post of this draft is on its way to X (T9): the button reads "Posting…". */
  busy?: boolean;
}) {
  const post = (
    <FrostedButton
      className="post-button"
      data-testid="post-button"
      disabled={!canPost}
      aria-busy={busy || undefined}
      iconAfter={busy ? undefined : <ArrowUpIcon size={21} strokeWidth={2.25} />}
      onClick={onPost}
    >
      {busy ? 'Posting…' : 'Post'}
    </FrostedButton>
  );
  return (
    <div className="action-row">
      <span className={cx('char-count', count > limit && 'char-count-over')} data-testid="char-count">
        {count} / {limit}
      </span>
      <span className="action-row-notice">{notice}</span>
      {!canPost && postDisabledReason ? <Tooltip label={postDisabledReason}>{post}</Tooltip> : post}
    </div>
  );
}
