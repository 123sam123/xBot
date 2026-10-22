import { postLength } from './postLength';

// X's posting rules and the publish job's state sets, verified against
// docs.x.com on 2026-10-22 (docs/X.md). zod-free, so main's validation and the
// composer's warning and job view share one copy.

export const JOB_STATUSES = [
  'queued',
  'uploading',
  'processing',
  'publishing',
  'published',
  'failed',
  'canceled',
  'needs_reconciliation',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A draft has at most one job in this set (the partial unique index in the migration lists the same states). */
export const ACTIVE_STATUSES = ['queued', 'uploading', 'processing', 'publishing', 'needs_reconciliation'] as const satisfies readonly JobStatus[];

export function isActiveStatus(status: JobStatus): boolean {
  return (ACTIVE_STATUSES as readonly JobStatus[]).includes(status);
}

export type MediaCategory = 'tweet_image' | 'tweet_gif' | 'tweet_video';

/** X OAuth 2.0 Client IDs are URL-safe base64. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9._~-]{8,128}$/;
/** The callback port xBot listens on (http://127.0.0.1:<port>/callback) unless Settings → X says otherwise. */
export const DEFAULT_CALLBACK_PORT = 47813;

/** X's `tweet_image` cap. */
export const X_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** X's `tweet_gif` cap. */
export const X_GIF_MAX_BYTES = 15 * 1024 * 1024;
/** xBot's own import cap for video (X allows 8 GB). */
export const X_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
export const X_MAX_IMAGES = 4;

export interface PostMediaFacts {
  kind: 'image' | 'video';
  mime: string;
  bytes: number;
  name: string;
}

export function mediaCategory(media: Pick<PostMediaFacts, 'kind' | 'mime'>): MediaCategory {
  if (media.kind === 'video') return 'tweet_video';
  return media.mime === 'image/gif' ? 'tweet_gif' : 'tweet_image';
}

export type PostViolationCode = 'x_empty_post' | 'x_text_too_long' | 'x_media_mix' | 'x_too_many_media' | 'x_media_too_large';

export interface PostViolation {
  code: PostViolationCode;
  message: string;
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;

/** Why X would refuse this media set (mix, count, size), or null. */
export function mediaViolation(media: readonly PostMediaFacts[]): PostViolation | null {
  const motion = media.filter((m) => mediaCategory(m) !== 'tweet_image');
  if (motion.length > 0 && media.length > 1) return { code: 'x_media_mix', message: 'X takes one video or GIF per post, on its own.' };
  if (media.length > X_MAX_IMAGES) return { code: 'x_too_many_media', message: `X takes up to ${X_MAX_IMAGES} images per post.` };

  for (const m of media) {
    const category = mediaCategory(m);
    const cap = category === 'tweet_image' ? X_IMAGE_MAX_BYTES : category === 'tweet_gif' ? X_GIF_MAX_BYTES : X_VIDEO_MAX_BYTES;
    if (m.bytes > cap) {
      const kind = category === 'tweet_image' ? 'images' : category === 'tweet_gif' ? 'GIFs' : 'videos';
      const hint = category === 'tweet_image' ? ' Export it as a JPEG from Media Studio.' : '';
      return { code: 'x_media_too_large', message: `${m.name} is ${megabytes(m.bytes)}; X takes ${kind} up to ${megabytes(cap)}.${hint}` };
    }
  }
  return null;
}

/**
 * Why X would refuse this post, or null. Checked before a job exists and before
 * any upload: X takes up to 4 images, or 1 GIF, or 1 video, alone; and 280
 * weighted characters (twitter-text). Video length depends on the account, so
 * X decides that one.
 */
export function postViolation(text: string, media: readonly PostMediaFacts[]): PostViolation | null {
  const length = postLength(text);
  if (length.weightedLength === 0 && media.length === 0) return { code: 'x_empty_post', message: 'Write something or add media first.' };
  if (length.overLimit) return { code: 'x_text_too_long', message: `Over the ${length.limit}-character limit.` };
  return mediaViolation(media);
}
