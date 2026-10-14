import * as fs from "fs/promises";
import { dirname } from "path";

export interface CryptoStorageEngine {
  isEncryptionAvailable(): boolean | Promise<boolean>;
  encryptString(plainText: string): Buffer | Promise<Buffer>;
  decryptString(cipherText: Buffer): string | Promise<string>;
}

export interface FsDriver {
  readFile(path: string): Promise<Buffer>;
  writeFile(
    path: string,
    data: Buffer,
    options?: { mode?: number },
  ): Promise<void>;
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
  },
};

export type VaultStatus = "unchecked" | "ready" | "timeout" | "locked";
export interface VaultOptions {
  storagePath: string;
  cryptoEngine?: CryptoStorageEngine;
  fsDriver?: FsDriver;
  timeoutMs?: number;
  aliases?: Record<string, string>;
  onStatus?: (status: VaultStatus, durationMs: number) => void;
}
export interface VaultSaveResult {
  persistent: boolean;
}

/** The runtime engine must be genuinely asynchronous; a timer cannot interrupt sync native code. */
export class SecretVault {
  private memoryCache = new Map<string, string>();
  private fs: FsDriver;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readPending: Promise<Record<string, string>> | null = null;
  status: VaultStatus = "unchecked";
  constructor(private options: VaultOptions) {
    this.fs = options.fsDriver ?? defaultFsDriver;
  }

  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error("VAULT_TIMEOUT: 密钥读取超时，请重试或检查钥匙串授权"),
              ),
            this.options.timeoutMs ?? 8000,
          );
        }),
      ]);
      this.status = "ready";
      this.options.onStatus?.(this.status, Date.now() - started);
      return result;
    } catch (error) {
      this.status =
        error instanceof Error && error.message.startsWith("VAULT_TIMEOUT")
          ? "timeout"
          : "locked";
      this.options.onStatus?.(this.status, Date.now() - started);
      throw error instanceof Error && error.message.startsWith("VAULT_TIMEOUT")
        ? error
        : Error("VAULT_READ_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.catch(() => {});
    return result;
  }
  /** Presence metadata is advisory. Legacy encrypted files without an index remain unknown. */
  async keyPresence(keyId: string): Promise<"present" | "absent" | "unknown"> {
    if (this.memoryCache.has(keyId)) return "present";
    if (!(await this.fs.exists(this.options.storagePath))) return "absent";
    try {
      const ids: unknown = JSON.parse(
        (
          await this.fs.readFile(this.options.storagePath + ".index.json")
        ).toString(),
      );
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
        return "unknown";
      if (ids.includes(keyId) || ids.includes(this.options.aliases?.[keyId]))
        return "present";
      return "absent";
    } catch {
      return "unknown";
    }
  }
  async verifyAccess(): Promise<void> {
    await this.bounded(() => this.readPersisted());
  }
  async hasKey(keyId: string): Promise<boolean> {
    return (await this.getKey(keyId)) !== null;
  }
  async getKey(keyId: string): Promise<string | null> {
    if (this.memoryCache.has(keyId)) return this.memoryCache.get(keyId)!;
    if (!this.readPending) {
      const pending = this.bounded(() => this.readPersisted());
      this.readPending = pending;
      void pending
        .finally(() => {
          if (this.readPending === pending) this.readPending = null;
        })
        .catch(() => {});
    }
    const all = await this.readPending;
    const value = all[keyId] ?? all[this.options.aliases?.[keyId] ?? ""];
    if (value) {
      this.memoryCache.set(keyId, value);
      return value;
    }
    return null;
  }
  private async readPersisted(): Promise<Record<string, string>> {
    if (!(await this.fs.exists(this.options.storagePath))) return {};
    const engine = this.options.cryptoEngine;
    if (!engine || !(await engine.isEncryptionAvailable()))
      throw Error("VAULT_LOCKED");
    const cipher = await this.fs.readFile(this.options.storagePath);
    const parsed: unknown = JSON.parse(await engine.decryptString(cipher));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((v) => typeof v !== "string")
    )
      throw Error("INVALID_VAULT");
    return parsed as Record<string, string>;
  }
  private async writePersisted(all: Record<string, string>): Promise<boolean> {
    const engine = this.options.cryptoEngine;
    const encrypted = await this.bounded(async () => {
      if (!engine || !(await engine.isEncryptionAvailable()))
        throw Error("VAULT_LOCKED");
      return await engine.encryptString(JSON.stringify(all));
    });
    // Only the bounded caller may commit. A late native result never reaches this point.
    const path = this.options.storagePath,
      temp = path + ".tmp." + Date.now();
    await this.fs.mkdir(dirname(path));
    if (
      (await this.fs.exists(path)) &&
      !(await this.fs.exists(path + ".before-async"))
    ) {
      await this.fs.writeFile(temp + ".backup", await this.fs.readFile(path), {
        mode: 0o600,
      });
      await this.fs.rename(temp + ".backup", path + ".before-async");
    }
    await this.fs.writeFile(temp, encrypted, { mode: 0o600 });
    await this.fs.rename(temp, path);
    // Remove old metadata before installing the new advisory index; interruption yields unknown.
    await this.fs.unlink(path + ".index.json").catch(() => {});
    await this.fs.writeFile(
      temp + ".index",
      Buffer.from(JSON.stringify(Object.keys(all))),
      { mode: 0o600 },
    );
    await this.fs.rename(temp + ".index", path + ".index.json");
    return true;
  }
  async saveKey(keyId: string, secret?: string): Promise<VaultSaveResult> {
    if (secret === undefined || secret === "")
      return {
        persistent: this.memoryCache.has(keyId) || (await this.hasKey(keyId)),
      };
    this.memoryCache.set(keyId, secret);
    return this.serial(async () => {
      try {
        const all = await this.bounded(() => this.readPersisted());
        all[keyId] = secret;
        return { persistent: await this.writePersisted(all) };
      } catch {
        return { persistent: false };
      }
    });
  }
  async deleteKey(keyId: string): Promise<void> {
    this.memoryCache.delete(keyId);
    return this.serial(async () => {
      try {
        const all = await this.bounded(() => this.readPersisted());
        delete all[keyId];
        const alias = this.options.aliases?.[keyId];
        if (alias) delete all[alias];
        await this.writePersisted(all);
      } catch {
        /* Preserve the previous cipher when unavailable. */
      }
    });
  }
}
