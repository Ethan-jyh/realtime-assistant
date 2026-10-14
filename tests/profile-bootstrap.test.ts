import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeProviderProfiles } from "../src/main/settings/bootstrap";
test("initializes profiles and lazy aliases without touching existing ciphertext, repeat startup stable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-bootstrap-"));
  try {
    await writeFile(join(dir, "secrets.vault"), "legacy-cipher");
    const { profiles, aliases } = await initializeProviderProfiles(
      join(dir, "provider-profiles.json"),
      {
        answerProvider: "api",
        model: { baseUrl: "https://example.com", modelName: "test" },
      },
    );
    const primary = profiles.snapshot().profiles[0];
    expect(aliases[`provider:${primary.id}:model`]).toBe("model_key");
    expect(profiles.snapshot().profiles.map((p) => p.answerProvider)).toEqual([
      "api",
      "realtime",
      "codex",
    ]);
    const again = await initializeProviderProfiles(
      join(dir, "provider-profiles.json"),
      { answerProvider: "api" },
    );
    expect(again.profiles.snapshot()).toEqual(profiles.snapshot());
    expect(await readFile(join(dir, "secrets.vault"), "utf8")).toBe(
      "legacy-cipher",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
