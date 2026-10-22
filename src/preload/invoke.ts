import { ipcRenderer } from 'electron';
import type { IpcResult } from '../shared/contracts/ipc';

/** Calls a main-process handler; main always answers with an IpcResult envelope. */
export function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>;
}
