import { mkdir, appendFile, stat, rename, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
const numeric = new Set([
  "status",
  "generation",
  "count",
  "durationMs",
  "width",
  "height",
  "x",
  "y",
  "epoch",
  "exitCode",
  "sampleRate",
  "correlation",
  "suppressed",
  "frames",
  "pid",
  "opacity",
  "turn",
  "queueWaitMs",
  "pendingCount",
  "contextCharacters",
  "messageCount",
  "transcriptCount",
  "referenceCharacters",
  "attempt",
  "ttftMs",
]);
const flags = new Set([
  "automatic",
  "paused",
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
  "enabled",
  "held",
  "available",
  "ignoring",
  "dragging",
  "thinkingEnabled",
  "hasImage",
  "auto",
]);
const enums: Record<string, Set<string>> = {
  cryptoStage:new Set(['availability','encrypt','decrypt']),
  lane: new Set(["fast", "deep"]),
  outcome: new Set(["completed", "cancelled", "timeout", "error"]),
  phase: new Set([
    "dispatched",
    "credentials",
    "context",
    "policy",
    "upstream",
    "headers",
    "first_output",
  ]),
  vaultState: new Set(["unchecked", "ready", "timeout", "locked"]),
  errorCode: new Set([
    "REALTIME_TRANSCRIPTION_FAILED",
    "REALTIME_CONNECTION_FAILED",
    "REALTIME_CONNECTION_CLOSED",
    "REALTIME_SEND_FAILED",
    "REALTIME_RESPONSE_TIMEOUT",
    "REALTIME_NOT_CONNECTED",
    "REALTIME_STOPPED",
  ]),
  shortcut: new Set([
    "opacity_down",
    "opacity_up",
    "screenshot",
    "mouse_through",
    "visibility",
    "wake",
  ]),
  provider: new Set(["api", "codex", "realtime"]),
  effort: new Set([
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]),
  stage: new Set([
    "tap_create_failed",
    "tap_format_failed",
    "tap_uid_failed",
    "unsupported_audio_format",
    "aggregate_create_failed",
    "io_create_failed",
    "audio_start_failed",
    "internal_error",
    "unsupported_os",
    "protocol_invalid",
    "spawn_failed",
    "capture_exit",
    "capture_timeout",
    "start_timeout",
    "spawn_failed",
    "protocol_error",
    "helper_exited",
    "stream_failed",
    "native_error",
    "consumer_failed",
    "stopped",
  ]),
  errorType: new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
  ]),
  state: new Set([
    "idle",
    "starting",
    "running",
    "stopping",
    "stopped",
    "failed",
    "ready",
    "warning",
    "completed",
    "cancelled",
  ]),
  sourceId: new Set(["microphone", "system"]),
  mode: new Set(["prepare", "overlay", "capture"]),
  reason: new Set([
    "reconnecting",
    "stop",
    "length",
    "interrupted",
    "clean-exit",
    "abnormal-exit",
    "killed",
    "crashed",
    "oom",
    "launch-failed",
    "integrity-failure",
    "permission_denied",
    "device_unavailable",
    "timeout",
    "network",
    "asr",
    "unknown",
  ]),
};
export class DiagnosticsLog {
  private pending: Promise<void> = Promise.resolve();
  private queued = 0;
  constructor(
    readonly directory: string,
    private maxBytes = 2 * 1024 * 1024,
  ) {}
  write(event: string, input: Record<string, unknown> = {}): void {
    if (!/^[a-z][a-z0-9_.]{0,63}$/.test(event) || this.queued >= 1000) return;
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (
        numeric.has(key) &&
        typeof value === "number" &&
        Number.isFinite(value)
      )
        data[key] = value;
      if (flags.has(key) && typeof value === "boolean") data[key] = value;
      if (
        Object.hasOwn(enums, key) &&
        enums[key].has(String(value)) &&
        typeof value === "string"
      )
        data[key] = value;
    }
    for (const field of ["sessionKey", "turnKey", "requestKey"])
      if (
        typeof input[field] === "string" &&
        /^[a-f0-9]{16}$/.test(input[field] as string)
      )
        data[field] = input[field];
    if (Array.isArray(input.segmentKeys))
      data.segmentKeys = input.segmentKeys
        .filter((x) => typeof x === "string" && /^[a-f0-9]{16}$/.test(x))
        .slice(0, 100);
    if (Array.isArray(input.locations))
      data.locations = input.locations
        .filter(
          (x) => typeof x === "string" && /^index\.js:\d{1,8}:\d{1,6}$/.test(x),
        )
        .slice(0, 8);
    if (
      typeof input.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(input.version)
    )
      data.version = input.version;
    const line =
      JSON.stringify({ time: new Date().toISOString(), event, data }) + "\n";
    this.queued++;
    this.pending = this.pending
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = join(this.directory, "diagnostics.log");
        let size = 0;
        try {
          size = (await stat(path)).size;
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        if (size + Buffer.byteLength(line) > this.maxBytes) {
          await rm(path + ".2", { force: true });
          for (const [from, to] of [
            [path + ".1", path + ".2"],
            [path, path + ".1"],
          ]) {
            try {
              await rename(from, to);
            } catch (e: any) {
              if (e.code !== "ENOENT") throw e;
            }
          }
        }
        await appendFile(path, line, { mode: 0o600 });
        await chmod(path, 0o600);
      })
      .catch(() => {
        console.warn("Unable to write diagnostic metadata");
      })
      .finally(() => {
        this.queued--;
      });
  }
  flush(): Promise<void> {
    return this.pending;
  }
}

export function diagnosticReason(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error);
  if (/permission|notallowed|denied|权限/i.test(text))
    return "permission_denied";
  if (/timeout|超时/i.test(text)) return "timeout";
  if (/device|notfound|notreadable|音轨/i.test(text))
    return "device_unavailable";
  if (/network|connect|websocket|ECONN/i.test(text)) return "network";
  if (/ASR|TRANSCRIPTION/i.test(text)) return "asr";
  return "unknown";
}

export function diagnosticLocations(error: Error): string[] {
  return (error.stack ?? "")
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const match = line.match(/[/\\](index\.js:\d{1,8}:\d{1,6})\)?$/);
      return match ? [match[1]] : [];
    })
    .slice(0, 8);
}
