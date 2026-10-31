import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function configPaths(env: NodeJS.ProcessEnv = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const config = resolve(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
  const data = resolve(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode-mytoken");
  return {
    config,
    cli: join(config, "cli.json"),
    settings: join(config, "mytoken.json"),
    plugin: join(data, "plugin"),
  };
}

export async function readJsonObject(path: string): Promise<{ text: string | undefined; data: Record<string, unknown> }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: undefined, data: {} };
    throw new Error(`Tidak dapat membaca ${path}. Periksa izin file.`);
  }
  try {
    const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return { text, data: data as Record<string, unknown> };
  } catch {
    // Never include the parser's error, which may quote a stored API key.
    throw new Error(`JSON tidak valid di ${path}. Perbaiki file tersebut terlebih dahulu.`);
  }
}

export async function readSettings(env: NodeJS.ProcessEnv = process.env) {
  const path = configPaths(env).settings;
  const { data } = await readJsonObject(path);
  if ((data.apiKey !== undefined && typeof data.apiKey !== "string") ||
      (data.version !== undefined && data.version !== "v1" && data.version !== "v2")) {
    throw new Error(`Konfigurasi tidak valid di ${path}. Gunakan apiKey berupa teks dan version v1 atau v2.`);
  }
  return data as { apiKey?: string; version?: "v1" | "v2" };
}
