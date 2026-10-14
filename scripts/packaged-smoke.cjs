const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const LS =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
async function smokeApp(app, options = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "rea-artifact-probe-"));
  let child,
    pid = null,
    passed = false,
    error = null,
    exitCode = null;
  try {
    if (options.existingVault)
      await fs.copyFile(
        options.existingVault,
        path.join(data, "secrets.vault"),
      );
    const args = [
      "--rea-self-test",
      "--rea-self-test-data=" + data,
      ...(options.existingVault ? ["--rea-self-test-vault"] : []),
    ];
    const launch =
      options.launch ??
      ((app, _data, args) =>
        spawn("/usr/bin/open", ["-n", "-W", app, "--args", ...args], {
          stdio: "ignore",
        }));
    child = await launch(app, data, args);
    child.once("error", () => {
      error = Error("PACKAGED_LAUNCH_FAILED");
    });
    child.once("exit", (code) => {
      exitCode = code;
    });
    const started = Date.now();
    while (Date.now() - started < (options.timeoutMs ?? 20000)) {
      const lines = (
        await fs
          .readFile(path.join(data, "logs/diagnostics.log"), "utf8")
          .catch(() => "")
      )
        .split("\n")
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
      pid = lines.find((x) => x.event === "app.started")?.data.pid ?? pid;
      passed = lines.some((x) => x.event === "selftest.passed");
      if (passed) {
        break;
      }
      if (lines.some((x) => x.event === "selftest.failed"))
        throw Error("PACKAGED_SELFTEST_FAILED");
      if (error) throw error;
      if (exitCode !== null) throw Error("PACKAGED_EARLY_EXIT");
      await new Promise((r) => setTimeout(r, options.pollMs ?? 100));
    }
    if (!passed) {
      if (Number.isSafeInteger(pid) && pid > 1)
        await (
          options.sample ??
          ((pid, file) =>
            execute("/usr/bin/sample", [String(pid), "1", "1", "-file", file]))
        )(pid, path.join(data, "startup.sample.txt")).catch(() => {});
      throw Error("PACKAGED_STARTUP_TIMEOUT");
    }
    console.log(
      "Packaged startup probe passed" +
        (options.existingVault
          ? " (existing ciphertext readable)"
          : " (isolated configuration, no keychain read)"),
    );
    return { passed: true, data };
  } catch (error) {
    throw Error(error.message + "; evidence: " + data);
  } finally {
    if (!passed && Number.isSafeInteger(pid) && pid > 1) {
      await (
        options.stop ??
        (async (pid) => {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
          await new Promise((r) => setTimeout(r, 250));
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        })
      )(pid);
    }
    if (!passed) child?.kill();
    await (
      options.cleanupRegistration ??
      ((app) => execute(LS, ["-u", app]).catch(() => {}))
    )(app);
    if (passed) await fs.rm(data, { recursive: true, force: true });
  }
}
module.exports = { smokeApp };
if (require.main === module) {
  const [app, flag, vault] = process.argv.slice(2);
  if (!app || (flag && flag !== "--existing-vault") || (flag && !vault)) {
    console.error(
      "Usage: node scripts/packaged-smoke.cjs APP [--existing-vault VAULT]",
    );
    process.exitCode = 1;
  } else
    smokeApp(path.resolve(app), {
      existingVault: vault && path.resolve(vault),
    }).catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
