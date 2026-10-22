// Owned by T9 (XBOT-OE2XV9). The `x:*` handlers are the electron-free table in
// services/x/handlers.ts, so tests exercise exactly what is registered here.
import { x } from '../services/x';
import { createXHandlers } from '../services/x/handlers';
import { handle } from './register';

export function registerXIpc(): void {
  for (const { channel, schema, fn } of createXHandlers(x())) handle(channel, schema, fn);
}
