import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mytoken validated flow "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const config = join(root, "config/opencode");
  const plugin = join(root, "data/opencode-mytoken/plugin");
  await mkdir(join(source, "scripts"), { recursive: true });
  await mkdir(config, { recursive: true });
  await mkdir(plugin, { recursive: true });
  await cp(new URL("../dist", import.meta.url), join(source, "dist"), { recursive: true });
  for (const file of ["scripts/install.mjs", "scripts/ui.mjs", "package.json", "README.md"]) {
    await cp(new URL(`../${file}`, import.meta.url), join(source, file));
  }
  const cli = '{"theme":{"name":"old-theme"},"plugins":["other-plugin"]}';
  const settings = '{"apiKey":"previous-key","version":"v1"}';
  await writeFile(join(config, "cli.json"), cli);
  await writeFile(join(config, "mytoken.json"), settings);
  await writeFile(join(plugin, "previous.txt"), "previous plugin");
  const npm = join(root, "npm.mjs");
  await writeFile(npm, `
    import { appendFileSync } from "node:fs";
    const args = process.argv.slice(2);
    appendFileSync(process.env.TEST_COMMANDS, JSON.stringify(args) + "\\n");
    console.log("normal child-process output should stay hidden");
    if (args.join(" ") === process.env.TEST_FAIL_COMMAND) {
      console.error("test failure with " + process.env.SEKAIGATEWAY_API_KEY);
      process.exitCode = 1;
    }
  `);
  const preload = join(root, "fetch.mjs");
  await writeFile(preload, `
    import { readFileSync, writeFileSync } from "node:fs";
    globalThis.fetch = async (url, options) => {
      writeFileSync(process.env.TEST_API_LOG, JSON.stringify({
        url,
        authorizationMatches: options.headers.Authorization === "Bearer " + process.env.SEKAIGATEWAY_API_KEY,
        cli: readFileSync(process.env.TEST_CLI, "utf8"),
      }));
      const status = Number(process.env.TEST_API_STATUS || 200);
      if (process.env.TEST_BAD_JSON) return new Response("bad JSON", { status });
      return Response.json({ object: "usage", key: { status: process.env.TEST_KEY_STATUS || "active" } }, { status });
    };
  `);
  const env = {
    ...process.env,
    NO_COLOR: "1",
    npm_execpath: npm,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    SEKAIGATEWAY_API_KEY: "flow-test-secret",
    TEST_COMMANDS: join(root, "commands.jsonl"),
    TEST_API_LOG: join(root, "api.json"),
    TEST_CLI: join(config, "cli.json"),
  };
  delete env.SEKAIGATEWAY_USAGE_VERSION;
  return {
    root, source, config, plugin, cli, settings, env,
    run(overrides = {}) {
      return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(source, "scripts/install.mjs"), "--no-input", "--version", "v2"], {
        env: { ...env, ...overrides }, encoding: "utf8",
      });
    },
    async assertUnchanged() {
      assert.equal(await readFile(join(config, "cli.json"), "utf8"), cli);
      assert.equal(await readFile(join(config, "mytoken.json"), "utf8"), settings);
      assert.equal(await readFile(join(plugin, "previous.txt"), "utf8"), "previous plugin");
    },
  };
}

test("CLI applies only after build, checks, tests, and authenticated usage validation", async (t) => {
  const setup = await fixture(t);
  const result = setup.run();
  assert.equal(result.status, 0, result.stderr);
  const commands = (await readFile(setup.env.TEST_COMMANDS, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(commands, [
    ["ci", "--include=dev", "--no-audit", "--no-fund"],
    ["run", "build"], ["run", "check"], ["test"],
  ]);
  const request = JSON.parse(await readFile(setup.env.TEST_API_LOG, "utf8"));
  assert.equal(request.url, "https://api.sekaigateway.xyz/v2/usage");
  assert.equal(request.authorizationMatches, true);
  assert.equal(request.cli, setup.cli, "API validation must precede any config change");
  assert.ok(JSON.parse(await readFile(join(setup.config, "cli.json"), "utf8")).plugins.includes(setup.plugin));
  assert.equal(JSON.parse(await readFile(join(setup.config, "mytoken.json"), "utf8")).apiKey, "flow-test-secret");
  assert.match(result.stdout, /\[OK\] \[3\/6\] Menguji plugin/);
  assert.match(result.stdout, /\[OK\] \[5\/6\] Memvalidasi API key/);
  assert.match(result.stdout, /Instalasi berhasil/);
  assert.doesNotMatch(result.stdout + result.stderr, /flow-test-secret|normal child-process output|\x1b/);
});

test("failing checks or tests stop before network validation and preserve previous installation", async (t) => {
  for (const command of ["run build", "run check", "test"]) {
    await t.test(command, async (t) => {
      const setup = await fixture(t);
      const result = setup.run({ TEST_FAIL_COMMAND: command });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Plugin belum diterapkan/);
      assert.match(result.stderr, /\[REDACTED\]/);
      assert.doesNotMatch(result.stdout + result.stderr, /flow-test-secret|Instalasi berhasil/);
      await setup.assertUnchanged();
      await assert.rejects(readFile(setup.env.TEST_API_LOG), { code: "ENOENT" });
    });
  }
});

test("invalid API keys, upstream failures, and malformed responses cannot replace existing configuration", async (t) => {
  for (const overrides of [{ TEST_API_STATUS: "401" }, { TEST_API_STATUS: "429" }, { TEST_API_STATUS: "500" }, { TEST_BAD_JSON: "1" }, { TEST_KEY_STATUS: "disabled" }]) {
    await t.test(JSON.stringify(overrides), async (t) => {
      const setup = await fixture(t);
      const result = setup.run(overrides);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /\[GAGAL\] \[5\/6\]/);
      assert.doesNotMatch(result.stdout, /\[6\/6\]|Instalasi berhasil/);
      assert.doesNotMatch(result.stdout + result.stderr, /flow-test-secret/);
      await setup.assertUnchanged();
    });
  }
});

test("missing API key stops installation without saving empty credentials", async (t) => {
  const setup = await fixture(t);
  await writeFile(join(setup.config, "mytoken.json"), '{"version":"v1"}');
  const result = setup.run({ SEKAIGATEWAY_API_KEY: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /API key wajib diisi/);
  assert.equal(await readFile(join(setup.config, "cli.json"), "utf8"), setup.cli);
  assert.equal(await readFile(join(setup.config, "mytoken.json"), "utf8"), '{"version":"v1"}');
  assert.equal(await readFile(join(setup.plugin, "previous.txt"), "utf8"), "previous plugin");
  await assert.rejects(readFile(setup.env.TEST_API_LOG), { code: "ENOENT" });
});
