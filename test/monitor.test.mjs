import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { startUsageMonitor, monitorText } from "../dist/monitor.js";
import { UsageError } from "../dist/usage.js";

const snapshot = (summary = "Sekai v2 · Token 123") => ({ version: "v2", report: "full report", summary });

async function until(check) {
  const deadline = Date.now() + 1000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for monitor update");
    await delay(5);
  }
}

test("monitor loads on startup and coalesces overlapping requests", async (t) => {
  let complete;
  let calls = 0;
  const states = [];
  const monitor = startUsageMonitor({
    load: () => { calls++; return new Promise((resolve) => { complete = resolve; }); },
    onChange: (state) => states.push(state),
  });
  t.after(() => monitor.dispose());
  const first = monitor.refresh();
  const second = monitor.refresh();
  assert.equal(first, second);
  await until(() => complete);
  assert.equal(calls, 1);
  complete(snapshot());
  await first;
  assert.equal(states.at(-1).snapshot.summary, "Sekai v2 · Token 123");
  assert.equal(states.at(-1).loading, false);
});

test("periodic refresh updates without any user command and stops on disposal", async () => {
  let calls = 0;
  const monitor = startUsageMonitor({
    load: async () => { calls++; return snapshot(`Token ${calls}`); },
    onChange: () => {}, intervalMs: 15,
  });
  try {
    await until(() => calls >= 2);
  } finally {
    monitor.dispose();
  }
  const stoppedAt = calls;
  await delay(40);
  assert.equal(calls, stoppedAt);
});

test("session event bursts trigger a single delayed refresh", async (t) => {
  let calls = 0;
  const monitor = startUsageMonitor({
    load: async () => { calls++; return snapshot(); },
    onChange: () => {}, minimumGapMs: 30,
  });
  t.after(() => monitor.dispose());
  await monitor.refresh();
  for (let i = 0; i < 20; i++) monitor.requestRefresh();
  assert.equal(calls, 1);
  await until(() => calls === 2);
  await delay(40);
  assert.equal(calls, 2);
});

test("activity during an in-flight request still schedules an update afterwards", async (t) => {
  let resolveFirst;
  let calls = 0;
  const monitor = startUsageMonitor({
    load: () => {
      calls++;
      return calls === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve(snapshot("new data"));
    },
    onChange: () => {}, minimumGapMs: 0,
  });
  t.after(() => monitor.dispose());
  await until(() => resolveFirst);
  monitor.requestRefresh();
  await delay(10);
  assert.equal(calls, 1);
  resolveFirst(snapshot());
  await until(() => calls === 2);
});

test("refresh failures retain the last data and recover on the next success", async (t) => {
  let failure = false;
  const states = [];
  const monitor = startUsageMonitor({
    load: async () => {
      if (failure) throw new UsageError("Sekai Gateway: HTTP 401.");
      return snapshot();
    },
    onChange: (state) => states.push(state),
  });
  t.after(() => monitor.dispose());
  await monitor.refresh();
  failure = true;
  await monitor.refresh();
  assert.equal(states.at(-1).snapshot.summary, "Sekai v2 · Token 123");
  assert.match(monitorText(states.at(-1)), /Data terakhir/);
  assert.match(states.at(-1).error, /HTTP 401/);
  failure = false;
  await monitor.refresh();
  assert.equal(states.at(-1).error, undefined);
  assert.doesNotMatch(monitorText(states.at(-1)), /Data terakhir/);
});

test("unexpected errors do not leak credentials into the inline display", async (t) => {
  const states = [];
  const monitor = startUsageMonitor({
    load: async () => { throw new Error("unknown-secret"); },
    onChange: (state) => states.push(state),
  });
  t.after(() => monitor.dispose());
  await monitor.refresh();
  assert.match(monitorText(states.at(-1)), /Usage tidak tersedia/);
  assert.doesNotMatch(monitorText(states.at(-1)), /unknown-secret/);
  assert.match(monitorText({ loading: true }), /Memuat usage/);
});

test("statusline remains one line while loading, showing data, stale, or failing", () => {
  const states = [
    { loading: true },
    { loading: false, snapshot: snapshot("Coding Plan Pro · 5 jam 0%") },
    { loading: false, snapshot: snapshot("Coding Plan Pro\n5 jam 0%"), error: "HTTP 401" },
    { loading: false, error: "HTTP 401\nPeriksa API key" },
  ];
  for (const state of states) assert.doesNotMatch(monitorText(state), /[\r\n]/);
  assert.match(monitorText(states[2]), /Data terakhir/);
  assert.equal(monitorText(states[3]), "Sekai · Usage tidak tersedia");
});

test("disposing aborts an active request and prevents stale UI updates", async () => {
  let complete;
  let signal;
  const states = [];
  const monitor = startUsageMonitor({
    load: (incoming) => {
      signal = incoming;
      return new Promise((resolve) => { complete = resolve; });
    },
    onChange: (state) => states.push(state),
  });
  const pending = monitor.refresh();
  await until(() => signal);
  monitor.dispose();
  assert.equal(signal.aborted, true);
  const count = states.length;
  complete(snapshot("must not appear"));
  await pending;
  await monitor.refresh();
  monitor.requestRefresh();
  await delay(15);
  assert.equal(states.length, count);
});
