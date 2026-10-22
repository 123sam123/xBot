// One queue for every call that changes a draft's structure (attachments,
// which draft is current, deleting one) and for media imports, so a draft is
// never switched or deleted while an import into it is still copying. Only the
// entry points (IPC handlers, the menu-bar drop) enqueue; service methods never
// do, so a task can call them without waiting on itself.

export type SerialQueue = <T>(task: () => T | Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => T | Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}

export const draftsQueue: SerialQueue = createSerialQueue();
