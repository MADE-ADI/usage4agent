import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { question } from "../scripts/install.mjs";

function terminal() {
  const input = new PassThrough();
  let text = "";
  const output = new Writable({ write(chunk, _encoding, callback) { text += chunk.toString(); callback(); } });
  output.columns = 120;
  return { input, output, text: () => text };
}

test("secret prompt shows asterisks immediately while returning the original key", async () => {
  const view = terminal();
  const answer = question("API key: ", { ...view, secret: true });
  view.input.write("test-secret");
  assert.ok(view.text().includes("API key: "));
  assert.ok(view.text().endsWith("***********"), view.text());
  assert.doesNotMatch(view.text(), /test-secret/);
  view.input.write("\r");
  assert.equal(await answer, "test-secret");
  assert.doesNotMatch(view.text(), /test-secret/);
});

test("pasted keys stay masked and backspace redraws keep the prompt visible", async () => {
  const view = terminal();
  const answer = question("API key: ", { ...view, secret: true });
  view.input.write("pasted-secretX");
  view.input.write("\x7f");
  assert.ok(view.text().includes("API key: *************"), view.text());
  view.input.write("\r");
  assert.equal(await answer, "pasted-secret");
  assert.doesNotMatch(view.text(), /pasted-secret|secretX/);
});

test("cursor movement and deletion edit the key without exposing characters", async () => {
  const view = terminal();
  const answer = question("API key: ", { ...view, secret: true });
  view.input.write("abcXdef");
  view.input.write("\x1b[D\x1b[D\x1b[D");
  view.input.write("\x7f");
  view.input.write("\r");
  assert.equal(await answer, "abcdef");
  assert.doesNotMatch(view.text(), /abc|def|X/);
  assert.ok(view.text().includes("API key: ******"));
});

test("empty Enter remains empty so the installer can retain an existing key", async () => {
  const view = terminal();
  const answer = question("API key: ", { ...view, secret: true });
  view.input.write("\r");
  assert.equal(await answer, "");
  assert.doesNotMatch(view.text(), /\*/);
});

test("Ctrl+C cancels masked input without revealing its value", async () => {
  const view = terminal();
  const answer = question("API key: ", { ...view, secret: true });
  view.input.write("private-value");
  view.input.write("\x03");
  await assert.rejects(answer, { name: "AbortError" });
  assert.doesNotMatch(view.text(), /private-value/);
});

test("ordinary endpoint questions still display normal input", async () => {
  const view = terminal();
  const answer = question("Endpoint: ", view);
  view.input.write("v2\r");
  assert.equal(await answer, "v2");
  assert.match(stripVTControlCharacters(view.text()), /Endpoint: v2/);
});
