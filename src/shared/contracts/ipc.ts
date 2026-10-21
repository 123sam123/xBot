// Every IPC call resolves to this envelope; errors are never thrown across IPC.
// The preload bridge returns it as-is, so renderer code checks `ok`.

export type IpcErrorCode = 'forbidden_sender' | 'invalid_payload' | 'internal' | (string & {});

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };
