import { execFile } from 'node:child_process';

// Runs FFmpeg's tools to completion. Always an argument array and never a
// shell, so a file name can't become a command. No `electron` import.

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Stdout and stderr together may not exceed this; ffprobe's JSON is small. */
  maxBuffer?: number;
  signal?: AbortSignal;
}

/** Why a tool run failed: `signal` is a kill from outside (macOS blocks quarantined downloads this way). */
export class ToolError extends Error {
  constructor(
    readonly kind: 'missing' | 'timeout' | 'signal' | 'failed' | 'aborted',
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export type Runner = (file: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

export const runTool: Runner = (file, args, { timeoutMs = 15_000, maxBuffer = 8 * 1024 * 1024, signal } = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, signal },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null };
        if (e.name === 'AbortError') return reject(new ToolError('aborted', `${file} was stopped`));
        if (e.code === 'ENOENT' || e.code === 'EACCES') return reject(new ToolError('missing', `${file} can't be run (${e.code})`));
        if (e.killed && e.signal === 'SIGKILL') return reject(new ToolError('timeout', `${file} took longer than ${timeoutMs} ms`, stderr));
        if (e.signal) return reject(new ToolError('signal', `${file} was killed (${e.signal})`, stderr));
        reject(new ToolError('failed', `${file} failed: ${lastLine(stderr) || e.message}`, stderr));
      },
    );
  });

/** The last non-empty line of a tool's stderr: FFmpeg puts the actual error there. */
export function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return lines.filter(Boolean).at(-1) ?? '';
}
