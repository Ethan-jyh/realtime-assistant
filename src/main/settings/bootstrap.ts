import { ProviderProfiles, type ProviderProfile } from "./profiles";
/** Public configuration only. Never reads or migrates encrypted key bytes during startup. */
export async function initializeProviderProfiles(
  path: string,
  current: Omit<ProviderProfile, "id" | "name">,
) {
  const profiles = new ProviderProfiles(path);
  await profiles.initialize(current);
  const initial = profiles.active();
  if (
    profiles.migrated &&
    profiles.snapshot().profiles.length === 1 &&
    initial.answerProvider !== "realtime"
  )
    await profiles.upsert({
      name: "实时问答",
      answerProvider: "realtime",
      model: current.model,
      realtime: {
        workspaceId: "",
        region: "cn-beijing",
        modelName: "qwen3.8-omni-flash-realtime",
      },
    });
  if (!profiles.snapshot().profiles.some((p) => p.answerProvider === "codex"))
    await profiles.upsert({
      name: "GPT-6.1-Sol",
      answerProvider: "codex",
      codex: { modelName: "gpt-6.1-sol", effort: "low" },
    });
  const aliases: Record<string, string> = {};
  const primary = profiles.snapshot().profiles[0];
  for (const kind of ["model", "asr"])
    aliases[`provider:${primary.id}:${kind}`] = kind + "_key";
  const realtime = profiles
    .snapshot()
    .profiles.find(
      (p) => p.name === "实时问答" && p.answerProvider === "realtime",
    );
  if (realtime) {
    aliases[`provider:${realtime.id}:realtime`] = "asr_key";
    aliases[`provider:${realtime.id}:model`] = "model_key";
  }
  return { profiles, aliases };
}
