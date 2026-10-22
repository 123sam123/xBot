// Token encryption. The only storage xBot uses for X tokens is Electron's
// safeStorage (the macOS Keychain); this module wraps it without importing
// electron, so tests drive it with a fake. It refuses outright, never falling
// back to plaintext, when encryption is unavailable or, on Linux, when the
// backend is `basic_text` (a hard-coded key, not OS protection). Nothing here
// runs at launch, so listing accounts never triggers a Keychain prompt.

/** The parts of Electron's `safeStorage` this module uses. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
  getSelectedStorageBackend?(): string;
}

export interface TokenVault {
  /** Whether tokens may be stored at all. */
  available(): Promise<boolean>;
  /** Encrypts; throws VaultUnavailableError when `available()` is false. */
  seal(plainText: string): Promise<Buffer>;
  /** Decrypts; `reseal` asks the caller to store a fresh `seal()` of the result. Throws when the blob doesn't decrypt here. */
  open(blob: Buffer): Promise<{ plainText: string; reseal: boolean }>;
}

export class VaultUnavailableError extends Error {
  constructor() {
    super('OS-protected encryption is not available');
    this.name = 'VaultUnavailableError';
  }
}

export function createVault(storage: SafeStorageLike, platform: string): TokenVault {
  async function available(): Promise<boolean> {
    try {
      if (platform === 'linux' && storage.getSelectedStorageBackend?.() === 'basic_text') return false;
      if (!storage.isEncryptionAvailable()) return false;
      return await storage.isAsyncEncryptionAvailable();
    } catch {
      return false;
    }
  }

  return {
    available,
    async seal(plainText) {
      if (!(await available())) throw new VaultUnavailableError();
      return storage.encryptStringAsync(plainText);
    },
    async open(blob) {
      const { result, shouldReEncrypt } = await storage.decryptStringAsync(blob);
      return { plainText: result, reseal: shouldReEncrypt };
    },
  };
}
