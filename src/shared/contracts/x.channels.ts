// Owned by T9 (XBOT-OE2XV9).
export const xChannels = {
  getState: 'x:get-state',
  /** Runs the browser sign-in; resolves when it ends. A second call joins the running one. */
  connect: 'x:connect',
  cancelConnect: 'x:cancel-connect',
  switchAccount: 'x:switch',
  disconnect: 'x:disconnect',
  /** Creates (or finds) the publish job for the draft's saved content. */
  post: 'x:post',
  getOpenJobs: 'x:get-open-jobs',
  cancelJob: 'x:cancel-job',
  retryJob: 'x:retry-job',
  /** Looks for the job's post on X (a read of the account's own recent posts). */
  reconcile: 'x:reconcile',
  markNotPosted: 'x:mark-not-posted',
  dismissJob: 'x:dismiss-job',
} as const;
