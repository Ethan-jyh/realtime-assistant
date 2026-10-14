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

test('retries share a pending native initialization rather than accumulating native calls',async()=>{
 const initialize=vi.fn(()=>new Promise<boolean>(()=>{}));
 const engine=asyncCrypto({isAsyncEncryptionAvailable:initialize,encryptStringAsync:async x=>Buffer.from(x),decryptStringAsync:async()=>({result:'',shouldReEncrypt:false})});
 engine.isEncryptionAvailable();engine.isEncryptionAvailable();expect(initialize).toHaveBeenCalledOnce();
});
