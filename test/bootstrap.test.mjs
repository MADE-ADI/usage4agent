import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const bootstrap = await readFile(new URL("../install.sh", import.meta.url), "utf8");
const options = { skip: process.platform === "win32" };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mytoken curl "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "archive-root");
  const bin = join(root, "bin");
  const downloads = join(root, "downloads");
  for (const path of [join(source, "scripts"), bin, downloads]) await mkdir(path, { recursive: true });
  await writeFile(join(source, "package.json"), '{"type":"module"}');
  await writeFile(join(source, "scripts/install.mjs"), `
    import { writeFileSync } from "node:fs";
    import { fileURLToPath } from "node:url";
    writeFileSync(process.env.TEST_REPORT, JSON.stringify({
      args: process.argv.slice(2),
      script: fileURLToPath(import.meta.url),
      tty: Boolean(process.stdin.isTTY),
    }));
    process.exitCode = Number(process.env.TEST_SETUP_STATUS || 0);
  `);
  const archive = join(root, "source.tar.gz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", root, "archive-root"], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  const curl = join(bin, "curl");
  await writeFile(curl, `#!/usr/bin/env node
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    fs.writeFileSync(process.env.TEST_DOWNLOAD_LOG, JSON.stringify(args));
    if (process.env.TEST_DOWNLOAD_FAIL) process.exit(22);
    fs.copyFileSync(process.env.TEST_ARCHIVE, args[args.indexOf("--output") + 1]);
  `);
  await chmod(curl, 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: downloads,
    TEST_ARCHIVE: archive,
    TEST_REPORT: join(root, "report.json"),
    TEST_DOWNLOAD_LOG: join(root, "curl.json"),
  };
  delete env.MYTOKEN_REPOSITORY;
  delete env.MYTOKEN_REF;
  return {
    root, source, downloads, env,
    run(args = [], overrides = {}) {
      return spawnSync("bash", ["-s", "--", ...args], {
        input: bootstrap, env: { ...env, ...overrides }, encoding: "utf8",
        cwd: fileURLToPath(new URL("../", import.meta.url)),
      });
    },
  };
}

test("piped bootstrap downloads GitHub archive, forwards arguments, and cleans up", options, async (t) => {
  const setup = await fixture(t);
  const result = setup.run(["--no-input", "--version", "v2"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(setup.env.TEST_REPORT, "utf8"));
  assert.deepEqual(report.args, ["--no-input", "--version", "v2"]);
  assert.equal(report.tty, false);
  assert.ok(report.script.startsWith(setup.downloads));
  const curl = JSON.parse(await readFile(setup.env.TEST_DOWNLOAD_LOG, "utf8"));
  assert.ok(curl.includes("https://codeload.github.com/MADE-ADI/usage4agent/tar.gz/main"));
  assert.equal(curl[curl.indexOf("--proto") + 1], "=https");
  assert.deepEqual(await readdir(setup.downloads), []);
});

test("bootstrap supports a fork and pinned tag without evaluating shell text", options, async (t) => {
  const setup = await fixture(t);
  const result = setup.run(["--no-input"], { MYTOKEN_REPOSITORY: "example/mytoken", MYTOKEN_REF: "v0.1.0" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(await readFile(setup.env.TEST_DOWNLOAD_LOG, "utf8")).includes(
    "https://codeload.github.com/example/mytoken/tar.gz/v0.1.0",
  ));
  const invalid = setup.run([], { MYTOKEN_REPOSITORY: "$(whoami)/repo" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /owner\/repo/);
  const invalidRef = setup.run([], { MYTOKEN_REF: "../main" });
  assert.notEqual(invalidRef.status, 0);
  assert.match(invalidRef.stderr, /MYTOKEN_REF/);
});

test("failed downloads and failed setup preserve their exit status and clean up", options, async (t) => {
  const setup = await fixture(t);
  assert.equal(setup.run(["--no-input"], { TEST_DOWNLOAD_FAIL: "1" }).status, 22);
  assert.deepEqual(await readdir(setup.downloads), []);
  await assert.rejects(readFile(setup.env.TEST_REPORT), { code: "ENOENT" });
  assert.equal(setup.run(["--no-input"], { TEST_SETUP_STATUS: "7" }).status, 7);
  assert.deepEqual(await readdir(setup.downloads), []);
});

test("invalid archives and unexpected archive layouts stop before setup", options, async (t) => {
  const setup = await fixture(t);
  const malformed = join(setup.root, "malformed.tar.gz");
  await writeFile(malformed, "not an archive");
  assert.notEqual(setup.run(["--no-input"], { TEST_ARCHIVE: malformed }).status, 0);
  assert.deepEqual(await readdir(setup.downloads), []);
  await rm(join(setup.source, "scripts"), { recursive: true });
  spawnSync("tar", ["-czf", setup.env.TEST_ARCHIVE, "-C", setup.root, "archive-root"]);
  const result = setup.run(["--no-input"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tidak berisi installer/);
  await assert.rejects(readFile(setup.env.TEST_REPORT), { code: "ENOENT" });
  assert.deepEqual(await readdir(setup.downloads), []);
});

test("local installer runs its own setup without downloading a repository", options, async (t) => {
  const setup = await fixture(t);
  await cp(new URL("../install.sh", import.meta.url), join(setup.source, "install.sh"));
  const result = spawnSync("bash", [join(setup.source, "install.sh"), "--no-input", "--version", "v1"], {
    env: { ...setup.env, TEST_DOWNLOAD_FAIL: "1" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(setup.env.TEST_REPORT, "utf8")).args, ["--no-input", "--version", "v1"]);
  await assert.rejects(readFile(setup.env.TEST_DOWNLOAD_LOG), { code: "ENOENT" });
});

test("help and invalid arguments do not download or run setup", options, async (t) => {
  const setup = await fixture(t);
  const help = setup.run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /curl -fsSL/);
  assert.notEqual(setup.run(["--version", "v3"]).status, 0);
  assert.notEqual(setup.run(["--unknown"]).status, 0);
  await assert.rejects(readFile(setup.env.TEST_DOWNLOAD_LOG), { code: "ENOENT" });
  await assert.rejects(readFile(setup.env.TEST_REPORT), { code: "ENOENT" });
});
