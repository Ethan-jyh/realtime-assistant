import * as fs from 'fs/promises';
import { dirname } from 'path';

export interface CryptoStorageEngine {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
}

export interface FsDriver {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer, options?: { mode?: number }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

const defaultFsDriver: FsDriver = {
  readFile: (p) => fs.readFile(p),
  writeFile: (p, d, opts) => fs.writeFile(p, d, { mode: opts?.mode ?? 0o600 }),
  rename: (o, n) => fs.rename(o, n),
  unlink: (p) => fs.unlink(p),
  exists: async (p) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
  mkdir: async (p) => {
    await fs.mkdir(p, { recursive: true });
  }
};

export interface VaultOptions {
  storagePath: string;
  cryptoEngine?: CryptoStorageEngine;
  fsDriver?: FsDriver;
}

export interface VaultSaveResult {
  persistent: boolean;
}

export class SecretVault {
  private memoryCache = new Map<string, string>();
  private storagePath: string;
  private cryptoEngine?: CryptoStorageEngine;
  private fs: FsDriver;

  constructor(options: VaultOptions) {
    this.storagePath = options.storagePath;
    this.cryptoEngine = options.cryptoEngine;
    this.fs = options.fsDriver ?? defaultFsDriver;
  }

  async saveKey(keyId: string, secret?: string): Promise<VaultSaveResult> {
    if (secret === undefined || secret === '') {
      // 修改密钥为空不覆盖已有值
      const exists = this.memoryCache.has(keyId) || (await this.hasKey(keyId));
      return { persistent: exists };
    }

    this.memoryCache.set(keyId, secret);

    const isAvailable = this.cryptoEngine && this.cryptoEngine.isEncryptionAvailable();
    if (!isAvailable) {
      return { persistent: false };
    }

    try {
      // 读出已有持久化字典，合并更新
      const allPersisted = await this.readAllPersisted();
      allPersisted[keyId] = secret;

      const serialized = JSON.stringify(allPersisted);
      const encrypted = this.cryptoEngine!.encryptString(serialized);

      const dir = dirname(this.storagePath);
      await this.fs.mkdir(dir);

      const tempPath = `${this.storagePath}.tmp.${Date.now()}`;
      await this.fs.writeFile(tempPath, encrypted, { mode: 0o600 });
      await this.fs.rename(tempPath, this.storagePath);

      return { persistent: true };
    } catch {
      // 钥匙串拒绝或写入失败时仅内存保留
      return { persistent: false };
    }
  }

  async getKey(keyId: string): Promise<string | null> {
    if (this.memoryCache.has(keyId)) {
      return this.memoryCache.get(keyId)!;
    }

    const allPersisted = await this.readAllPersisted();
    if (allPersisted[keyId]) {
      this.memoryCache.set(keyId, allPersisted[keyId]);
      return allPersisted[keyId];
    }

    return null;
  }

  async hasKey(keyId: string): Promise<boolean> {
    const val = await this.getKey(keyId);
    return val !== null;
  }

  async deleteKey(keyId: string): Promise<void> {
    this.memoryCache.delete(keyId);

    const isAvailable = this.cryptoEngine && this.cryptoEngine.isEncryptionAvailable();
    if (!isAvailable) return;

    try {
      const allPersisted = await this.readAllPersisted();
      if (keyId in allPersisted) {
        delete allPersisted[keyId];
        const serialized = JSON.stringify(allPersisted);
        const encrypted = this.cryptoEngine!.encryptString(serialized);

        const tempPath = `${this.storagePath}.tmp.${Date.now()}`;
        await this.fs.writeFile(tempPath, encrypted, { mode: 0o600 });
        await this.fs.rename(tempPath, this.storagePath);
      }
    } catch {
      // 静默处理清理错误
    }
  }

  private async readAllPersisted(): Promise<Record<string, string>> {
    const isAvailable = this.cryptoEngine && this.cryptoEngine.isEncryptionAvailable();
    if (!isAvailable) return {};

    try {
      const exists = await this.fs.exists(this.storagePath);
      if (!exists) return {};

      const cipher = await this.fs.readFile(this.storagePath);
      const decrypted = this.cryptoEngine!.decryptString(cipher);
      const parsed: unknown = JSON.parse(decrypted);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          Object.values(parsed).some(value => typeof value !== 'string')) {
        throw new Error('INVALID_VAULT');
      }
      return parsed as Record<string, string>;
    } catch {
      throw new Error('VAULT_READ_FAILED');
    }
  }
}
