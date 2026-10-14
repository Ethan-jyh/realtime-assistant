import { test, expect, vi } from "vitest";
import { createModelRouter } from "../src/main/providers/model/router";
const options = {
  baseUrl: "https://example.com",
  modelName: "api",
  messages: [{ role: "user" as const, content: "synthetic" }],
  sessionId: "s",
  generation: 1,
  requestId: "r",
};
test("routes Codex and screenshot fallback independently from realtime audio", async () => {
  const api = { streamChat: vi.fn(async () => {}) },
    codex = { streamChat: vi.fn(async () => {}) };
  let config: any = {
    answerProvider: "codex",
    codex: { modelName: "official", effort: "low" },
  };
  const route = createModelRouter({
    getSettings: () => config,
    api,
    codex,
    translation: codex,
    channel: () => undefined,
  });
  await route(options, {});
  expect(codex.streamChat).toHaveBeenCalledWith(
    expect.objectContaining({ modelName: "official", codexEffort: "low" }),
    {},
  );
  config = { answerProvider: "realtime" };
  await route(
    {
      ...options,
      messages: [
        { role: "user", content: [{ type: "text", text: "synthetic" }] },
      ],
    },
    {},
  );
  expect(api.streamChat).toHaveBeenCalledOnce();
  const onError = vi.fn();
  await route({ ...options, realtimeAudio: true }, { onError });
  expect(onError).toHaveBeenCalledWith(expect.any(Error), {
    requestId: "r",
    generation: 1,
  });
});
test("one-shot realtime closes transport after failure", async () => {
  const close = vi.fn();
  const route = createModelRouter({
    getSettings: () => ({
      answerProvider: "realtime",
      realtime: {
        workspaceId: "workspace",
        region: "cn-beijing",
        modelName: "qwen-test-realtime",
      },
    }),
    api: { streamChat: async () => {} },
    codex: { streamChat: async () => {} },
    translation: { streamChat: async () => {} },
    channel: () => undefined,
    createRealtime: () => ({
      connect: async () => {
        throw Error("synthetic");
      },
      respond: async () => {},
      close,
    }),
  });
  const onError = vi.fn();
  await route(options, { onError });
  expect(onError).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
