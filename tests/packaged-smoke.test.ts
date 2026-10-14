import { test, expect } from "vitest";
import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url);
const { smokeApp } = require("../scripts/packaged-smoke.cjs");
const child = () =>
  Object.assign(new EventEmitter(), {
    pid: 123,
    kill: () => true,
    unref: () => {},
  });
test("passing requires explicit artifact readiness, not just app.started", async () => {
  const result = await smokeApp("/fixture.app", {
    timeoutMs: 100,
    pollMs: 2,
    launch: async (_app: string, data: string) => {
      const c = child();
      await mkdir(join(data, "logs"));
      await writeFile(
        join(data, "logs/diagnostics.log"),
        JSON.stringify({ event: "selftest.passed", data: { enabled: true } }) +
          "\n",
      );
      return c;
    },
    cleanupRegistration: async () => {},
  });
  expect(result.passed).toBe(true);
});
test("artifact startup timeout is rejected and supervision collects sample", async () => {
  let sampled = false;
  await expect(
    smokeApp("/fixture.app", {
      timeoutMs: 10,
      pollMs: 2,
      launch: async (_app: string, data: string) => {
        const c = child();
        await mkdir(join(data, "logs"));
        await writeFile(
          join(data, "logs/diagnostics.log"),
          JSON.stringify({ event: "app.started", data: { pid: 123 } }) + "\n",
        );
        return c;
      },
      sample: async () => {
        sampled = true;
      },
      stop: async () => {},
      cleanupRegistration: async () => {},
    }),
  ).rejects.toThrow("PACKAGED_STARTUP_TIMEOUT");
  expect(sampled).toBe(true);
});
