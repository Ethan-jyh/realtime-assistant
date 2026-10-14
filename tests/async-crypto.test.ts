import { test, expect, vi } from "vitest";
import { asyncCrypto } from "../src/main/settings/async-crypto";
test("only official async methods are used and legacy decrypted text is returned unchanged", async () => {
  const decryptStringAsync = vi.fn(async () => ({
    result: "legacy-data",
    shouldReEncrypt: true,
  }));
  const engine = asyncCrypto({
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (x) => Buffer.from(x),
    decryptStringAsync,
  });
  expect(await engine.decryptString(Buffer.from("legacy-cipher"))).toBe(
    "legacy-data",
  );
  expect(decryptStringAsync).toHaveBeenCalledOnce();
});
