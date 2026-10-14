import { test, expect, vi } from "vitest";
import {
  SecretVault,
  type FsDriver,
  type CryptoStorageEngine,
} from "../src/main/settings/vault";
function fixture(crypto: CryptoStorageEngine, timeoutMs = 30) {
  const files = new Map<string, Buffer>([
    ["/vault", Buffer.from("old-cipher")],
  ]);
  const fs: FsDriver = {
    exists: async (p) => files.has(p),
    readFile: async (p) => files.get(p)!,
    writeFile: async (p, b) => {
      files.set(p, b);
    },
    rename: async (a, b) => {
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    unlink: async (p) => {
      files.delete(p);
    },
    mkdir: async () => {},
  };
  return {
    files,
    vault: new SecretVault({
      storagePath: "/vault",
      cryptoEngine: crypto,
      fsDriver: fs,
      timeoutMs,
    }),
  };
}
test("public presence does not initialize crypto or decrypt legacy vault", async () => {
  const check = vi.fn(() => true),
    decrypt = vi.fn(() => '{"legacy":"secret"}');
  const { vault } = fixture({
    isEncryptionAvailable: check,
    encryptString: (x) => Buffer.from(x),
    decryptString: decrypt,
  });
  expect(await vault.keyPresence("legacy")).toBe("unknown");
  expect(check).not.toHaveBeenCalled();
  expect(decrypt).not.toHaveBeenCalled();
});
test("hung asynchronous keychain returns timeout while event loop stays alive and old cipher is preserved", async () => {
  const { vault, files } = fixture({
    isEncryptionAvailable: async () => true,
    encryptString: async (x) => Buffer.from(x),
    decryptString: () => new Promise<string>(() => {}),
  });
  const tick = vi.fn();
  setTimeout(tick, 1);
  await expect(vault.getKey("legacy")).rejects.toThrow("VAULT_TIMEOUT");
  expect(tick).toHaveBeenCalled();
  expect(files.get("/vault")!.toString()).toBe("old-cipher");
  expect(vault.status).toBe("timeout");
});
test("late decryption is ignored and a retry can succeed", async () => {
  let resolve!: (x: string) => void;
  let calls = 0;
  const { vault } = fixture({
    isEncryptionAvailable: async () => true,
    encryptString: async (x) => Buffer.from(x),
    decryptString: () =>
      ++calls === 1
        ? new Promise<string>((r) => (resolve = r))
        : Promise.resolve('{"legacy":"fresh"}'),
  });
  await expect(vault.getKey("legacy")).rejects.toThrow("VAULT_TIMEOUT");
  resolve('{"legacy":"stale"}');
  expect(await vault.getKey("legacy")).toBe("fresh");
});
test("parallel saves serialize read-modify-write and both keys survive", async () => {
  const { vault, files } = fixture(
    {
      isEncryptionAvailable: async () => true,
      encryptString: async (x) => Buffer.from(x),
      decryptString: async (b) =>
        b.toString() === "old-cipher" ? "{}" : b.toString(),
    },
    200,
  );
  await Promise.all([vault.saveKey("a", "alpha"), vault.saveKey("b", "beta")]);
  expect(JSON.parse(files.get("/vault")!.toString())).toEqual({
    a: "alpha",
    b: "beta",
  });
  expect(await vault.keyPresence("a")).toBe("present");
});
test("timed out save never writes late output and retains only explicitly entered key in memory", async () => {
  let resolve!: (x: Buffer) => void;
  const { vault, files } = fixture({
    isEncryptionAvailable: async () => true,
    encryptString: () => new Promise<Buffer>((r) => (resolve = r)),
    decryptString: async () => '{"legacy":"old"}',
  });
  expect(await vault.saveKey("new", "entered")).toEqual({ persistent: false });
  resolve(Buffer.from("late"));
  await new Promise((r) => setTimeout(r, 2));
  expect(files.get("/vault")!.toString()).toBe("old-cipher");
  expect(await vault.getKey("new")).toBe("entered");
});

test("first async save preserves the original encrypted file for rollback across later saves", async () => {
  const { vault, files } = fixture(
    {
      isEncryptionAvailable: async () => true,
      encryptString: async (x) => Buffer.from(x),
      decryptString: async (b) =>
        b.toString() === "old-cipher" ? "{}" : b.toString(),
    },
    200,
  );
  await vault.saveKey("a", "first");
  expect(files.get("/vault.before-async")!.toString()).toBe("old-cipher");
  await vault.saveKey("b", "second");
  expect(files.get("/vault.before-async")!.toString()).toBe("old-cipher");
});
