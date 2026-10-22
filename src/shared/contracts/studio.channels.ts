// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Add `studio:<verb>` channel names here.
export const studioChannels = {
  /** The open document (or read-only video view), if any. */
  current: 'studio:current',
  /** Pick an image or video and open it. */
  pick: 'studio:pick',
  /** Open the first image or video of the dropped files (paths come from the preload's webUtils). */
  import: 'studio:import',
  /** Autosave a document's composition. */
  save: 'studio:save',
  /** Pick an image to use as a document's new source or its background. */
  pickMedia: 'studio:pick-media',
  listPresets: 'studio:list-presets',
  savePreset: 'studio:save-preset',
  deletePreset: 'studio:delete-preset',
  /** Store a rendered export and put it on the current draft. */
  addToPost: 'studio:add-to-post',
  /** Queue a video document's MP4 export (T5). */
  exportVideo: 'studio:export-video',
  cancelExport: 'studio:cancel-export',
  /** A video document's timeline thumbnails. */
  filmstrip: 'studio:filmstrip',
  ffmpegStatus: 'studio:ffmpeg-status',
  /** Look for FFmpeg again. */
  ffmpegCheck: 'studio:ffmpeg-check',
  /** Pick the ffmpeg program by hand. */
  locateFfmpeg: 'studio:locate-ffmpeg',
  toggleFullscreen: 'studio:toggle-fullscreen',
  /** The Studio's answer to `studio:flush-requested`: its pending save has landed. */
  flushed: 'studio:flushed',
} as const;
