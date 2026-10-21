import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Plain append-only log at userData/logs/main.log (a tray app started from
// Finder has no stdout). Nothing leaves the machine.

export interface Logger {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

type Level = 'info' | 'warn' | 'error';

function format(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

let logFile: string | null = null;

export function setLogFile(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  logFile = file;
}

function write(level: Level, message: string, details: unknown[]): void {
  const line = [new Date().toISOString(), level.toUpperCase(), message, ...details.map(format)].join(' ');
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // Logging must never take the app down.
  }
}

export const log: Logger = {
  info: (message, ...details) => write('info', message, details),
  warn: (message, ...details) => write('warn', message, details),
  error: (message, ...details) => write('error', message, details),
};
