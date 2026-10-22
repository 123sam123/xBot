import { useEffect, useRef, useState } from 'react';
import type { PublishJob } from '../../../shared/contracts/x';

/** The time, refreshed every `intervalMs`, so a rate limit's "Try again" comes back on its own. */
export function useClock(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Publish jobs the composer shows: the open ones from main on mount (so a job
 * still running, uncertain, failed or just posted survives a reload or a
 * relaunch), then every `x:job-changed`. `onChange` sees each update once.
 */
export function usePublishJobs(enabled: boolean, onChange?: (job: PublishJob) => void): PublishJob[] {
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const listener = useRef(onChange);
  useEffect(() => {
    listener.current = onChange;
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const upsert = (job: PublishJob) =>
      setJobs((list) => {
        const rest = list.filter((j) => j.id !== job.id);
        return job.dismissed || job.status === 'canceled' ? rest : [job, ...rest];
      });
    void window.xbot.x.getOpenJobs().then((result) => {
      if (!alive || !result.ok) return;
      setJobs((list) => {
        const known = new Set(list.map((j) => j.id));
        return [...list, ...result.data.filter((j) => !known.has(j.id))];
      });
    });
    const off = window.xbot.events.on('x:job-changed', ({ job }) => {
      upsert(job);
      listener.current?.(job);
    });
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);

  return enabled ? jobs : [];
}
