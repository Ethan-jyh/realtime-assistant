import type { ModelRequestOptions, ModelStreamHandlers } from "./client";
import type { CodexSettings } from "../../settings/extras";
import {
  realtimeEndpoint,
  type RealtimeSettings,
} from "../../settings/profiles";
import { QwenRealtime } from "../realtime/qwen";
interface ApiClient {
  streamChat(
    options: ModelRequestOptions,
    handlers: ModelStreamHandlers,
  ): Promise<void>;
}
interface CodexClient {
  streamChat(
    options: ModelRequestOptions & { codexEffort?: string },
    handlers: ModelStreamHandlers,
  ): Promise<void>;
}
type RealtimeClient = Pick<QwenRealtime, "connect" | "respond" | "close">;
interface RoutingDependencies {
  getSettings(): {
    answerProvider?: "api" | "codex" | "realtime";
    codex?: CodexSettings;
    realtime?: RealtimeSettings;
  };
  api: ApiClient;
  codex: CodexClient;
  translation: CodexClient;
  channel(): RealtimeClient | undefined;
  createRealtime?: (options: {
    endpoint: string;
    modelName: string;
    apiKey: string;
  }) => RealtimeClient;
}
const defaultRealtime = (options: {
  endpoint: string;
  modelName: string;
  apiKey: string;
}) =>
  new QwenRealtime(
    options,
    () => {},
    () => {},
    () => {},
  );
export function createModelRouter(dependencies: RoutingDependencies) {
  return async (
    options: ModelRequestOptions & { realtimeAudio?: boolean },
    handlers: ModelStreamHandlers,
    translation = false,
  ) => {
    const extras = dependencies.getSettings();
    if (extras.answerProvider === "codex")
      return (
        translation ? dependencies.translation : dependencies.codex
      ).streamChat(
        {
          ...options,
          modelName: extras.codex?.modelName ?? "",
          codexEffort: extras.codex?.effort ?? "",
        },
        handlers,
      );
    if (
      extras.answerProvider !== "realtime" ||
      options.messages.some((m) => Array.isArray(m.content))
    )
      return dependencies.api.streamChat(options, handlers);
    if (options.realtimeAudio) {
      const channel = dependencies.channel();
      if (!channel) {
        handlers.onError?.(Error("实时音频未连接"), {
          requestId: options.requestId,
          generation: options.generation,
        });
        return;
      }
      return channel.respond(
        {
          messages: options.messages,
          audio: true,
          signal: options.signal,
          requestId: options.requestId,
          generation: options.generation,
        },
        handlers,
      );
    }
    const config = extras.realtime;
    if (!config?.workspaceId) {
      handlers.onError?.(Error("请填写实时方案的业务空间 ID"), {
        requestId: options.requestId,
        generation: options.generation,
      });
      return;
    }
    const client = (dependencies.createRealtime ?? defaultRealtime)({
      endpoint: realtimeEndpoint(config),
      modelName: config.modelName,
      apiKey: options.apiKey ?? "",
    });
    try {
      await client.connect();
      await client.respond(options, handlers);
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e : Error("REALTIME_FAILED"), {
        requestId: options.requestId,
        generation: options.generation,
      });
    } finally {
      client.close();
    }
  };
}
