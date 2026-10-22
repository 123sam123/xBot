import { aiCopy } from '../../../shared/aiCopy';
import { IpcError } from '../../ipc/core';
import { OllamaError } from './ollamaClient';

// One generation at a time (Ollama runs one request per model by default).
// Two lanes: the user's own actions go ahead of background work (T7's
// project suggestions) and pre-empt a running background job, so the user
// is never stuck behind it. Every entry can be cancelled, queued or running.

export type Priority = 'interactive' | 'background';

const LANE_LIMIT: Record<Priority, number> = { interactive: 1, background: 3 };

interface Job {
  requestId: string;
  priority: Priority;
  controller: AbortController;
  start(): void;
  reject(reason: unknown): void;
}

export type AiQueue = ReturnType<typeof createAiQueue>;

export function createAiQueue() {
  const lanes: Record<Priority, Job[]> = { interactive: [], background: [] };
  const jobs = new Map<string, Job>();
  let current: Job | null = null;

  const pump = () => {
    if (current) return;
    const next = lanes.interactive.shift() ?? lanes.background.shift();
    if (!next) return;
    current = next;
    next.start();
  };

  const abortJob = (job: Job, reason: OllamaError) => {
    if (job === current) {
      job.controller.abort(reason);
      return;
    }
    const lane = lanes[job.priority];
    const index = lane.indexOf(job);
    if (index >= 0) lane.splice(index, 1);
    jobs.delete(job.requestId);
    job.reject(reason);
  };

  return {
    /** Runs `task` when its turn comes; it must honour `signal`. Rejects with OllamaError('aborted'|'preempted') if cancelled. */
    enqueue<T>(requestId: string, priority: Priority, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (jobs.has(requestId) || lanes[priority].length >= LANE_LIMIT[priority]) {
        return Promise.reject(new IpcError('ai_busy', aiCopy.errors.ai_busy));
      }
      return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        const job: Job = {
          requestId,
          priority,
          controller,
          reject,
          start() {
            task(controller.signal)
              .then(resolve, reject)
              .finally(() => {
                jobs.delete(requestId);
                if (current === job) current = null;
                pump();
              });
          },
        };
        jobs.set(requestId, job);
        lanes[priority].push(job);
        if (priority === 'interactive' && current?.priority === 'background') {
          current.controller.abort(new OllamaError('preempted', 'Pre-empted by the user’s request.'));
        }
        pump();
      });
    },
    /** Cancels a queued or running request; false when it is unknown (already finished). */
    cancel(requestId: string): boolean {
      const job = jobs.get(requestId);
      if (!job) return false;
      abortJob(job, new OllamaError('aborted', 'Cancelled.'));
      return true;
    },
    cancelAll(): void {
      for (const job of [...jobs.values()]) abortJob(job, new OllamaError('aborted', 'Cancelled.'));
    },
    running(): { requestId: string; priority: Priority } | null {
      return current ? { requestId: current.requestId, priority: current.priority } : null;
    },
  };
}

/** A request that ended because it was cancelled or pre-empted, not because it failed. */
export function isCancellation(err: unknown): boolean {
  return err instanceof OllamaError && (err.code === 'aborted' || err.code === 'preempted');
}
