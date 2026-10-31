#!/usr/bin/env node
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createUI } from "./ui.mjs";

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

export async function question(prompt, { secret = false, input = process.stdin, output = process.stdout } = {}) {
  // Preserve readline's prompt and terminal controls while masking typed and
  // pasted characters, including full-line redraws after editing the value.
  let reader;
  const masked = secret ? new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString().split(/(\x1b\[[0-?]*[ -/]*[@-~])/u).map((part) => {
        if (part.startsWith("\x1b[")) return part;
        const prefix = part === prompt + (reader?.line || "") ? prompt : "";
        return prefix + part.slice(prefix.length).replace(/[^\r\n\b\t]/gu, "*");
      }).join("");
      output.write(text);
      callback();
    },
  }) : output;
  if (secret) Object.defineProperty(masked, "columns", { get: () => output.columns });
  reader = createInterface({ input, output: masked, terminal: true });
  const controller = new AbortController();
  reader.on("SIGINT", () => controller.abort());
  reader.on("close", () => controller.abort());
  try {
    return await reader.question(prompt, { signal: controller.signal });
  } finally {
    reader.close();
  }
}

function runNpm(args) {
  const npmArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];
  const command = npmArgs.length ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((done, reject) => {
    const child = spawn(command, [...npmArgs, ...args], {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32" && !npmArgs.length,
    });
    let details = "";
    const collect = (chunk) => { details = (details + chunk.toString()).slice(-32_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => reject(new Error("Tidak dapat menjalankan npm. Pastikan npm tersedia.")));
    child.on("close", (status, signal) => {
      if (status === 0) return done();
      const error = new Error(`npm ${args.join(" ")} gagal${signal ? ` (${signal})` : ""}. Plugin belum diterapkan.`);
      error.details = details;
      reject(error);
    });
  });
}

async function main(ui) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Instal /mytoken: npm run setup -- [--no-input] [--version v1|v2]\nAlternatif: bash install.sh [--no-input] [--version v1|v2]\nInstaller menjalankan pemeriksaan, tes, dan validasi API key sebelum menerapkan plugin.\nAPI key wajib tersedia dari prompt, SEKAIGATEWAY_API_KEY, atau pengaturan tersimpan (izin 600).");
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22+ diperlukan.");
  ui.addSecret(process.env.SEKAIGATEWAY_API_KEY);
  ui.header();
  await ui.step(1, "Menyiapkan dependency", () => runNpm(["ci", "--include=dev", "--no-audit", "--no-fund"]));
  await ui.step(2, "Membangun plugin", () => runNpm(["run", "build"]));
  await ui.step(3, "Menguji plugin", async () => {
    await runNpm(["run", "check"]);
    await runNpm(["test"]);
  });
  const { readSettings } = await import("../dist/config.js");
  const saved = await readSettings();
  ui.addSecret(saved.apiKey);
  let apiKey = process.env.SEKAIGATEWAY_API_KEY?.trim() || saved.apiKey?.trim();
  let version = options.version || process.env.SEKAIGATEWAY_USAGE_VERSION || saved.version || "v1";
  ui.section(4, "Konfigurasi akun");
  if (!options.noInput && process.stdin.isTTY && process.stdout.isTTY) {
    ui.note("v1: PAYG / paket token   ·   v2: Coding Plan");
    if (!options.version) {
      do {
        version = (await question(`        Endpoint default [v1/v2] (${version}): `)).trim() || version;
        if (!["v1", "v2"].includes(version)) ui.note("Pilih v1 atau v2.");
      } while (!["v1", "v2"].includes(version));
    }
    const entered = await question(`        API key (${apiKey ? "Enter: gunakan key yang tersedia" : "wajib diisi"}; disamarkan dengan *): `, { secret: true });
    apiKey = entered.trim() || apiKey;
  }
  ui.addSecret(apiKey);
  if (!apiKey) throw new Error("API key wajib diisi untuk validasi. Jalankan installer kembali atau set SEKAIGATEWAY_API_KEY. Plugin belum diterapkan.");
  const { fetchUsage, parseVersion } = await import("../dist/usage.js");
  const selectedVersion = parseVersion(version);
  ui.note(`Endpoint ${selectedVersion} dipilih. Key akan diuji tanpa menampilkan nilainya.`);
  await ui.step(5, `Memvalidasi API key · /${selectedVersion}/usage`, async () => {
    const usage = await fetchUsage({ apiKey, version: selectedVersion });
    if (usage.key?.status !== undefined && usage.key.status !== "active") {
      throw new Error("API key tidak aktif. Plugin belum diterapkan.");
    }
  });
  const result = await ui.step(6, "Menerapkan plugin dan konfigurasi", () => installPlugin({ apiKey, version: selectedVersion }));
  ui.success(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ui = createUI();
  main(ui).catch((error) => {
    // File-system and child-process exceptions may contain sensitive values.
    ui.error(error);
    process.exitCode = 1;
  });
}
