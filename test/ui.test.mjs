import assert from "node:assert/strict";
import { test } from "node:test";
import { createUI } from "../scripts/ui.mjs";

function capture(env, tty = false) {
  let text = "";
  const output = { isTTY: tty, columns: 80, write(value) { text += value; } };
  return { ui: createUI({ output, errorOutput: output, env }), text: () => text };
}

test("redirected installer output is readable without terminal control sequences", async () => {
  const view = capture({ TERM: "xterm-256color" });
  view.ui.header();
  await view.ui.step(1, "Menyiapkan dependency", async () => {});
  view.ui.success({ version: "v2", plugin: "/plugin", settings: "/settings" });
  assert.match(view.text(), /SEKAI GATEWAY/);
  assert.match(view.text(), /\[OK\] \[1\/6\]/);
  assert.match(view.text(), /Coding Plan/);
  assert.doesNotMatch(view.text(), /\x1b/);
});

test("NO_COLOR and dumb terminals disable colors and animated progress", async () => {
  for (const env of [{ NO_COLOR: "", TERM: "xterm-256color" }, { TERM: "dumb" }]) {
    const view = capture(env, true);
    view.ui.header();
    await view.ui.step(1, "Tes", async () => {});
    assert.doesNotMatch(view.text(), /\x1b/);
  }
});

test("terminal progress reports failure and redacts credentials in all error output", async () => {
  const view = capture({ TERM: "xterm-256color" }, true);
  view.ui.addSecret("test-secret");
  const error = new Error("failed for test-secret");
  error.details = "child process echoed test-secret";
  await assert.rejects(view.ui.step(3, "Menguji plugin", async () => { throw error; }));
  view.ui.error(error);
  assert.match(view.text(), /\x1b\[/);
  assert.match(view.text(), /\[REDACTED\]/);
  assert.doesNotMatch(view.text(), /test-secret/);
});
