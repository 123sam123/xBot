// Owned by T3 (XBOT-6F4GAC).
export const mediaChannels = {
  /** Import files the user dropped (paths come from the preload's webUtils) and attach them. */
  import: 'media:import',
  /** Show the file picker, then import and attach what was chosen. */
  pick: 'media:pick',
  /** Copy a draft's media, in order, into a folder the user picks. */
  export: 'media:export',
} as const;
