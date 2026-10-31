#!/usr/bin/env node
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const repo = fileURLToPath(new URL("../", import.meta.url));

async function atomicWrite(path, text, mode) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { mode, flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function installPlugin({ source = repo, env = process.env, apiKey, version } = {}) {
  const { configPaths, readJsonObject, readSettings } = await import("../dist/config.js");
  const paths = configPaths(env);
  const cli = await readJsonObject(paths.cli);
  const oldSettings = await readJsonObject(paths.settings);
  const saved = await readSettings(env);
  if (cli.data.plugins !== undefined && !Array.isArray(cli.data.plugins)) {
    throw new Error(`plugins di ${paths.cli} harus berupa array. Konfigurasi tidak diubah.`);
  }
  const selectedVersion = version || env.SEKAIGATEWAY_USAGE_VERSION || saved.version || "v1";
  if (selectedVersion !== "v1" && selectedVersion !== "v2") throw new Error("Versi harus v1 atau v2.");
  const settings = {
    ...oldSettings.data,
    version: selectedVersion,
  };
  const selectedKey = apiKey?.trim() || env.SEKAIGATEWAY_API_KEY?.trim() || saved.apiKey?.trim();
  if (selectedKey) settings.apiKey = selectedKey;

  const packageData = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const parent = dirname(paths.plugin);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, ".install-"));
  const previous = `${stage}.previous`;
  let movedPrevious = false;
  let installed = false;
  let settingsWritten = false;
  let backup;
  try {
    await cp(join(source, "dist"), join(stage, "dist"), { recursive: true });
    await writeFile(join(stage, "package.json"), JSON.stringify({
      name: packageData.name,
      version: packageData.version,
      type: "module",
      exports: { "./tui": "./dist/tui.js" },
    }, null, 2) + "\n");
    await copyFile(join(source, "README.md"), join(stage, "README.md"));

    const entryPath = (entry) => {
      const target = typeof entry === "string" ? entry : entry?.package;
      if (typeof target !== "string") return undefined;
      if (target.startsWith("file://")) return fileURLToPath(target);
      return resolve(paths.config, target);
    };
    const plugins = (cli.data.plugins || []).map((entry) => {
      if (entryPath(entry) !== resolve(source)) return entry;
      return typeof entry === "string" ? paths.plugin : { ...entry, package: paths.plugin };
    });
    const hasPlugin = plugins.some((entry) => entryPath(entry) === paths.plugin);
    if (!hasPlugin) plugins.push(paths.plugin);
    const updated = { $schema: "https://opencode.ai/v2/cli.json", ...cli.data, plugins };
    const cliText = JSON.stringify(updated, null, 2) + "\n";
    await mkdir(paths.config, { recursive: true });
    if (cli.text !== undefined && cli.text !== cliText) {
      backup = `${paths.cli}.mytoken-backup-${randomUUID()}`;
      await copyFile(paths.cli, backup, constants.COPYFILE_EXCL);
      await chmod(backup, 0o600);
    }
    try {
      await rename(paths.plugin, previous);
      movedPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(stage, paths.plugin);
    installed = true;
    await atomicWrite(paths.settings, JSON.stringify(settings, null, 2) + "\n", 0o600);
    settingsWritten = true;
    if (cli.text !== cliText) await atomicWrite(paths.cli, cliText, 0o600);
  } catch (error) {
    try {
      if (settingsWritten) {
        if (oldSettings.text === undefined) await rm(paths.settings, { force: true });
        else await atomicWrite(paths.settings, oldSettings.text, 0o600);
      }
    } finally {
      if (installed) await rm(paths.plugin, { recursive: true, force: true });
      if (movedPrevious) await rename(previous, paths.plugin);
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  if (movedPrevious) await rm(previous, { recursive: true, force: true });
  return { ...paths, backup, hasKey: Boolean(selectedKey), version: selectedVersion };
}

function parseArgs(args) {
  const options = { noInput: false, help: false, version: undefined };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--help" || args[index] === "-h") options.help = true;
    else if (args[index] === "--no-input") options.noInput = true;
    else if (args[index] === "--version" && ["v1", "v2"].includes(args[index + 1])) options.version = args[++index];
    else throw new Error("Argumen tidak dikenal. Gunakan --help, --no-input, atau --version v1|v2.");
  }
  return options;
}

async function question(prompt, { secret = false } = {}) {
  // A muted terminal output keeps typed and pasted credentials out of the screen.
  const output = secret ? new Writable({ write(_chunk, _encoding, callback) { callback(); } }) : process.stdout;
  const input = createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  input.on("SIGINT", () => controller.abort());
  input.on("close", () => controller.abort());
  if (secret) process.stdout.write(prompt);
  try {
    return await input.question(secret ? "" : prompt, { signal: controller.signal });
  } finally {
    input.close();
    if (secret) process.stdout.write("\n");
  }
}

function build() {
  const npmArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];
  const command = npmArgs.length ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  for (const args of [["ci", "--include=dev", "--no-audit", "--no-fund"], ["run", "build"]]) {
    const result = spawnSync(command, [...npmArgs, ...args], {
      cwd: repo,
      stdio: "inherit",
      shell: process.platform === "win32" && !npmArgs.length,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`npm ${args[0]} gagal. Pastikan npm tersedia dan koneksi internet berfungsi.`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Instal /mytoken: npm run setup -- [--no-input] [--version v1|v2]\nAlternatif: bash install.sh [--no-input] [--version v1|v2]\nAPI key dari prompt atau SEKAIGATEWAY_API_KEY disimpan di mytoken.json (izin 600).");
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22+ diperlukan.");
  console.log("Membangun dan memasang plugin /mytoken…");
  build();
  const { readSettings } = await import("../dist/config.js");
  const saved = await readSettings();
  let apiKey;
  let version = options.version || process.env.SEKAIGATEWAY_USAGE_VERSION || saved.version || "v1";
  if (!options.noInput && process.stdin.isTTY && process.stdout.isTTY) {
    const hasKey = Boolean(process.env.SEKAIGATEWAY_API_KEY?.trim() || saved.apiKey?.trim());
    apiKey = await question(`API key Sekai Gateway (input tersembunyi; Enter untuk ${hasKey ? "memakai key yang tersedia" : "melewati"}): `, { secret: true });
    if (!options.version) version = (await question(`Endpoint default [v1/v2] (${version}): `)).trim() || version;
  }
  const result = await installPlugin({ apiKey, version });
  console.log(`\n/mytoken terpasang: ${result.plugin}\nKonfigurasi OpenCode: ${result.cli}\nPengaturan lokal: ${result.settings}\nEndpoint default: ${result.version}`);
  if (result.backup) console.log(`Backup konfigurasi: ${result.backup}`);
  if (!result.hasKey) console.log("API key belum diisi. Jalankan installer kembali atau set SEKAIGATEWAY_API_KEY.");
  console.log("Mulai ulang OpenCode, lalu jalankan /mytoken.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // File-system and child-process exceptions may contain sensitive values.
    console.error(error.name === "AbortError" ? "Instalasi dibatalkan." :
      error.code ? `Instalasi gagal (${error.code}). Periksa izin file dan jalankan kembali.` : error.message);
    process.exitCode = 1;
  });
}
