import { expect, test } from "vitest";
import { TurnTrace } from "../src/main/diagnostics/turn-trace";
test("fast and deep share a turn but retain separate request ids, first-output measured once, terminal idempotent", () => {
  let now = 100;
  const events: any[] = [];
  const log = {
    write: (event: string, data: any) => events.push({ event, data }),
  };
  const t = new TurnTrace(
    log,
    {
      sessionId: "s",
      turnId: "t",
      requestId: "r",
      lane: "deep",
      enqueuedAt: 70,
    },
    () => now,
  );
  now = 110;
  t.mark("credentials");
  now = 120;
  t.upstream(1);
  now = 150;
  t.firstOutput("");
  t.firstOutput("hello");
  now = 160;
  t.firstOutput("again");
  t.settle("completed");
  t.settle("error");
  const final = events.find((x) => x.event === "turn.settled").data;
  expect(final.queueWaitMs).toBe(30);
  expect(final.ttftMs).toBe(30);
  expect(final.durationMs).toBe(90);
  expect(events.filter((x) => x.event === "turn.first_output")).toHaveLength(1);
  expect(events.filter((x) => x.event === "turn.settled")).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("hello");
  expect(final.requestKey).toMatch(/^[a-f0-9]{16}$/);
  const fast = new TurnTrace(
    log,
    { sessionId: "s", turnId: "t", requestId: "r2", lane: "fast" },
    () => now,
  );
  expect(fast.keys.turnKey).toBe(t.keys.turnKey);
  expect(fast.keys.requestKey).not.toBe(t.keys.requestKey);
});
