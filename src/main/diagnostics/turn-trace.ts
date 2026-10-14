import { createHash } from "node:crypto";
export interface TraceLog {
  write(event: string, data?: Record<string, unknown>): void;
}
export interface TraceIdentity {
  sessionId: string;
  turnId: string;
  requestId: string;
  lane: "fast" | "deep";
  enqueuedAt?: number;
}
const key = (id: string) =>
  createHash("sha256").update(id).digest("hex").slice(0, 16);
/** Metadata only. Lifecycle events are written immediately, including before credential access. */
export class TurnTrace {
  readonly keys: {
    sessionKey: string;
    turnKey: string;
    requestKey: string;
    lane: "fast" | "deep";
  };
  private ended = false;
  private first: number | undefined;
  private sent: number | undefined;
  private started: number;
  private queued: number;
  private phase = "dispatched";
  constructor(
    private log: TraceLog,
    id: TraceIdentity,
    private now = Date.now,
  ) {
    this.keys = {
      sessionKey: key(id.sessionId),
      turnKey: key(id.turnId),
      requestKey: key(id.requestId),
      lane: id.lane,
    };
    this.started = this.now();
    this.queued = id.enqueuedAt ?? this.started;
    this.mark("dispatched");
  }
  mark(phase: string) {
    if (this.ended) return;
    this.phase = phase;
    this.log.write("turn." + phase, {
      ...this.keys,
      durationMs: this.now() - this.queued,
      queueWaitMs: this.started - this.queued,
    });
  }
  upstream(attempt = 1) {
    if (this.ended) return;
    this.sent = this.now();
    this.mark("upstream");
    this.log.write("turn.attempt", { ...this.keys, attempt });
  }
  firstOutput(token: string) {
    if (!token || this.first !== undefined || this.ended) return;
    this.first = this.now();
    this.mark("first_output");
  }
  settle(outcome: "completed" | "cancelled" | "timeout" | "error") {
    if (this.ended) return;
    this.ended = true;
    this.log.write("turn.settled", {
      ...this.keys,
      outcome,
      phase: this.phase,
      queueWaitMs: this.started - this.queued,
      durationMs: this.now() - this.queued,
      ...(this.first !== undefined && this.sent !== undefined
        ? { ttftMs: this.first - this.sent }
        : {}),
    });
  }
}
