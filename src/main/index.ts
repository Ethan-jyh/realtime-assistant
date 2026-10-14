import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  desktopCapturer,
  dialog,
  shell,
  net,
} from "electron";
import { join, basename } from "path";
import { initializeProviderProfiles } from "./settings/bootstrap";
import { artifactSelfTest } from "./startup/self-test";
import { SecretVault } from "./settings/vault";
import { TurnTrace } from "./diagnostics/turn-trace";
import { asyncCrypto } from "./settings/async-crypto";
import {
  ModelClient,
  type ModelRequestOptions,
  type ModelStreamHandlers,
} from "./providers/model/client";
import { createModelRouter } from "./providers/model/router";
import { CodexModelClient } from "./providers/model/codex";
import { RequestSlot } from "./runtime/request-slot";
import { registerIpcMainHandlers, rendererOrigins } from "./ipc/register";
import { IPC_CHANNELS } from "../shared/ipc";
import { ModelSettings, completionUrl } from "./settings/model";
import { ModelSettingsStore } from "./settings/store";
import { ExtraSettingsStore } from "./settings/extras";
import {
  ProviderProfiles,
  realtimeEndpoint,
  type ProviderProfile,
} from "./settings/profiles";
import { QwenRealtime } from "./providers/realtime/qwen";
import { MouseThrough } from "./window/mouse-through";
import { ModifierWatch } from "./window/modifier-watch";
import { DesktopMenu } from "./window/desktop-menu";
import { WindowManager } from "./window/manager";
import { CoreSession } from "./session/controller";
import { buildContext } from "./session/context";
import { AliyunAsr } from "./providers/asr/aliyun";
import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { parseDocument } from "./documents/parse";
import { DeepAnswerQueue, type DeepJob } from "./runtime/deep-answer-queue";
import {
  RealtimeRecovery,
  recoverableRealtimeError,
} from "./runtime/realtime-recovery";
import { OverlayShortcuts } from "./window/shortcuts";
import { WindowStateStore } from "./window/state";
import {
  resolveAnswerProvider,
  resolveAnswerThinking,
  isExplicitCorrection,
} from "./runtime/answer-policy";
import { AutoAnswerQueue, type AutoAnswerSegment } from "./runtime/auto-answer";
import {
  DiagnosticsLog,
  diagnosticReason,
  diagnosticLocations,
} from "./diagnostics/log";
import { NativeSystemAudio } from "./audio/system-capture";
import { speakerLabel, isPeerSpeech } from "../shared/speakers";

// Keep the macOS safeStorage identity identical in dev, packaged and validation launches.
app.setName("local-realtime-assistant");
const selfTest = process.argv.includes("--rea-self-test");
if (selfTest) {
  const data = process.argv
    .find((x) => x.startsWith("--rea-self-test-data="))
    ?.slice("--rea-self-test-data=".length);
  if (!data) throw Error("SELFTEST_DATA_REQUIRED");
  app.setPath("userData", data);
}
const ownsInstance = selfTest || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  windowManager?.restoreWindow();
});
app.on("browser-window-created", (_event, window) =>
  window.once("closed", () => {
    for (const name of [
      "show",
      "hide",
      "minimize",
      "maximize",
      "restore",
      "ready-to-show",
    ])
      window.removeAllListeners(name);
  }),
);

let windowManager: WindowManager | null = null;
let vault: SecretVault | null = null;
const requestSlot = new RequestSlot();
let currentAbortController: AbortController | null = null;

let modelSettings: ModelSettings = {
  baseUrl: "https://api.deepseek.com/v1",
  modelName: "deepseek-flash",
};

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  let desktopMenu: DesktopMenu | null = null;
  const diagnostics = new DiagnosticsLog(join(app.getPath("userData"), "logs"));
  diagnostics.write("app.started", {
    pid: process.pid,
    version: app.getVersion(),
  });
  process.on("uncaughtExceptionMonitor", (error) =>
    diagnostics.write("main.uncaught_exception", {
      errorType: error.name,
      locations: diagnosticLocations(error),
    }),
  );

  app.on("browser-window-created", (_event, win) => {
    const mode = () =>
      win === capture
        ? "capture"
        : win === windowManager?.getOverlayWindow()
          ? "overlay"
          : "prepare";
    win.webContents.on("did-start-loading", () =>
      diagnostics.write("renderer.load_start", { mode: mode() }),
    );
    win.webContents.on("did-finish-load", () =>
      diagnostics.write("renderer.load_end", { mode: mode() }),
    );
    win.webContents.on("render-process-gone", (_e, d) =>
      diagnostics.write("renderer.gone", {
        mode: mode(),
        reason: d.reason,
        exitCode: d.exitCode,
      }),
    );
    win.webContents.on("unresponsive", () =>
      diagnostics.write("renderer.unresponsive", { mode: mode() }),
    );
  });
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory");
    app.dock?.hide();
  }
  const desktopResource = (name: string) =>
    app.isPackaged
      ? join(process.resourcesPath, name)
      : join(__dirname, "../../build", name);
  const settingsStore = new ModelSettingsStore(
    join(app.getPath("userData"), "model-settings.json"),
  );
  try {
    modelSettings = (await settingsStore.load()) ?? modelSettings;
  } catch {
    console.warn("Unable to read model settings; using defaults.");
  }
  const extrasStore = new ExtraSettingsStore(
    join(app.getPath("userData"), "assistant-settings.json"),
  );
  let extras = { opacity: 1, asr: null } as Awaited<
    ReturnType<ExtraSettingsStore["load"]>
  >;
  try {
    extras = await extrasStore.load();
  } catch {
    console.warn("Unable to read assistant settings.");
  }
  const preloadPath = join(__dirname, "../preload/index.js");
  const rendererHtmlPath = join(__dirname, "../renderer/index.html");
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  const windowState = new WindowStateStore(
    join(app.getPath("userData"), "window-state.json"),
    () => diagnostics.write("window.position_save_failed"),
  );
  let overlayShortcuts: OverlayShortcuts | undefined;
  windowManager = new WindowManager({
    onOverlayVisibility: (visible) => overlayShortcuts?.setVisible(visible),
    overlayPosition: windowState.load(),
    onOverlayPosition: (position) => windowState.update(position),
    preloadPath,
    rendererUrl,
    rendererHtmlPath,
  });

  windowManager.setOpacity(extras.opacity);
  const vaultPath = join(app.getPath("userData"), "secrets.vault");
  // Chromium follows the macOS system proxy; Node fetch does not.
  const { profiles, aliases } = await initializeProviderProfiles(
    join(app.getPath("userData"), "provider-profiles.json"),
    {
      answerProvider: extras.answerProvider ?? "api",
      model: modelSettings,
      asr: extras.asr,
      codex: extras.codex,
      realtime: extras.realtime,
    },
  );
  const profileKey = (
    kind: "model" | "asr" | "realtime",
    id = profiles.snapshot().activeId,
  ) => `provider:${id}:${kind}`;
  vault = new SecretVault({
    storagePath: vaultPath,
    cryptoEngine: asyncCrypto(safeStorage,(cryptoStage)=>diagnostics.write("vault.access_started",{cryptoStage})),
    aliases,
    onStatus: (vaultState, durationMs) =>
      diagnostics.write("vault.status", { vaultState, durationMs }),
  });
  const configuredKey = async (key: string) =>
    (await vault!.keyPresence(key)) !== "absent";
  const applyProfile = async (value: ProviderProfile) => {
    if (value.model) {
      await settingsStore.save(value.model);
      modelSettings = value.model;
    }
    const next = {
      ...extras,
      answerProvider: value.answerProvider,
      codex: value.codex,
      realtime: value.realtime,
      asr: value.asr ?? null,
    };
    await extrasStore.save(next);
    extras = next;
  };
  await applyProfile(profiles.active());
  const modelClient = new ModelClient(((input, init) =>
    net.fetch(
      input instanceof URL ? input.toString() : input,
      init,
    )) as typeof fetch);
  const codexClient = new CodexModelClient(
    join(app.getPath("userData"), "codex-text"),
  );
  const codexDeep = new CodexModelClient(
    join(app.getPath("userData"), "codex-deep"),
  );
  const codexTranslation = new CodexModelClient(
    join(app.getPath("userData"), "codex-translation"),
  );
  const realtimeChannels = new Map<string, QwenRealtime>();
  const routeModel = createModelRouter({
    getSettings: () => extras,
    api: modelClient,
    codex: codexClient,
    translation: codexTranslation,
    channel: () => realtimeChannels.get("system"),
  });

  let realtimeReady = false;
  const recovery = new RealtimeRecovery();
  const broadcast = (type: string, data: any) => {
    if (
      type === "asr.lifecycle" &&
      data.sourceId === "system" &&
      extras.answerProvider === "realtime"
    ) {
      realtimeReady = data.state === "ready";
      if (realtimeReady) queueMicrotask(drainRealtime);
    }
    if (
      type === "session.state" &&
      data.state === "running" &&
      data.form?.paused
    ) {
      deepQueue.pause(true);
      if (revisionTimer) clearTimeout(revisionTimer);
      revisionTimer = null;
      cancelCurrent(true);
      autoQueue.suspend();
    }
    if (
      type === "transcript.event" &&
      extras.answerProvider !== "realtime" &&
      core.form.auto &&
      core.state === "running" &&
      !core.form.paused &&
      isPeerSpeech(data.sourceId)
    ) {
      if (peerEpoch !== data.streamEpoch) {
        autoQueue.suspend();
        peerEpoch = data.streamEpoch;
      }
      const key = transcriptKey(data);
      lastPeerActivity = Date.now();
      if (data.deleted) {
        autoQueue.discard(key);
        emitQueue();
      } else if (!data.isFinal) {
        autoQueue.speech(key);
        if (revisionTimer) scheduleRevision();
        emitQueue();
      }
    }
    if (type === "session.state" || type === "window.interaction")
      desktopMenu?.refresh();
    if (type === "asr.lifecycle") diagnostics.write("asr.lifecycle", data);
    if (type === "session.state")
      diagnostics.write("session.state", {
        state: data.state,
        paused: !!data.form?.paused,
        auto: !!data.form?.auto,
        count: data.transcripts?.length ?? 0,
      });
    if (type === "session.warning")
      diagnostics.write("session.warning", {
        reason: diagnosticReason(data.message),
        errorCode: data.errorCode ?? String(data.message),
      });
    windowManager?.getPrepareWindow()?.webContents.send(type, data);
    windowManager?.getOverlayWindow()?.webContents.send(type, data);
  };
  const mouseMode = new MouseThrough((state) => {
    windowManager!.setMouseIgnoring(
      state.ignoring,
      state.enabled && state.available,
    );
    broadcast("window.interaction", state);
    diagnostics.write("window.mouse_mode", { ...state });
  });
  const modifierPath = app.isPackaged
    ? join(process.resourcesPath, "option-modifier")
    : join(app.getAppPath(), "build/option-modifier");
  const modifierWatch = new ModifierWatch(
    modifierPath,
    (held) => mouseMode.pulse(held),
    () => mouseMode.failed(),
  );
  const setMouseThrough = async (enabled: boolean) => {
    mouseMode.enable(enabled);
    if (enabled && process.platform === "darwin") modifierWatch.start();
    else if (process.platform !== "darwin") mouseMode.failed();
    extras = { ...extras, mouseThrough: enabled };
    await extrasStore.save(extras);
    return mouseMode.state;
  };
  mouseMode.enable(extras.mouseThrough ?? true);
  if (process.platform === "darwin") modifierWatch.start();
  let translationAbort: AbortController | null = null;
  let translationId = 0;

  let capture: BrowserWindow | null = null;
  let captureToken: string | null = null;
  let captureSources = new Set<string>();
  let captureCommandId: string | null = null;
  let captureWait: {
    commandId: string;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null = null;
  let capturePageReady: {
    resolve: () => void;
    reject: (e: Error) => void;
  } | null = null;
  let sessionAttempt = 0;
  let stopping: Promise<any> | null = null;
  let stoppingCapture: Promise<void> | null = null;
  let captureStopped: (() => void) | null = null;
  const historyRoot = join(app.getPath("userData"), "sessions");
  const transcriptKey = (segment: {
    sourceId: string;
    streamEpoch: number;
    segmentId: string;
  }) => `${segment.sourceId}:${segment.streamEpoch}:${segment.segmentId}`;
  const safeKey = (id: string) =>
    createHash("sha256")
      .update(`${core.id ?? "none"}:${id}`)
      .digest("hex")
      .slice(0, 16);
  const offeredAt = new Map<string, number>();
  let activeAutomatic: {
    requestId: string;
    generation: number;
    segments: AutoAnswerSegment[];
  } | null = null;
  let revisionTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPeerActivity = 0;
  let peerEpoch: number | null = null;
  const emitQueue = () =>
    broadcast("answer.queue", {
      pending: autoQueue.snapshot.length + realtimePending.length,
      busy: !requestSlot.isDone(),
    });
  let fastTrace: TurnTrace | null = null;
  const cancelCurrent = (restore: boolean, reason = "interrupted") => {
    fastTrace?.settle("cancelled");
    if (restore && activeAutomatic) autoQueue.requeue(activeAutomatic.segments);
    const previous = core.answers.findLast(
      (x) => x.state === "generating" && x.lane !== "deep",
    );
    if (restore && previous?.audioItems?.length)
      realtimePending = [
        ...new Set([...previous.audioItems, ...realtimePending]),
      ];
    if (previous) {
      previous.state = "cancelled";
      previous.finishReason = reason;
      previous.sequence = (previous.sequence ?? 0) + 1;
      broadcast("answer.event", {
        text: "",
        status: {
          state: "cancelled",
          requestId: previous.requestId,
          finishReason: reason,
          sequence: previous.sequence,
        },
      });
    }
    requestSlot.cancel();
    currentAbortController?.abort();
    currentAbortController = null;
    activeAutomatic = null;
    autoQueue.completed();
    emitQueue();
  };
  const scheduleRevision = () => {
    if (revisionTimer) clearTimeout(revisionTimer);
    revisionTimer = setTimeout(() => {
      revisionTimer = null;
      if (
        !activeAutomatic ||
        requestSlot.isDone() ||
        core.form.paused ||
        !core.form.auto
      )
        return;
      if (Date.now() - lastPeerActivity < 900) {
        scheduleRevision();
        return;
      }
      if (
        autoQueue.snapshot.some((entry) => isExplicitCorrection(entry.text))
      ) {
        diagnostics.write("answer.revised", {
          generation: activeAutomatic.generation,
        });
        cancelCurrent(true, "revised");
      }
    }, 900);
  };
  const autoQueue = new AutoAnswerQueue(
    (question, segments = [], turnId) => {
      const kind =
        /项目|经历|简历|介绍自己|实习|project|experience|yourself/i.test(
          question,
        )
          ? "profile"
          : "knowledge";
      const times = segments.map((x) => offeredAt.get(x.id) ?? Date.now());
      diagnostics.write("answer.dispatched", {
        count: segments.length,
        turn: Number(turnId?.split("-").at(-1)),
        queueWaitMs: Date.now() - Math.min(...times),
        segmentKeys: segments.map((x) => safeKey(x.id)),
      });
      emitQueue();
      const ownerSession = core.id,
        ownerGeneration = requestSlot.getCurrent() + 1;
      void handlers[IPC_CHANNELS.ANSWER_ASK]({
        question,
        kind,
        automatic: true,
        autoSegments: segments,
        traceTurnId: turnId,
        enqueuedAt: times.length ? Math.min(...times) : Date.now(),
      }).catch(() => {
        if (core.id !== ownerSession || !requestSlot.accept(ownerGeneration))
          return;
        autoQueue.requeue(segments);
        core.form.auto = false;
        autoQueue.suspend();
        cancelCurrent(false);
        autoQueue.completed();
        emitQueue();
        broadcast("session.state", core.snapshot());
        diagnostics.write("answer.auto_failed");
        broadcast("session.warning", {
          message: "自动回答失败，待答问题已保留；请检查连接后重新开启自动回答",
        });
      });
    },
    () =>
      core.state === "running" &&
      !!core.form.auto &&
      !core.form.paused &&
      requestSlot.isDone(),
  );
  let realtimePending: string[] = [];
  let realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const missingReplay = new Set<string>();
  const drainRealtime = () => {
    if (
      extras.answerProvider !== "realtime" ||
      !realtimeReady ||
      !realtimePending.length ||
      core.state !== "running" ||
      core.form.paused ||
      !core.form.auto ||
      !requestSlot.isDone()
    )
      return;
    const channel = realtimeChannels.get("system");
    const confirmed = new Map(
      core.segments
        .filter((x) => x.sourceId === "system" && x.isFinal)
        .map((x) => [x.segmentId, x.text]),
    );
    const replay = realtimePending.filter(
      (id) => !channel?.ownsTurn(id) && confirmed.has(id),
    );
    const items = replay.length
      ? replay
      : realtimePending.filter((id) => channel?.ownsTurn(id));
    for (const id of realtimePending)
      if (
        !channel?.ownsTurn(id) &&
        !confirmed.has(id) &&
        !missingReplay.has(id)
      ) {
        missingReplay.add(id);
        broadcast("session.warning", {
          message: "断线前有语音尚未完成转写，已保留待答标记；请重新说出该问题",
        });
      }
    if (!items.length) return;
    realtimePending = realtimePending.filter((id) => !items.includes(id));
    const text = items
      .map((id) => confirmed.get(id) ?? "")
      .filter(Boolean)
      .join("\n");
    const question = text || "对方的语音问题";
    const nativeAudio = items.every((id) => channel?.ownsTurn(id));
    void handlers[IPC_CHANNELS.ANSWER_ASK]({
      question,
      kind: "knowledge",
      automatic: true,
      realtimeAudio: nativeAudio,
      audioItems: items,
    }).catch(() => {
      realtimePending.unshift(...items);
      core.form.auto = false;
      broadcast("session.state", core.snapshot());
    });
  };
  let deepGeneration = 0;
  const deepQueue = new DeepAnswerQueue(
    async (job: DeepJob, signal: AbortSignal, complete: () => void) => {
      const profile = profiles
        .snapshot()
        .profiles.find(
          (p) =>
            p.id === extras.deepProfileId && p.answerProvider !== "realtime",
        );
      if (!profile || signal.aborted) return;
      const owner = core.id,
        generation = ++deepGeneration,
        requestId = randomUUID(),
        startedAt = Date.now();
      const trace = new TurnTrace(diagnostics, {
        sessionId: owner ?? "manual",
        turnId: job.traceTurnId ?? requestId,
        requestId,
        lane: "deep",
        enqueuedAt: job.enqueuedAt,
      });
      trace.mark("credentials");
      const record = {
        requestId,
        lane: "deep",
        question: job.question,
        text: "",
        state: "generating",
        kind: job.kind,
        sequence: 0,
        error: "",
        finishReason: "",
        automatic: !!job.automatic,
      };
      if (owner) core.answers.push(record);
      const emit = (state: string, text = "") =>
        broadcast("answer.event", {
          text,
          status: {
            state,
            lane: "deep",
            requestId,
            sequence: record.sequence,
            question: record.question,
            error: record.error,
            finishReason: record.finishReason,
            automatic: record.automatic,
          },
        });
      let terminal = false;
      const finish = (reason: string, error?: Error) => {
        if (terminal) return;
        terminal = true;
        trace.settle(
          error
            ? diagnosticReason(error) === "timeout"
              ? "timeout"
              : "error"
            : reason === "interrupted"
              ? "cancelled"
              : "completed",
        );
        complete();
        record.sequence++;
        record.finishReason = reason;
        record.state = error
          ? "failed"
          : reason === "interrupted"
            ? "cancelled"
            : "completed";
        record.error = error?.message ?? "";
        emit(error ? "error" : record.state);
        diagnostics.write("deep.finished", {
          generation,
          reason: error ? diagnosticReason(error) : reason,
          durationMs: Date.now() - startedAt,
        });
      };
      emit("started");
      diagnostics.write("deep.started", {
        generation,
        automatic: !!job.automatic,
        provider: profile.answerProvider,
      });
      const onAbort = () => finish("interrupted");
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const key =
          profile.answerProvider === "api"
            ? ((await vault?.getKey(profileKey("model", profile.id))) ??
              undefined)
            : undefined;
        if (signal.aborted || owner !== core.id) return;
        if (profile.answerProvider === "api" && !profile.model)
          throw Error("深度模型尚未配置");
        const form = owner
          ? {
              ...core.form,
              customPrompt:
                core.state === "running"
                  ? core.form.customPrompt
                  : (extras.profile?.customPrompt ?? core.form.customPrompt),
            }
          : (extras.profile ?? {});
        const messages = buildContext(
          form,
          owner ? core.segments : [],
          job.question,
          job.kind,
          core.answers.filter((a) => a.lane === "deep"),
          !job.image,
        ).map((m, index, items) =>
          job.image && index === items.length - 1
            ? {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: job.question },
                  { type: "image_url" as const, image_url: { url: job.image } },
                ],
              }
            : m,
        );
        trace.mark("context");
        diagnostics.write("deep.context", {
          generation,
          transcriptCount: core.segments.filter((x) => x.isFinal).length,
          messageCount: messages.length,
          hasImage: !!job.image,
        });
        const options = {
          baseUrl: profile.model?.baseUrl ?? "",
          modelName:
            profile.answerProvider === "codex"
              ? (profile.codex?.modelName ?? "")
              : profile.model!.modelName,
          apiKey: key,
          messages,
          sessionId: owner ?? "manual-deep",
          generation,
          requestId,
          signal,
          ...resolveAnswerThinking(
            "api",
            profile.model?.baseUrl ?? "",
            profile.model?.modelName ?? "",
            !!job.image,
          ),
        };
        const callbacks: ModelStreamHandlers = {
          onRequest: (attempt) => trace.upstream(attempt),
          onResponse: () => trace.mark("headers"),
          onToken: (token) => {
            trace.firstOutput(token);
            if (terminal || signal.aborted || owner !== core.id) return;
            if (!record.text)
              diagnostics.write("deep.first_output", {
                generation,
                durationMs: Date.now() - startedAt,
              });
            record.text += token;
            record.sequence++;
            emit("streaming", token);
          },
          onFinish: (reason) => finish(reason),
          onError: (error) => finish("error", error),
        };
        if (profile.answerProvider === "codex")
          await codexDeep.streamChat(
            { ...options, codexEffort: profile.codex?.effort ?? "" },
            callbacks,
          );
        else await modelClient.streamChat(options, callbacks);
      } catch (error) {
        finish("error", error instanceof Error ? error : Error("深度回答失败"));
      } finally {
        signal.removeEventListener("abort", onAbort);
        if (!terminal) finish("interrupted");
      }
    },
  );
  const offerDeep = (job: DeepJob) => {
    if (!extras.deepProfileId) return;
    const queuedJob = {
      ...job,
      enqueuedAt: job.enqueuedAt ?? Date.now(),
      traceTurnId: job.traceTurnId ?? randomUUID(),
    };
    diagnostics.write("deep.queued", {
      turnKey: safeKey(queuedJob.traceTurnId),
      lane: "deep",
    });
    deepQueue.offer(queuedJob);
  };
  const core = new CoreSession(
    historyRoot,
    broadcast,
    (text, segment) => {
      if (
        core.state === "running" &&
        !core.form.paused &&
        core.form.auto &&
        isPeerSpeech(segment.sourceId)
      )
        offerDeep({ question: text, kind: "knowledge", automatic: true });
      diagnostics.write("asr.final", {
        sourceId: segment.sourceId,
        epoch: segment.streamEpoch,
        segmentKeys: [safeKey(transcriptKey(segment))],
      });
      if (
        core.form.translation &&
        core.state === "running" &&
        !core.form.paused
      ) {
        translationAbort?.abort();
        const controller = (translationAbort = new AbortController()),
          id = ++translationId;
        let translated = "";
        void (
          extras.answerProvider === "codex"
            ? Promise.resolve(undefined)
            : (vault?.getKey(profileKey("model")) ?? Promise.resolve(undefined))
        )
          .then((key) =>
            routeModel(
              {
                baseUrl: modelSettings.baseUrl,
                modelName: modelSettings.modelName,
                apiKey: key ?? undefined,
                messages: buildContext(
                  core.form,
                  core.segments,
                  text,
                  "translate",
                ),
                sessionId: core.id!,
                generation: id,
                requestId: "translation-" + id,
                signal: controller.signal,
              },
              {
                onToken: (token) => {
                  if (id !== translationId || core.state !== "running") return;
                  translated += token;
                  broadcast("translation.event", {
                    ...segment,
                    translation: translated,
                  });
                },
                onError: () =>
                  broadcast("session.warning", { message: "实时翻译失败" }),
              },
              true,
            ),
          )
          .catch(() =>
            broadcast("session.warning", { message: "实时翻译配置不可用" }),
          );
      }
      if (extras.answerProvider === "realtime") {
        if (segment.sourceId === "microphone")
          realtimeChannels.get("system")?.addContext("[我] " + text);
        const answer =
          segment.sourceId === "system"
            ? core.answers.findLast((a) =>
                a.audioItems?.includes(segment.segmentId),
              )
            : undefined;
        if (answer) {
          answer.question =
            core.segments
              .filter(
                (x) =>
                  x.sourceId === "system" &&
                  answer.audioItems.includes(x.segmentId) &&
                  x.isFinal,
              )
              .map((x) => x.text)
              .join("\n") || answer.question;
          answer.sequence++;
          broadcast("answer.event", {
            text: "",
            question: answer.question,
            status: {
              state: "question",
              requestId: answer.requestId,
              question: answer.question,
              sequence: answer.sequence,
            },
          });
        }
        if (segment.sourceId === "system") queueMicrotask(drainRealtime);
        return;
      }
      if (
        !core.form.auto ||
        core.form.paused ||
        core.state !== "running" ||
        !isPeerSpeech(segment.sourceId)
      )
        return;
      const key = transcriptKey(segment);
      offeredAt.set(key, Date.now());
      autoQueue.offer(text, key);
      diagnostics.write("answer.queued", {
        count: core.segments.length,
        pendingCount: autoQueue.snapshot.length,
        segmentKeys: [safeKey(key)],
      });
      emitQueue();
      if (activeAutomatic && isExplicitCorrection(text)) scheduleRevision();
    },
    (source, options, onResult, onError) => {
      if (extras.answerProvider !== "realtime")
        return new AliyunAsr(options, onResult, onError);
      realtimeChannels.get(source)?.close("reconnecting");
      const client = new QwenRealtime(
        options,
        onResult,
        onError,
        (item) => {
          if (
            source !== "system" ||
            core.state !== "running" ||
            core.form.paused ||
            !core.form.auto
          )
            return;
          realtimePending.push(item);
          diagnostics.write("realtime.committed", {
            sourceId: source,
            pendingCount: realtimePending.length,
          });
          emitQueue();
          drainRealtime();
        },
        (error) =>
          broadcast("session.warning", {
            sourceId: source,
            message: error.message,
            errorCode: error.message,
          }),
      );
      realtimeChannels.set(source, client);
      return client;
    },
  );
  const systemAudioPath = app.isPackaged
    ? join(process.resourcesPath, "system-audio")
    : join(app.getAppPath(), "build/system-audio");
  const systemAudio = new NativeSystemAudio({
    executable: systemAudioPath,
    onPcm: (samples) => {
      if (
        !captureToken ||
        !capture ||
        capture.isDestroyed() ||
        core.state !== "running" ||
        core.form.paused
      )
        return;
      capture.webContents.send("capture.system.pcm", {
        token: captureToken,
        samples,
      });
    },
    onError: (error) => {
      diagnostics.write("capture.native_error", {
        stage: error.code.replace(/^SYSTEM_AUDIO_/, "").toLowerCase(),
        status: error.status,
        reason: diagnosticReason(error),
      });
      captureWait?.reject(error);
      if (core.state === "running" && !stopping) {
        capture?.webContents.send("capture.command", {
          action: "pause",
          paused: true,
        });
        void core.setPaused(true).catch(() => {});
        broadcast("session.warning", {
          message: "系统音频已断开，请点击继续重试。" + error.message,
        });
      }
    },
  });
  const dragTokens = new Map<string, { token: string; windowId: number }>();
  const pendingDocuments = new Map<string, { name: string; text: string }>();
  const historyRecord = async (id: string) =>
    JSON.parse(await readFile(join(historyRoot, id, "session.json"), "utf8"));
  const stopCapture = (): Promise<void> => {
    if (stoppingCapture) return stoppingCapture;
    const target = capture;
    if (!target || target.isDestroyed()) {
      capture = null;
      captureToken = null;
      return systemAudio.stop();
    }
    const job = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            captureStopped = resolve;
            target.webContents.send("capture.command", { action: "stop" });
          }),
          new Promise<void>((r) => {
            timer = setTimeout(r, 1500);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        await systemAudio.stop();
        if (!target.isDestroyed()) target.destroy();
        if (capture === target) {
          capture = null;
          captureToken = null;
          captureStopped = null;
        }
      }
    })();
    stoppingCapture = job;
    void job
      .finally(() => {
        if (stoppingCapture === job) stoppingCapture = null;
      })
      .catch(() => {});
    return job;
  };
  const stopSession = (): Promise<any> => {
    if (stopping) return stopping;
    deepQueue.stop();
    sessionAttempt++;
    captureCommandId = null;
    realtimePending = [];
    recovery.clear();
    missingReplay.clear();
    realtimeReady = false;
    if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = null;
    capturePageReady?.reject(Error("SESSION_CANCELLED"));
    capturePageReady = null;
    captureWait?.reject(Error("SESSION_CANCELLED"));
    captureWait = null;
    if (revisionTimer) clearTimeout(revisionTimer);
    revisionTimer = null;
    cancelCurrent(false);
    autoQueue.clear();
    offeredAt.clear();
    emitQueue();
    translationAbort?.abort();
    translationId++;
    currentAbortController?.abort();
    requestSlot.cancel();
    const job = (async () => {
      await stopCapture();
      await core.stop();
      return { ok: true, recordingSaved: core.recordingSaved };
    })();
    stopping = job;
    void job
      .finally(() => {
        if (stopping === job) stopping = null;
      })
      .catch(() => {});
    return job;
  };
  const withDeadline = async (
    promise: Promise<void>,
    ms: number,
    message: string,
  ) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(message)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let settingsRequested = false;
  const openSettings = () => {
    settingsRequested = true;
    const win = windowManager!.createPrepareWindow();
    if (!win.webContents.isLoading()) win.webContents.send("prepare.settings");
  };
  const handlers: Record<string, (payload: any) => Promise<any> | any> = {
    [IPC_CHANNELS.DIAGNOSTICS]: async (payload) => {
      await diagnostics.flush();
      if (payload.action === "open") {
        await mkdir(diagnostics.directory, { recursive: true, mode: 0o700 });
        const error = await shell.openPath(diagnostics.directory);
        if (error) throw Error("LOG_DIRECTORY_OPEN_FAILED");
      }
      return { directory: diagnostics.directory };
    },
    [IPC_CHANNELS.TELEMETRY]: (payload) => {
      diagnostics.write(payload.event, payload.data);
      return { ok: true };
    },
    [IPC_CHANNELS.DOCUMENT_PICK]: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "资料文件", extensions: ["txt", "docx", "pdf"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const path = result.filePaths[0],
        text = await parseDocument(path),
        token = randomUUID(),
        doc = { name: basename(path), text };
      pendingDocuments.set(token, doc);
      return { token, ...doc, truncated: text.length >= 200000 };
    },
    [IPC_CHANNELS.DOCUMENT_CONFIRM]: (payload) => {
      const doc = pendingDocuments.get(payload.token);
      if (!doc) throw Error("DOCUMENT_TOKEN_EXPIRED");
      pendingDocuments.delete(payload.token);
      if (core.id)
        core.form.documents =
          String(core.form.documents ?? "") + "\n" + doc.text;
      return { ok: true };
    },
    [IPC_CHANNELS.CAPTURE_QUESTION]: async (payload) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (!sources[0] || sources[0].thumbnail.isEmpty())
        throw Error("屏幕采集失败，请检查屏幕录制权限");
      return handlers[IPC_CHANNELS.ANSWER_ASK]({
        question: payload.question,
        image: sources[0].thumbnail.toDataURL(),
        kind: "knowledge",
      });
    },
    [IPC_CHANNELS.SESSION_GET]: () => ({
      ...core.snapshot(),
      pendingQuestions: autoQueue.snapshot.length + realtimePending.length,
    }),
    [IPC_CHANNELS.SESSION_START]: async (payload) => {
      if (stopping || ["starting", "running", "stopping"].includes(core.state))
        throw Error("SESSION_ALREADY_ACTIVE");
      deepQueue.stop();
      deepQueue.setAutomatic(!!payload.form.auto);
      deepQueue.resume();
      const attempt = ++sessionAttempt;
      const check = () => {
        if (attempt !== sessionAttempt) throw Error("SESSION_CANCELLED");
      };
      const key = await vault?.getKey(
        profileKey(extras.answerProvider === "realtime" ? "realtime" : "asr"),
      );
      check();
      const asr =
        extras.answerProvider === "realtime"
          ? extras.realtime?.workspaceId && key
            ? {
                endpoint: realtimeEndpoint(extras.realtime),
                modelName: extras.realtime.modelName,
                apiKey: key,
              }
            : null
          : extras.asr && key
            ? { ...extras.asr, apiKey: key }
            : null;
      realtimePending = [];
      recovery.clear();
      missingReplay.clear();
      realtimeReady = false;
      if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
      realtimeRetryTimer = null;
      if (revisionTimer) clearTimeout(revisionTimer);
      revisionTimer = null;
      cancelCurrent(false);
      autoQueue.clear();
      offeredAt.clear();
      emitQueue();
      try {
        const id = await core.start(
          { ...payload.form, auto: !!payload.form.auto },
          payload.sources,
          asr,
          payload.recordAudio,
        );
        check();
        if (payload.form.audioEnabled === false) {
          windowManager!.createOverlayWindow(true);
          return { id };
        }
        captureSources = new Set(payload.sources);
        const token = (captureToken = randomUUID());
        const target = (capture = new BrowserWindow({
          show: false,
          hasShadow: false,
          webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        }));
        target.webContents.once("render-process-gone", () => {
          if (capture === target) {
            captureWait?.reject(Error("CAPTURE_RENDERER_GONE"));
            void systemAudio.stop();
            void stopSession().catch(() => {});
            broadcast("session.warning", {
              message: "音频采集进程已退出，请重新开始会话",
            });
          }
        });
        target.once("closed", () => {
          if (capture === target && !stoppingCapture) {
            void stopSession().catch(() => {});
          }
        });
        const pageReady = new Promise<void>((resolve, reject) => {
          capturePageReady = { resolve, reject };
        });
        void pageReady.catch(() => {});
        if (rendererUrl)
          await target.loadURL(
            rendererUrl + "?captureToken=" + token + "#/capture",
          );
        else
          await target.loadFile(rendererHtmlPath, {
            hash: "/capture",
            query: { captureToken: token },
          });
        check();
        await withDeadline(pageReady, 5000, "CAPTURE_PAGE_TIMEOUT");
        check();
        capturePageReady = null;
        const commandId = (captureCommandId = randomUUID());
        const ready = new Promise<void>((resolve, reject) => {
          captureWait = { commandId, resolve, reject };
        });
        target.webContents.send("capture.command", {
          action: "start",
          commandId,
          token,
          sources: payload.sources,
          deviceId: payload.form.deviceId,
        });
        await withDeadline(ready, 20000, "CAPTURE_START_TIMEOUT");
        check();
        captureWait = null;
        windowManager!.createOverlayWindow(true);
        return { id };
      } catch (e) {
        if (attempt === sessionAttempt) await stopSession();
        throw e;
      }
    },
    [IPC_CHANNELS.SESSION_UPDATE]: async (payload) => {
      if (payload.paused !== undefined) {
        diagnostics.write("capture.pause_requested", {
          paused: payload.paused,
        });
        const id = core.id;
        if (payload.paused) {
          deepQueue.pause(true);
          cancelCurrent(true);
          autoQueue.suspend();
          translationAbort?.abort();
          translationId++;
          captureCommandId = null;
          captureWait?.reject(Error("CAPTURE_CANCELLED"));
          captureWait = null;
          capture?.webContents.send("capture.command", {
            action: "pause",
            paused: true,
          });
          await Promise.all([systemAudio.stop(), core.setPaused(true)]);
        } else {
          await core.setPaused(false);
          if (capture && !capture.isDestroyed()) {
            const commandId = (captureCommandId = randomUUID());
            const ready = new Promise<void>((resolve, reject) => {
              captureWait = { commandId, resolve, reject };
            });
            capture.webContents.send("capture.command", {
              action: "pause",
              commandId,
              paused: false,
            });
            try {
              await withDeadline(ready, 20000, "音频恢复超时，请点击继续重试");
            } catch (e) {
              if (
                captureCommandId === commandId &&
                core.id === id &&
                core.state === "running" &&
                !stopping
              ) {
                captureCommandId = null;
                capture?.webContents.send("capture.command", {
                  action: "pause",
                  paused: true,
                });
                await Promise.all([systemAudio.stop(), core.setPaused(true)]);
              }
              throw e;
            } finally {
              if (captureWait?.commandId === commandId) captureWait = null;
            }
          }
        }
      }
      if (payload.auto !== undefined) deepQueue.setAutomatic(payload.auto);
      if (payload.auto === false) {
        if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
        realtimeRetryTimer = null;
        if (revisionTimer) clearTimeout(revisionTimer);
        revisionTimer = null;
        autoQueue.suspend();
      }
      core.form = {
        ...core.form,
        ...payload.form,
        ...(payload.auto === undefined ? {} : { auto: payload.auto }),
      };
      if (!core.form.paused && (core.form.auto || payload.paused === false))
        deepQueue.resume();
      autoQueue.retry();
      drainRealtime();
      emitQueue();
      broadcast("session.state", core.snapshot());
      return { ok: true };
    },
    [IPC_CHANNELS.SESSION_STOP]: stopSession,
    [IPC_CHANNELS.CAPTURE_PCM]: (payload) => {
      if (payload.token !== captureToken) throw Error("INVALID_CAPTURE_TOKEN");
      if (core.form.paused) return { sent: false };
      return { sent: core.pcm(payload.sourceId, payload.bytes) };
    },
    [IPC_CHANNELS.CAPTURE_STATUS]: (payload) => {
      if (payload.token !== captureToken) throw Error("INVALID_CAPTURE_TOKEN");
      if (
        ["running", "failed"].includes(payload.state) &&
        payload.commandId !== captureCommandId
      )
        return { ignored: true };
      diagnostics.write("capture.status", {
        state: payload.state,
        ...(payload.state === "failed"
          ? { reason: diagnosticReason(payload.message) }
          : {}),
      });
      if (payload.state === "ready") capturePageReady?.resolve();
      if (payload.state === "running") captureWait?.resolve();
      if (payload.state === "failed")
        captureWait?.reject(Error(payload.message ?? "CAPTURE_FAILED"));
      if (payload.state === "stopped") captureStopped?.();
      if (payload.state === "warning" || payload.state === "failed")
        broadcast("session.warning", { message: payload.message });
      return { ok: true };
    },
    [IPC_CHANNELS.SYSTEM_AUDIO]: async (payload) => {
      if (payload.token !== captureToken) throw Error("INVALID_CAPTURE_TOKEN");
      if (payload.action === "stop") {
        await systemAudio.stop();
        diagnostics.write("capture.native_stopped");
        return { ok: true };
      }
      if (process.platform !== "darwin")
        throw Error("纯系统音频采集目前支持 macOS 14.2 及以上");
      if (
        core.state !== "running" ||
        core.form.paused ||
        !captureSources.has("system")
      )
        throw Error("SYSTEM_AUDIO_NOT_REQUESTED");
      try {
        await systemAudio.start();
      } catch (error: any) {
        diagnostics.write("capture.native_error", {
          stage: error.code?.replace(/^SYSTEM_AUDIO_/, "").toLowerCase(),
          status: error.status,
          reason: diagnosticReason(error),
        });
        throw Error(
          "系统音频启动失败：" +
            error.message +
            (error.status === undefined
              ? ""
              : "（状态码 " + error.status + "）"),
        );
      }
      diagnostics.write("capture.native_started", { sampleRate: 16000 });
      return { ok: true };
    },
    [IPC_CHANNELS.HISTORY_LIST]: async () => {
      const ids = await readdir(historyRoot).catch(() => []);
      const records = [];
      for (const id of ids) {
        if (!/^[0-9a-f-]{36}$/.test(id)) continue;
        try {
          const value = await historyRecord(id);
          records.push({
            id,
            state: value.state,
            startedAt: value.startedAt,
            endedAt: value.endedAt,
            form: value.form,
          });
        } catch {}
      }
      return records.sort((a, b) => b.startedAt - a.startedAt);
    },
    [IPC_CHANNELS.HISTORY_GET]: (payload) => historyRecord(payload.sessionId),
    [IPC_CHANNELS.HISTORY_AUDIO]: async (payload) => {
      const file = join(
        historyRoot,
        payload.sessionId,
        payload.sourceId + ".wav",
      );
      const { stat } = await import("node:fs/promises");
      if ((await stat(file)).size > 50 * 1024 * 1024) return { large: true };
      return { bytes: new Uint8Array(await readFile(file)) };
    },
    [IPC_CHANNELS.HISTORY_REVEAL]: (payload) =>
      shell.openPath(join(historyRoot, payload.sessionId)),
    [IPC_CHANNELS.HISTORY_DELETE]: async (payload) => {
      const trash = join(historyRoot, "trash");
      await mkdir(trash, { recursive: true });
      await rename(
        join(historyRoot, payload.sessionId),
        join(trash, payload.sessionId + "-" + Date.now()),
      );
      return { ok: true };
    },
    [IPC_CHANNELS.HISTORY_EXPORT]: async (payload) => {
      const record = await historyRecord(payload.sessionId);
      const result = await dialog.showSaveDialog({
        defaultPath: "会话记录.txt",
        filters: [{ name: "文本", extensions: ["txt"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      const text = [
        "会话记录",
        ...record.transcripts.map(
          (x: any) => `[${speakerLabel(x.sourceId)}] ${x.text}`,
        ),
        ...record.answers.map(
          (x: any) => `问题：${x.question}\n回答：${x.text}`,
        ),
      ].join("\n\n");
      await writeFile(result.filePath, text, "utf8");
      return { ok: true };
    },
    [IPC_CHANNELS.CODEX_STATUS]: async () => {
      try {
        const result = await codexClient.host.catalog();
        diagnostics.write("codex.connected", {
          enabled: result.signedIn,
          count: result.models.length,
        });
        return result;
      } catch (e) {
        diagnostics.write("codex.failed", { reason: diagnosticReason(e) });
        throw e;
      }
    },
    [IPC_CHANNELS.PROFILES_LIST]: async () => ({
      ...profiles.snapshot(),
      locked:
        ["starting", "running", "stopping"].includes(core.state) ||
        !requestSlot.isDone(),
      profiles: await Promise.all(
        profiles.snapshot().profiles.map(async (p) => ({
          ...p,
          hasModelKey: await configuredKey(profileKey("model", p.id)),
          hasAsrKey: await configuredKey(profileKey("asr", p.id)),
          hasRealtimeKey: await configuredKey(profileKey("realtime", p.id)),
        })),
      ),
    }),
    [IPC_CHANNELS.PROFILES_SELECT]: async (payload) => {
      if (
        ["starting", "running", "stopping"].includes(core.state) ||
        !requestSlot.isDone()
      )
        throw Error("请先结束会话，再切换方案");
      const value = profiles
        .snapshot()
        .profiles.find((p) => p.id === payload.id);
      if (!value) throw Error("PROFILE_NOT_FOUND");
      await applyProfile(value);
      await profiles.select(value.id);
      return { ok: true };
    },
    [IPC_CHANNELS.PROFILES_SAVE]: async (payload) => {
      if (
        ["starting", "running", "stopping"].includes(core.state) ||
        !requestSlot.isDone()
      )
        throw Error("请先结束会话，再编辑方案");
      const previous = payload.id
        ? profiles.snapshot().profiles.find((p) => p.id === payload.id)
        : undefined;
      if (payload.id && !previous) throw Error("PROFILE_NOT_FOUND");
      const config = payload.realtime
        ? ProviderProfiles.cleanRealtime(payload.realtime)
        : previous?.realtime;
      const saved = await profiles.upsert({
        id: payload.id,
        name: payload.name,
        answerProvider: payload.answerProvider,
        model: payload.model ?? previous?.model ?? modelSettings,
        asr:
          payload.asr ??
          previous?.asr ??
          (payload.answerProvider === "realtime" ? null : extras.asr),
        codex: payload.codex ?? previous?.codex,
        realtime: config,
      });
      let persistent = true;
      for (const kind of ["model", "asr", "realtime"] as const) {
        const key = payload[kind]?.apiKey;
        if (key)
          persistent =
            (await vault!.saveKey(profileKey(kind, saved.id), key))
              .persistent && persistent;
      }
      if (saved.id === profiles.snapshot().activeId) await applyProfile(saved);
      broadcast("settings.display", {
        showTranscripts: extras.showTranscripts !== false,
        deepProfileId: extras.deepProfileId ?? null,
        deepProfiles: profiles
          .snapshot()
          .profiles.filter((p) => p.answerProvider !== "realtime")
          .map((p) => ({ id: p.id, name: p.name })),
      });
      return { id: saved.id, persistent };
    },
    [IPC_CHANNELS.SETTINGS_GET]: async () => {
      const openSettings = settingsRequested;
      settingsRequested = false;
      return {
        openSettings,
        vaultStatus: vault!.status,
        showTranscripts: extras.showTranscripts !== false,
        deepProfileId: extras.deepProfileId ?? null,
        activeProfileId: profiles.snapshot().activeId,
        answerProvider: extras.answerProvider ?? "api",
        realtime: extras.realtime,
        hasRealtimeKey: await configuredKey(profileKey("realtime")),
        codex: extras.codex ?? { modelName: "", effort: "" },
        baseUrl: modelSettings.baseUrl,
        modelName: modelSettings.modelName,
        opacity: extras.opacity,
        mouseThrough: mouseMode.state.enabled,
        profile: extras.profile ?? {},
        asr: extras.asr,
        asrStatus: extras.asr ? "configured" : "not_configured",
        hasModelKey: await configuredKey(profileKey("model")),
        hasAsrKey: await configuredKey(profileKey("asr")),
      };
    },
    [IPC_CHANNELS.SETTINGS_SAVE]: async (payload) => {
      if (
        payload.deepProfileId !== undefined ||
        payload.showTranscripts !== undefined
      ) {
        if (
          payload.deepProfileId &&
          !profiles
            .snapshot()
            .profiles.some(
              (p) =>
                p.id === payload.deepProfileId &&
                p.answerProvider !== "realtime",
            )
        )
          throw Error("请选择文字或 Codex 深度方案");
        const changed =
          payload.deepProfileId !== undefined &&
          payload.deepProfileId !== (extras.deepProfileId ?? null);
        const next = {
          ...extras,
          ...(payload.deepProfileId !== undefined
            ? { deepProfileId: payload.deepProfileId }
            : {}),
          ...(payload.showTranscripts !== undefined
            ? { showTranscripts: payload.showTranscripts }
            : {}),
        };
        await extrasStore.save(next);
        extras = next;
        if (changed) {
          if (extras.deepProfileId) {
            deepQueue.pause(true);
            if (!core.form.paused) deepQueue.resume();
          } else deepQueue.stop();
        }
        broadcast("settings.display", {
          showTranscripts: extras.showTranscripts !== false,
          deepProfileId: extras.deepProfileId ?? null,
          deepProfiles: profiles
            .snapshot()
            .profiles.filter((p) => p.answerProvider !== "realtime")
            .map((p) => ({ id: p.id, name: p.name })),
        });
      }

      if (
        (payload.answerProvider ||
          payload.model ||
          payload.asr ||
          payload.codex ||
          payload.realtime) &&
        ["starting", "running", "stopping"].includes(core.state)
      )
        throw Error("请先结束会话，再修改方案");
      let persistent: boolean | null = null;
      if (payload.answerProvider || payload.codex) {
        if (!requestSlot.isDone())
          throw Error("请先停止当前回答，再修改回答后端");
        const next = {
          ...extras,
          ...(payload.answerProvider
            ? { answerProvider: payload.answerProvider }
            : {}),
          ...(payload.codex
            ? { codex: extrasStore.cleanCodex(payload.codex) }
            : {}),
        };
        await extrasStore.save(next);
        extras = next;
        translationAbort?.abort();
        translationId++;
      }
      if (payload.model) {
        completionUrl(payload.model.baseUrl);
        await settingsStore.save(payload.model);
        modelSettings = {
          baseUrl: payload.model.baseUrl,
          modelName: payload.model.modelName,
        };
        if (payload.model.apiKey) {
          persistent =
            (await vault?.saveKey(profileKey("model"), payload.model.apiKey))
              ?.persistent ?? false;
        }
      }
      let asrPersistent: boolean | null = null;
      if (payload.realtime) {
        extras = {
          ...extras,
          realtime: ProviderProfiles.cleanRealtime(payload.realtime),
        };
        if (payload.realtime.apiKey)
          await vault?.saveKey(profileKey("realtime"), payload.realtime.apiKey);
        await extrasStore.save(extras);
      }
      if (payload.asr) {
        const asr = extrasStore.cleanAsr(payload.asr);
        if (payload.asr.apiKey)
          asrPersistent =
            (await vault?.saveKey(profileKey("asr"), payload.asr.apiKey))
              ?.persistent ?? false;
        extras = { ...extras, asr };
        await extrasStore.save(extras);
      }
      if (payload.profile) {
        const allowed = [
          "name",
          "school",
          "careerTarget",
          "projects",
          "company",
          "position",
          "companyIntro",
          "documents",
          "recordMode",
          "deviceId",
          "auto",
          "language",
          "style",
          "translation",
          "audioEnabled",
          "recordAudio",
          "mode",
          "customPrompt",
          "answerMode",
        ];
        const profile: Record<string, unknown> = {};
        for (const key of allowed) {
          const value = payload.profile[key];
          if (typeof value === "string" || typeof value === "boolean")
            profile[key] = value;
        }
        if (typeof profile.customPrompt === "string")
          profile.customPrompt = profile.customPrompt.slice(0, 8000);
        extras = { ...extras, profile };
        await extrasStore.save(extras);
        if (
          core.state === "running" &&
          typeof profile.customPrompt === "string"
        )
          core.form.customPrompt = profile.customPrompt;
        if (core.state === "running" && typeof profile.answerMode === "string")
          core.form.answerMode = profile.answerMode;
      }
      if (
        payload.answerProvider ||
        payload.model ||
        payload.asr ||
        payload.codex ||
        payload.realtime
      )
        await profiles.upsert({
          ...profiles.active(),
          answerProvider: extras.answerProvider ?? "api",
          model: modelSettings,
          asr: extras.asr,
          codex: extras.codex,
          realtime: extras.realtime,
        });
      return { configured: true, persistent, asrPersistent };
    },

    [IPC_CHANNELS.PROVIDER_TEST]: async (payload) => {
      if (payload.profileId) {
        const p = profiles
          .snapshot()
          .profiles.find((x) => x.id === payload.profileId);
        if (!p) return { ok: false, error: "PROFILE_NOT_FOUND" };
        if (p.answerProvider === "codex" && payload.kind === "model") {
          try {
            const r = await codexClient.host.catalog();
            return { ok: r.signedIn };
          } catch {
            return { ok: false, error: "CODEX_CONNECTION_FAILED" };
          }
        }
        const key = await vault?.getKey(
          profileKey(
            payload.kind === "asr"
              ? "asr"
              : p.answerProvider === "realtime"
                ? "realtime"
                : "model",
            p.id,
          ),
        );
        if (payload.kind === "asr") {
          if (!p.asr || !key) return { ok: false, error: "ASR_NOT_CONFIGURED" };
          const c = new AliyunAsr(
            { ...p.asr, apiKey: key },
            () => {},
            () => {},
          );
          try {
            await c.connect();
            await c.finish();
            return { ok: true };
          } catch (e: any) {
            return { ok: false, error: e.message };
          } finally {
            c.close();
          }
        }
        let ok = false,
          error = "";
        const callbacks = {
          onFinish: (reason: string) => {
            ok = reason === "stop";
          },
          onError: (e: Error) => {
            error = e.message;
          },
        };
        if (p.answerProvider === "realtime") {
          if (!p.realtime?.workspaceId || !key)
            return { ok: false, error: "请填写业务空间 ID 和密钥" };
          const c = new QwenRealtime(
            {
              endpoint: realtimeEndpoint(p.realtime),
              modelName: p.realtime.modelName,
              apiKey: key,
            },
            () => {},
            () => {},
            () => {},
          );
          try {
            await c.connect();
            await c.respond(
              { messages: [{ role: "user", content: "请回复连接成功" }] },
              callbacks,
            );
          } catch (e: any) {
            error = e.message;
          } finally {
            c.close();
          }
        } else if (p.model)
          await modelClient.streamChat(
            {
              ...p.model,
              apiKey: key ?? undefined,
              messages: [{ role: "user", content: "hi" }],
              sessionId: "test",
              generation: 0,
              requestId: randomUUID(),
              stream: false,
            },
            callbacks,
          );
        return { ok, error: error || undefined };
      }
      if (payload.kind === "model" && extras.answerProvider === "realtime") {
        const key = await vault?.getKey(profileKey("realtime"));
        let ok = false,
          error = "";
        await routeModel(
          {
            baseUrl: modelSettings.baseUrl,
            modelName: extras.realtime?.modelName ?? "",
            apiKey: key ?? undefined,
            messages: [{ role: "user", content: "请回复连接成功" }],
            sessionId: "provider-test",
            requestId: randomUUID(),
            generation: 0,
          },
          {
            onFinish: () => {
              ok = true;
            },
            onError: (e) => {
              error = e.message;
            },
          },
        );
        return { ok, error: error || undefined };
      }
      if (payload.kind === "model" && extras.answerProvider === "codex") {
        try {
          const r = await codexClient.host.catalog();
          return {
            ok: r.signedIn,
            error: r.signedIn ? undefined : "Codex尚未登录",
          };
        } catch (e: any) {
          return { ok: false, error: e.message };
        }
      }
      if (payload.kind === "model") {
        const key = (await vault?.getKey(profileKey("model"))) ?? undefined;
        let success = false;
        let errMessage = "";
        await modelClient.streamChat(
          {
            baseUrl: modelSettings.baseUrl,
            apiKey: key,
            modelName: modelSettings.modelName,
            messages: [{ role: "user", content: "hi" }],
            sessionId: "test-session",
            generation: 1,
            requestId: "test-req",
            stream: false,
          },
          {
            onFinish: (reason) => {
              success = reason !== "interrupted";
              if (!success) errMessage = "REQUEST_INTERRUPTED";
            },
            onError: (err) => {
              errMessage = err.message;
            },
          },
        );
        return { ok: success, error: errMessage || undefined };
      }
      if (payload.kind === "asr") {
        const key = await vault?.getKey(profileKey("asr"));
        if (!extras.asr || !key)
          return { ok: false, error: "ASR_NOT_CONFIGURED" };
        const client = new AliyunAsr(
          { ...extras.asr, apiKey: key },
          () => {},
          () => {},
        );
        try {
          await client.connect();
          await client.finish();
          return { ok: true };
        } catch (e: any) {
          client.close();
          return { ok: false, error: e.message };
        }
      }
      return { ok: false, error: "UNKNOWN_PROVIDER" };
    },

    [IPC_CHANNELS.WINDOW_COMMAND]: async (payload) => {
      if (!windowManager) return { ok: false };
      if (payload.action === "get_mouse_mode") return mouseMode.state;
      if (payload.action === "set_mouse_through")
        return setMouseThrough(payload.enabled);
      if (payload.action === "get_bounds") {
        const win =
          payload.target === "overlay"
            ? windowManager.getOverlayWindow()
            : windowManager.getPrepareWindow();
        if (!win) throw Error("WINDOW_NOT_AVAILABLE");
        return { bounds: win.getBounds() };
      }
      if (payload.action === "begin_drag") {
        const win =
          payload.target === "overlay"
            ? windowManager.getOverlayWindow()
            : windowManager.getPrepareWindow();
        if (!win) throw Error("WINDOW_NOT_AVAILABLE");
        dragTokens.set(payload.target, {
          token: payload.dragToken,
          windowId: win.id,
        });
        if (payload.target === "overlay") mouseMode.setDragging(true);
        return { bounds: win.getBounds() };
      }
      if (payload.action === "end_drag") {
        if (dragTokens.get(payload.target)?.token !== payload.dragToken)
          return { stale: true };
        dragTokens.delete(payload.target);
        if (payload.target === "overlay") mouseMode.setDragging(false);
        return { ok: true };
      }
      if (payload.action === "move_window") {
        if (payload.dragToken) {
          const drag = dragTokens.get(payload.target);
          const win =
            payload.target === "overlay"
              ? windowManager.getOverlayWindow()
              : windowManager.getPrepareWindow();
          if (
            !drag ||
            drag.token !== payload.dragToken ||
            drag.windowId !== win?.id
          )
            return { stale: true };
          if (payload.target === "overlay") mouseMode.touchDrag();
        }
        windowManager.moveWindow(payload.target, payload.x, payload.y);
        return { ok: true };
      }
      if (payload.action === "hide_prepare") {
        windowManager.getPrepareWindow()?.hide();
        return { ok: true };
      }
      if (payload.action === "quit_app") {
        app.quit();
        return { ok: true };
      }
      if (payload.action === "minimize_overlay") {
        windowManager.minimizeWindow("overlay");
        return { ok: true };
      }
      if (payload.action === "minimize_prepare") {
        windowManager.minimizeWindow("prepare");
        return { ok: true };
      }
      if (payload.action === "close_prepare") {
        windowManager.getPrepareWindow()?.close();
        return { ok: true };
      }
      if (payload.action === "show_prepare") {
        if (payload.view === "settings") openSettings();
        else windowManager.createPrepareWindow();
        return { ok: true };
      }
      if (payload.action === "set_opacity") {
        if (payload.requireOverlayFocus) {
          const overlay = windowManager.getOverlayWindow();
          if (!overlay?.isVisible() || !overlay.isFocused())
            return { ok: false, ignored: true, opacity: extras.opacity };
        }
        windowManager.setOpacity(payload.opacity);
        diagnostics.write("window.opacity", { opacity: payload.opacity });
        extras = { ...extras, opacity: payload.opacity };
        await extrasStore.save(extras);
        return { ok: true, opacity: payload.opacity };
      }
      if (payload.action === "toggle_expand") {
        const expanded = windowManager.toggleExpand();
        return { ok: true, expanded };
      }
      if (payload.action === "set_content_protection") {
        windowManager.setContentProtection(payload.protectedContent ?? true);
        return { ok: true };
      }
      if (payload.action === "show_overlay") {
        windowManager.createOverlayWindow();
        return { ok: true };
      }
      if (payload.action === "hide_overlay") {
        windowManager.getOverlayWindow()?.hide();
        return { ok: true };
      }
      return { ok: false };
    },

    [IPC_CHANNELS.ANSWER_ASK]: async (payload) => {
      const traceTurnId = payload.traceTurnId ?? randomUUID();
      if (!payload.automatic) {
        if (!core.form.paused) deepQueue.resume();
        offerDeep({
          question: payload.question,
          kind: payload.kind ?? "knowledge",
          image: payload.image,
          traceTurnId,
        });
      }
      if (payload.automatic && !requestSlot.isDone()) {
        autoQueue.offer(payload.question);
        return { queued: true };
      }
      if (!requestSlot.isDone()) cancelCurrent(true);
      if (currentAbortController) {
        currentAbortController.abort();
      }
      const generation = requestSlot.begin();
      diagnostics.write("answer.started", {
        generation,
        automatic: !!payload.automatic,
        count: core.segments.length,
      });
      const requestId = randomUUID();
      const requestStartedAt = Date.now();
      const trace = new TurnTrace(diagnostics, {
        sessionId: core.id ?? "manual",
        turnId: traceTurnId,
        requestId,
        lane: "fast",
        enqueuedAt: payload.enqueuedAt,
      });
      fastTrace = trace;
      trace.mark("credentials");
      const controller = new AbortController();
      currentAbortController = controller;

      const previous = core.answers.findLast(
        (x) => x.state === "generating" && x.lane !== "deep",
      );
      if (previous) previous.state = "cancelled";
      const answerRecord = {
        requestId,
        lane: "fast",
        question: payload.question,
        text: "",
        state: "generating",
        kind: payload.kind ?? "knowledge",
        sequence: 0,
        error: "",
        finishReason: "",
        audioItems: payload.audioItems ?? [],
        automatic: !!payload.automatic,
        segmentIds: (payload.autoSegments ?? []).map(
          (x: AutoAnswerSegment) => x.id,
        ),
      };
      activeAutomatic = payload.automatic
        ? { requestId, generation, segments: payload.autoSegments ?? [] }
        : null;
      emitQueue();
      if (core.id) core.answers.push(answerRecord);
      broadcast("answer.event", {
        text: "",
        status: {
          state: "started",
          generation,
          requestId,
          question: payload.question,
          automatic: !!payload.automatic,
          segmentIds: answerRecord.segmentIds,
          sequence: answerRecord.sequence,
        },
      });
      const failRequest = (err: Error) => {
        if (!requestSlot.finish(generation)) return;
        trace.settle(diagnosticReason(err) === "timeout" ? "timeout" : "error");
        diagnostics.write("answer.failed", {
          generation,
          reason: diagnosticReason(err),
          durationMs: Date.now() - requestStartedAt,
        });
        answerRecord.state = "failed";
        answerRecord.error = err.message;
        answerRecord.sequence++;
        if (answerRecord.audioItems.length)
          realtimePending = [
            ...new Set([...answerRecord.audioItems, ...realtimePending]),
          ];
        if (activeAutomatic?.generation === generation) {
          const retry =
            extras.answerProvider === "realtime" &&
            answerRecord.audioItems.length &&
            recoverableRealtimeError(err) &&
            core.state === "running" &&
            !core.form.paused &&
            core.form.auto &&
            recovery.allow(answerRecord.audioItems);
          if (retry) {
            diagnostics.write("answer.recovery_pending", {
              generation,
              reason: "network",
            });
            if (!payload.realtimeAudio) {
              if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
              realtimeRetryTimer = setTimeout(() => {
                realtimeRetryTimer = null;
                drainRealtime();
              }, 1000);
            }
          } else {
            autoQueue.requeue(activeAutomatic.segments);
            core.form.auto = false;
            autoQueue.suspend();
            diagnostics.write("answer.auto_disabled", {
              generation,
              reason: diagnosticReason(err),
            });
          }
          activeAutomatic = null;
          broadcast("session.state", core.snapshot());
        }
        autoQueue.completed();
        emitQueue();
        broadcast("answer.event", {
          text: "",
          question: payload.question,
          status: {
            state: "error",
            generation,
            requestId,
            error: err.message,
            sequence: answerRecord.sequence,
          },
        });
      };
      let key: string | undefined;
      try {
        key =
          extras.answerProvider === "codex"
            ? undefined
            : ((await vault?.getKey(
                profileKey(
                  extras.answerProvider === "realtime" && !payload.image
                    ? "realtime"
                    : "model",
                ),
              )) ?? undefined);
      } catch (error) {
        failRequest(
          error instanceof Error
            ? error
            : Error("密钥读取失败，请检查配置后重试"),
        );
        return { requestId, generation };
      }
      if (!requestSlot.accept(generation)) return { requestId, generation };

      const answerProvider = resolveAnswerProvider(
        extras.answerProvider ?? "api",
        Boolean(payload.image),
      );
      const thinkingOptions = resolveAnswerThinking(
        extras.answerProvider ?? "api",
        modelSettings.baseUrl,
        modelSettings.modelName,
        Boolean(payload.image),
      );
      trace.mark("policy");
      diagnostics.write("answer.policy", {
        generation,
        provider: answerProvider,
        hasImage: Boolean(payload.image),
        effort:
          answerProvider === "codex"
            ? extras.codex?.effort
            : thinkingOptions.reasoningEffort,
        thinkingEnabled: thinkingOptions.thinking === "enabled",
      });
      const messages = buildContext(
        core.id
          ? {
              ...core.form,
              customPrompt:
                core.state === "running"
                  ? core.form.customPrompt
                  : (extras.profile?.customPrompt ?? core.form.customPrompt),
            }
          : (extras.profile ?? {}),
        core.id ? core.segments : [],
        payload.question,
        payload.kind ?? "knowledge",
        core.answers.filter((a) => a.lane !== "deep"),
        !payload.image,
      ).map((message, index, items) =>
        payload.image && index === items.length - 1
          ? {
              role: "user" as const,
              content: [
                { type: "text" as const, text: payload.question },
                {
                  type: "image_url" as const,
                  image_url: { url: payload.image },
                },
              ],
            }
          : message,
      );
      diagnostics.write("answer.context", {
        generation,
        messageCount: messages.length,
        transcriptCount: core.segments.filter((s) => s.isFinal).length,
        contextCharacters: messages.reduce(
          (sum, m) =>
            sum +
            (typeof m.content === "string"
              ? m.content.length
              : m.content
                  .filter((x) => x.type === "text")
                  .reduce((n, x) => n + ("text" in x ? x.text.length : 0), 0)),
          0,
        ),
      });
      let reasoningSeen = false;
      void routeModel(
        {
          baseUrl: modelSettings.baseUrl,
          apiKey: key,
          modelName: modelSettings.modelName,
          messages,
          ...thinkingOptions,
          realtimeAudio: payload.realtimeAudio,
          sessionId: core.id ?? "manual-session",
          generation,
          requestId,
          signal: controller.signal,
        },
        {
          onRequest: (attempt) => trace.upstream(attempt),
          onResponse: () => {
            trace.mark("headers");
            if (requestSlot.accept(generation))
              diagnostics.write("answer.headers", {
                generation,
                durationMs: Date.now() - requestStartedAt,
              });
          },
          onReasoning: (characters) => {
            if (requestSlot.accept(generation) && !reasoningSeen) {
              reasoningSeen = true;
              diagnostics.write("answer.reasoning_first", {
                generation,
                count: characters,
                durationMs: Date.now() - requestStartedAt,
              });
            }
          },
          onToken: (token) => {
            trace.firstOutput(token);
            if (requestSlot.accept(generation)) {
              if (!answerRecord.text)
                diagnostics.write("answer.first_output", {
                  generation,
                  durationMs: Date.now() - requestStartedAt,
                });
              answerRecord.text += token;
              answerRecord.sequence++;
              broadcast("answer.event", {
                text: token,
                status: {
                  state: "streaming",
                  generation,
                  requestId,
                  sequence: answerRecord.sequence,
                },
              });
            }
          },
          onFinish: (reason) => {
            if (requestSlot.finish(generation)) {
              trace.settle(
                ["interrupted", "reconnecting"].includes(reason)
                  ? "cancelled"
                  : "completed",
              );
              diagnostics.write("answer.finished", {
                generation,
                reason,
                durationMs: Date.now() - requestStartedAt,
              });
              answerRecord.state = ["interrupted", "reconnecting"].includes(
                reason,
              )
                ? "cancelled"
                : "completed";
              answerRecord.finishReason = reason;
              answerRecord.sequence++;
              if (
                ["interrupted", "reconnecting"].includes(reason) &&
                activeAutomatic
              ) {
                if (answerRecord.audioItems.length)
                  realtimePending = [
                    ...new Set([
                      ...answerRecord.audioItems,
                      ...realtimePending,
                    ]),
                  ];
                const retry =
                  extras.answerProvider === "realtime" &&
                  answerRecord.audioItems.length &&
                  core.state === "running" &&
                  !core.form.paused &&
                  core.form.auto &&
                  recovery.allow(answerRecord.audioItems);
                if (retry) {
                  realtimePending = [
                    ...new Set([
                      ...answerRecord.audioItems,
                      ...realtimePending,
                    ]),
                  ];
                  diagnostics.write("answer.recovery_pending", {
                    generation,
                    reason: "reconnecting",
                  });
                } else {
                  autoQueue.requeue(activeAutomatic.segments);
                  core.form.auto = false;
                  autoQueue.suspend();
                  diagnostics.write("answer.auto_disabled", {
                    generation,
                    reason: "interrupted",
                  });
                }
                broadcast("session.state", core.snapshot());
              } else if (reason === "stop")
                recovery.completed(answerRecord.audioItems);
              activeAutomatic = null;
              autoQueue.completed();
              emitQueue();
              queueMicrotask(drainRealtime);
              broadcast("answer.event", {
                text: "",
                status: {
                  state: ["interrupted", "reconnecting"].includes(reason)
                    ? "cancelled"
                    : "completed",
                  generation,
                  requestId,
                  finishReason: reason,
                  sequence: answerRecord.sequence,
                },
              });
            }
          },
          onError: failRequest,
        },
      ).catch((error) =>
        failRequest(error instanceof Error ? error : Error("模型请求失败")),
      );

      return { requestId, generation };
    },

    [IPC_CHANNELS.ANSWER_CANCEL]: async () => {
      deepQueue.stop();
      if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
      realtimeRetryTimer = null;
      if (revisionTimer) clearTimeout(revisionTimer);
      revisionTimer = null;
      core.form.auto = false;
      cancelCurrent(true);
      diagnostics.write("answer.cancelled");
      broadcast("session.state", core.snapshot());

      return { cancelled: true };
    },
  };

  let providerUpdating = false,
    sessionStarting = false;
  for (const channel of [
    IPC_CHANNELS.PROFILES_SAVE,
    IPC_CHANNELS.PROFILES_SELECT,
    IPC_CHANNELS.SETTINGS_SAVE,
  ]) {
    const original = handlers[channel];
    handlers[channel] = async (payload) => {
      const providerChange =
        channel !== IPC_CHANNELS.SETTINGS_SAVE ||
        !!(
          payload.answerProvider ||
          payload.model ||
          payload.asr ||
          payload.codex ||
          payload.realtime
        );
      if (!providerChange) return original(payload);
      if (providerUpdating || sessionStarting)
        throw Error("配置或会话正在切换，请稍后");
      providerUpdating = true;
      try {
        return await original(payload);
      } finally {
        providerUpdating = false;
      }
    };
  }
  const beginSession = handlers[IPC_CHANNELS.SESSION_START];
  handlers[IPC_CHANNELS.SESSION_START] = async (payload) => {
    if (providerUpdating || sessionStarting)
      throw Error("配置或会话正在切换，请稍后");
    sessionStarting = true;
    try {
      return await beginSession(payload);
    } finally {
      sessionStarting = false;
    }
  };
  const beginAnswer = handlers[IPC_CHANNELS.ANSWER_ASK];
  handlers[IPC_CHANNELS.ANSWER_ASK] = (payload) => {
    if (providerUpdating) throw Error("方案正在切换，请稍后");
    return beginAnswer(payload);
  };

  registerIpcMainHandlers(
    ipcMain,
    () => new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id)),
    rendererOrigins(rendererUrl),
    handlers,
  );
  diagnostics.write("app.ready");

  desktopMenu = new DesktopMenu({
    iconPath: desktopResource("tray-wecom.png"),
    getState: () => ({
      running: core.state === "running",
      audioEnabled: core.form.audioEnabled !== false,
      paused: !!core.form.paused,
      mouseThrough: mouseMode.state.enabled,
      busy:
        !!stopping || core.state === "starting" || core.state === "stopping",
    }),
    onAction: async (action) => {
      if (action === "show") windowManager?.restoreWindow();
      else if (action === "hide") windowManager?.hideWindows();
      else if (action === "settings") openSettings();
      else if (action === "quit") app.quit();
    },
    onError: (error) => {
      diagnostics.write("desktop.action_failed", {
        reason: diagnosticReason(error),
      });
      broadcast("session.warning", {
        message: "菜单操作失败，请显示助手查看后重试",
      });
    },
  });
  const registerTracedShortcut = (
    key: string,
    action: () => void,
    shortcut:
      | "opacity_down"
      | "opacity_up"
      | "screenshot"
      | "mouse_through"
      | "visibility"
      | "wake",
  ) => {
    const enabled = windowManager!.registerShortcut(key, () => {
      diagnostics.write("window.shortcut_pressed", { shortcut });
      action();
    });
    diagnostics.write("window.shortcut_registered", { shortcut, enabled });
    return enabled;
  };
  let opacityShortcutQueue: Promise<void> = Promise.resolve();
  overlayShortcuts = new OverlayShortcuts({
    register: (key, action) =>
      registerTracedShortcut(
        key,
        action,
        key === "Alt+Left"
          ? "opacity_down"
          : key === "Alt+Right"
            ? "opacity_up"
            : "screenshot",
      ),
    unregister: (key) => windowManager!.unregisterShortcut(key),
    opacity: (delta) => {
      opacityShortcutQueue = opacityShortcutQueue
        .then(async () => {
          const opacity = Math.max(
            0,
            Math.min(1, Math.round((extras.opacity + delta) * 100) / 100),
          );
          await handlers[IPC_CHANNELS.WINDOW_COMMAND]({
            action: "set_opacity",
            opacity,
          });
          broadcast("window.opacity_changed", { opacity });
        })
        .catch(() =>
          broadcast("session.warning", { message: "不透明度调整失败" }),
        );
    },
    capture: () => broadcast("window.screenshot_shortcut", {}),
    onFailure: () =>
      broadcast("session.warning", {
        message: "浮窗快捷键被占用，请使用窗口按钮",
      }),
  });
  windowManager.createPrepareWindow();

  // 注册全局快捷键 (CommandOrControl+Shift+O 唤醒浮窗)
  registerTracedShortcut(
    "CommandOrControl+Shift+O",
    () => {
      app.focus({ steal: true });
      windowManager?.wakeOverlay();
    },
    "wake",
  );

  const toggleMouseThrough = () => {
    void setMouseThrough(!mouseMode.state.enabled).catch(() =>
      broadcast("session.warning", { message: "穿透设置保存失败" }),
    );
  };
  const throughRegistered = registerTracedShortcut(
    "`",
    toggleMouseThrough,
    "mouse_through",
  );
  if (!throughRegistered)
    broadcast("session.warning", {
      message: "反引号快捷键被占用，请使用浮窗穿透按钮",
    });
  const visibilityRegistered = registerTracedShortcut(
    "Alt+1",
    () => {
      if (!windowManager?.isActiveWindowVisible()) app.focus({ steal: true });
      windowManager?.toggleVisibility();
    },
    "visibility",
  );
  diagnostics.write("window.shortcut", { enabled: visibilityRegistered });
  if (!visibilityRegistered)
    broadcast("session.warning", {
      message: "⌥1 快捷键被占用，请使用顶部菜单栏显示或隐藏",
    });
  let quitReady = false;
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitReady) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    overlayShortcuts?.dispose();
    windowManager?.rememberOverlayBounds();
    windowState.flush();
    desktopMenu?.destroy();
    modifierWatch.stop();
    mouseMode.dispose();
    diagnostics.write("app.quitting");
    void stopSession()
      .catch((e: any) => console.warn("Unable to finalize session:", e.message))
      .finally(async () => {
        await opacityShortcutQueue;
        codexClient.close();
        codexTranslation.close();
        codexDeep.close();
        await diagnostics.flush();
        quitReady = true;
        app.quit();
      });
  });

  if (selfTest) {
    void artifactSelfTest(
      windowManager!.getPrepareWindow()!,
      vault!,
      diagnostics,
      process.resourcesPath,
      process.argv.includes("--rea-self-test-vault"),
    )
      .catch(() => {
        diagnostics.write("selftest.failed");
        process.exitCode = 1;
      })
      .finally(async () => {
        await diagnostics.flush();
        app.quit();
      });
  }
  app.on("activate", () => {
    windowManager?.restoreWindow();
  });
});

app.on("will-quit", () => {
  windowManager?.unregisterAllShortcuts();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
