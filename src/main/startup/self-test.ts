import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { SecretVault } from "../settings/vault";
import type { DiagnosticsLog } from "../diagnostics/log";
/** Opt-in artifact test: no model calls, recording, or automatic decrypt in the basic probe. */
export async function artifactSelfTest(
  window: BrowserWindow,
  vault: SecretVault,
  log: DiagnosticsLog,
  resources: string,
  checkVault: boolean,
) {
  if (window.webContents.isLoading())
    await new Promise<void>((resolve, reject) => {
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(Error("SELFTEST_RENDER_FAILED"));
      };
      const cleanup = () => {
        window.webContents.off("did-finish-load", loaded);
        window.webContents.off("did-fail-load", failed);
      };
      window.webContents.once("did-finish-load", loaded);
      window.webContents.once("did-fail-load", failed);
    });
  const settings = await window.webContents.executeJavaScript(
    "window.api.getSettings()",
  );
  if (!settings || typeof settings.baseUrl !== "string")
    throw Error("SELFTEST_BRIDGE_FAILED");
  log.write("selftest.window_ready");
  for (const name of ["system-audio", "option-modifier"]) {
    const path = join(resources, name);
    if (!(await stat(path)).isFile()) throw Error("SELFTEST_NATIVE_MISSING");
    await access(path, constants.X_OK);
  }
  log.write("selftest.native_ready");
  if (checkVault) {
    log.write("selftest.vault_started");
    await vault.verifyAccess();
    log.write("selftest.vault_ready");
  }
  log.write("selftest.passed", { enabled: true });
  await log.flush();
}
