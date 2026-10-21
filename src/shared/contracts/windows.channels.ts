export const windowsChannels = {
  /** Hide the sender's own window. */
  hide: 'windows:hide',
  /** Keep the sender's window open on blur (popover or picker open). */
  hold: 'windows:hold',
  release: 'windows:release',
  resizeComposer: 'windows:resize-composer',
  showComposer: 'windows:show-composer',
  openStudio: 'windows:open-studio',
  /** The OS emoji picker for the focused text field (`app.showEmojiPanel()`). */
  showEmojiPanel: 'windows:show-emoji-panel',
} as const;
