import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPlugin } from "../scripts/install.mjs";
import { configPaths, readSettings } from "../dist/config.js";
import { usageReport } from "../dist/usage.js";

async function sandbox(t) {
  const home = await mkdtemp(join(tmpdir(), "mytoken installer "));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data") };
  const paths = configPaths(env);
  await mkdir(paths.config, { recursive: true });
  return { env, paths };
}

test("fresh installation copies a standalone plugin and writes private settings", async (t) => {
  const { env, paths } = await sandbox(t);
  const result = await installPlugin({ env, apiKey: "test-secret", version: "v2" });
  const cli = JSON.parse(await readFile(paths.cli, "utf8"));
  assert.deepEqual(cli.plugins, [paths.plugin]);
  assert.equal(cli.$schema, "https://opencode.ai/v2/cli.json");
  assert.doesNotMatch(await readFile(paths.cli, "utf8"), /test-secret/);
  assert.deepEqual(await readSettings(env), { apiKey: "test-secret", version: "v2" });
  assert.equal(result.hasKey, true);
  assert.equal(result.backup, undefined);
  assert.ok((await readFile(join(paths.plugin, "dist/tui.js"), "utf8")).includes("sekai.mytoken"));
  assert.equal(JSON.parse(await readFile(join(paths.plugin, "package.json"), "utf8")).exports["./tui"], "./dist/tui.js");
  await assert.rejects(stat(join(paths.plugin, "node_modules")), { code: "ENOENT" });
  if (process.platform !== "win32") assert.equal((await stat(paths.settings)).mode & 0o777, 0o600);
});

test("existing CLI settings and plugin options survive repeated installation", async (t) => {
  const { env, paths } = await sandbox(t);
  const original = {
    theme: { name: "tokyonight" },
    keybinds: { "app.exit": ["ctrl+c"] },
    plugins: ["other-plugin", { package: paths.plugin, options: { compact: true } }],
  };
  const raw = JSON.stringify(original);
  await writeFile(paths.cli, raw);
  await writeFile(paths.settings, JSON.stringify({ apiKey: "previous-key", version: "v1", custom: true }));
  const first = await installPlugin({ env, apiKey: "replacement-key", version: "v2" });
  assert.equal(await readFile(first.backup, "utf8"), raw);
  if (process.platform !== "win32") assert.equal((await stat(first.backup)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(paths.cli, "utf8")), { $schema: "https://opencode.ai/v2/cli.json", ...original });
  assert.deepEqual(JSON.parse(await readFile(paths.settings, "utf8")), { apiKey: "replacement-key", version: "v2", custom: true });
  const second = await installPlugin({ env });
  assert.equal(second.backup, undefined);
  assert.equal(second.version, "v2");
  assert.equal((await readdir(paths.config)).filter((file) => file.includes("mytoken-backup")).length, 1);
  assert.deepEqual(JSON.parse(await readFile(paths.cli, "utf8")).plugins, original.plugins);
  assert.deepEqual(await readdir(dirname(paths.plugin)), ["plugin"]);
});

test("file URL registration is recognized without adding a duplicate", async (t) => {
  const { env, paths } = await sandbox(t);
  const entry = pathToFileURL(paths.plugin).href;
  await writeFile(paths.cli, JSON.stringify({ plugins: [entry] }));
  await installPlugin({ env });
  assert.deepEqual(JSON.parse(await readFile(paths.cli, "utf8")).plugins, [entry]);
});

test("manual repository registration moves to the installed copy and keeps its options", async (t) => {
  const { env, paths } = await sandbox(t);
  const source = fileURLToPath(new URL("../", import.meta.url));
  await writeFile(paths.cli, JSON.stringify({ plugins: [{ package: source, options: { compact: true } }] }));
  await installPlugin({ env });
  assert.deepEqual(JSON.parse(await readFile(paths.cli, "utf8")).plugins, [
    { package: paths.plugin, options: { compact: true } },
  ]);
});

test("malformed CLI config is preserved and errors never quote its contents", async (t) => {
  const { env, paths } = await sandbox(t);
  const original = '{"secret":"test-secret",';
  await writeFile(paths.cli, original);
  await assert.rejects(installPlugin({ env }), (error) => {
    assert.match(error.message, /JSON tidak valid/);
    assert.doesNotMatch(error.message, /test-secret/);
    return true;
  });
  assert.equal(await readFile(paths.cli, "utf8"), original);
  await assert.rejects(stat(paths.plugin), { code: "ENOENT" });
  await assert.rejects(stat(paths.settings), { code: "ENOENT" });
});

test("invalid settings or plugin arrays fail before replacing an installation", async (t) => {
  const { env, paths } = await sandbox(t);
  await installPlugin({ env, apiKey: "previous-key" });
  const previous = await readFile(join(paths.plugin, "dist/tui.js"), "utf8");
  await assert.rejects(installPlugin({ env, version: "v3" }), /Versi harus/);
  await writeFile(paths.settings, '{"apiKey":42}');
  await assert.rejects(installPlugin({ env }), /Konfigurasi tidak valid/);
  await writeFile(paths.settings, '{}');
  await writeFile(paths.cli, '{"plugins":"invalid"}');
  await assert.rejects(installPlugin({ env }), /harus berupa array/);
  assert.equal(await readFile(join(paths.plugin, "dist/tui.js"), "utf8"), previous);
  assert.equal(await readFile(paths.cli, "utf8"), '{"plugins":"invalid"}');
});

test("failed artifact staging keeps the previous plugin and configuration", async (t) => {
  const { env, paths } = await sandbox(t);
  await installPlugin({ env, apiKey: "previous-key" });
  const previousPlugin = await readFile(join(paths.plugin, "dist/tui.js"), "utf8");
  const previousCli = await readFile(paths.cli, "utf8");
  const brokenSource = join(env.HOME, "broken-source");
  await mkdir(brokenSource);
  await writeFile(join(brokenSource, "package.json"), '{"name":"broken","version":"1.0.0"}');
  await assert.rejects(installPlugin({ env, source: brokenSource }), { code: "ENOENT" });
  assert.equal(await readFile(join(paths.plugin, "dist/tui.js"), "utf8"), previousPlugin);
  assert.equal(await readFile(paths.cli, "utf8"), previousCli);
  assert.equal((await readSettings(env)).apiKey, "previous-key");
  assert.deepEqual(await readdir(dirname(paths.plugin)), ["plugin"]);
});

test("installed settings supply credentials and version, with environment and command overrides", async (t) => {
  const { env } = await sandbox(t);
  await installPlugin({ env, apiKey: "saved-test-key", version: "v2" });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push([new URL(url).pathname, options.headers.Authorization]);
    return Response.json({ object: "usage", key: { name: options.headers.Authorization, status: "active" } });
  };
  assert.doesNotMatch(await usageReport(undefined, env), /saved-test-key/);
  await usageReport(undefined, { ...env, SEKAIGATEWAY_API_KEY: "environment-key", SEKAIGATEWAY_USAGE_VERSION: "v1" });
  await usageReport("v2", { ...env, SEKAIGATEWAY_USAGE_VERSION: "v1" });
  assert.deepEqual(requests, [
    ["/v2/usage", "Bearer saved-test-key"],
    ["/v1/usage", "Bearer environment-key"],
    ["/v2/usage", "Bearer saved-test-key"],
  ]);
});

test("malformed credential files produce sanitized report errors", async (t) => {
  const { env, paths } = await sandbox(t);
  await writeFile(paths.settings, '{"apiKey":"test-secret",');
  await assert.rejects(usageReport(undefined, env), (error) => {
    assert.match(error.message, /JSON tidak valid/);
    assert.doesNotMatch(error.message, /test-secret/);
    return true;
  });
});
