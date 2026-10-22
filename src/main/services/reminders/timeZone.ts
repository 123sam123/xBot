// T8 (XBOT-8V5WV5): the OS time zone, read again on every scheduler tick.
// V8 caches the zone it started with, so a change in System Settings would
// go unnoticed; `/etc/localtime` (a link into the zoneinfo database on macOS
// and Linux) always names the current one. Electron-free.
import { readlinkSync } from 'node:fs';

/** A valid IANA zone in its canonical spelling (Intl may say Asia/Calcutta for Asia/Kolkata), or null. */
export function canonicalZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The zone a `/etc/localtime` link target names (absolute or relative), or null. */
export function zoneFromLink(target: string): string | null {
  const at = target.indexOf('zoneinfo/');
  if (at < 0) return null;
  return canonicalZone(target.slice(at + 'zoneinfo/'.length));
}

export function detectTimeZone(readLink: (path: string) => string = (path) => readlinkSync(path)): string {
  try {
    const zone = zoneFromLink(readLink('/etc/localtime'));
    if (zone) return zone;
  } catch {
    // Not a link (or not there): fall back to what the process was started with.
  }
  return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
}
