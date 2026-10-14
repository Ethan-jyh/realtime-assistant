import type { CryptoStorageEngine } from "./vault";
interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(
    value: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
/** Never fall back to synchronous safeStorage. Read existing ciphertext without rewriting it. */
export function asyncCrypto(storage: AsyncSafeStorage,onStep?:(stage:'availability'|'encrypt'|'decrypt')=>void): CryptoStorageEngine {
  let availability:Promise<boolean>|null=null;
  return {
    isEncryptionAvailable: () => {
      onStep?.('availability');
      if(!availability){const pending=storage.isAsyncEncryptionAvailable();availability=pending;void pending.catch(()=>{if(availability===pending)availability=null;});}
      return availability;
    },
    encryptString: (value) => {onStep?.('encrypt');return storage.encryptStringAsync(value);},
    decryptString: async (value) => {onStep?.('decrypt');return (await storage.decryptStringAsync(value)).result;},
  };
}
