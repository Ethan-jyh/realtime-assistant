import type { CryptoStorageEngine } from "./vault";
interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(
    value: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
/** Never fall back to synchronous safeStorage. Read existing ciphertext without rewriting it. */
export function asyncCrypto(storage: AsyncSafeStorage): CryptoStorageEngine {
  return {
    isEncryptionAvailable: () => storage.isAsyncEncryptionAvailable(),
    encryptString: (value) => storage.encryptStringAsync(value),
    decryptString: async (value) =>
      (await storage.decryptStringAsync(value)).result,
  };
}
