import { electronTest } from "./support/electron-test";
import { expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const test = electronTest("vault-startup");
test("legacy vault never blocks startup/settings; async timeout leaves UI responsive and original ciphertext intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vault-startup-")),
    data = join(dir, "data");
  await mkdir(data);
  await writeFile(join(data, "secrets.vault"), "synthetic-old-cipher");
  const boot = join(dir, "main.cjs");
  await writeFile(
    boot,
    `const E=require('electron');E.app.setPath('userData',${JSON.stringify(data)});globalThis.cryptoCalls=0;E.safeStorage.isAsyncEncryptionAvailable=async()=>true;E.safeStorage.decryptStringAsync=()=>{globalThis.cryptoCalls++;return new Promise(()=>{})};E.safeStorage.decryptString=()=>{throw Error('SYNC_CRYPTO_FORBIDDEN')};require(${JSON.stringify(resolve(__dirname, "../out/main/index.js"))});`,
  );
  const app = await electron.launch({ args: [boot] });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "开始面试", exact: true }).waitFor();
    const settings = await page.evaluate(() =>
      (window as any).api.getSettings(),
    );
    expect(settings.vaultStatus).toBe("unchecked");
    expect(await app.evaluate(() => (globalThis as any).cryptoCalls)).toBe(0);
    const request = page.evaluate(() =>
      (window as any).api.askAnswer({
        question: "synthetic question",
        kind: "knowledge",
      }),
    );
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("heading", { name: "回答方案", exact: true })
      .waitFor();
    await request;
    expect(
      await page.evaluate(() =>
        (window as any).api.getSettings().then((s: any) => s.vaultStatus),
      ),
    ).toBe("timeout");
    expect(await readFile(join(data, "secrets.vault"), "utf8")).toBe(
      "synthetic-old-cipher",
    );
    await expect
      .poll(async () => readFile(join(data, "logs/diagnostics.log"), "utf8"))
      .toContain("turn.settled");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
