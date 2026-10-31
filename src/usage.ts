import { readSettings } from "./config.js";

export type UsageVersion = "v1" | "v2";
type RecordValue = Record<string, unknown>;

export class UsageError extends Error {}

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseVersion(input: string | undefined, defaultVersion = "v1"): UsageVersion {
  const version = input?.trim() || defaultVersion;
  if (version !== "v1" && version !== "v2") {
    throw new UsageError("Gunakan /mytoken, /mytoken v1, atau /mytoken v2.");
  }
  return version;
}

export async function fetchUsage({
  apiKey,
  version,
  fetcher = fetch,
  timeoutMs = 15_000,
}: {
  apiKey: string | undefined;
  version: UsageVersion;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<RecordValue> {
  const key = apiKey?.trim();
  if (!key) {
    throw new UsageError("Jalankan installer untuk menyimpan API key, atau set SEKAIGATEWAY_API_KEY sebelum menjalankan OpenCode.");
  }
  // Validate at the request boundary as well; never interpolate arbitrary paths.
  parseVersion(version);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetcher(`https://api.sekaigateway.xyz/${version}/usage`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? "Periksa API key dan akses paket."
        : response.status === 429
          ? "Batas request tercapai. Coba lagi nanti."
          : "Coba lagi nanti.";
      // Do not include response bodies: upstream errors may contain credentials.
      throw new UsageError(`Sekai Gateway: HTTP ${response.status}. ${hint}`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new UsageError("Respons Sekai Gateway bukan JSON yang valid.");
    }
    const usage = record(data);
    if (usage.object !== "usage") {
      throw new UsageError("Format respons Sekai Gateway tidak dikenali.");
    }
    return usage;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (signal.aborted) {
      throw new UsageError(`Request Sekai Gateway melewati batas ${timeoutMs / 1000} detik.`);
    }
    throw new UsageError("Tidak dapat menghubungi Sekai Gateway. Periksa koneksi internet.");
  }
}

export function formatUsage(data: RecordValue, version: UsageVersion): string {
  const lines = [`Sekai Gateway · ${version}`];
  const currency = typeof data.currency === "string" ? data.currency : "IDR";
  const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
  const count = (value: unknown) => number(value) ? decimal.format(value) : "—";
  const money = (value: unknown) => number(value) ? `${currency} ${count(value)}` : "—";
  const text = (value: unknown) => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    : "—";
  const date = (value: unknown) => {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "—";
    return new Date(value).toLocaleString("id-ID", { timeZoneName: "short" });
  };
  const state = (value: unknown) => value === true ? "aktif" : value === false ? "nonaktif" : "—";

  const key = record(data.key);
  if (key.name !== undefined) lines.push(`Key: ${text(key.name)} (${text(key.status)})`);
  const balance = record(data.balance);
  if (balance.available !== undefined) lines.push(`Saldo tersedia: ${money(balance.available)}`);

  const payg = record(data.payg);
  if (Object.keys(payg).length) {
    lines.push("", `PAYG: ${state(payg.active)}`);
    lines.push(`Saldo: ${money(payg.balance)} · Terpakai: ${money(payg.spent)}`);
    lines.push(`Token terpakai: ${count(payg.tokensUsed)}`);
  }

  const plan = record(data.codingPlan);
  if (Object.keys(plan).length) {
    lines.push("", `Coding Plan: ${text(plan.plan)} (${text(plan.status ?? state(plan.active))})`);
    const usage = record(plan.usage);
    lines.push(`Token terpakai: ${count(usage.tokens)} · Request: ${count(usage.requests)}`);
    if (plan.expiresAt !== undefined) lines.push(`Berakhir: ${date(plan.expiresAt)}`);
    const pool = record(plan.pool);
    if (pool.budget !== undefined) lines.push(`Budget pool: ${money(pool.budget)}`);
    const windows = record(pool.windows);
    for (const [id, label] of [["fiveHour", "5 jam"], ["week", "Mingguan"], ["month", "Bulanan"]]) {
      const window = record(windows[id]);
      if (!Object.keys(window).length) continue;
      lines.push("", `${label}: ${count(window.usedPercent)}% terpakai${window.exceeded === true ? " · BATAS TERCAPAI" : ""}`);
      lines.push(`Terpakai: ${money(window.spent)} / ${money(window.limit)}`);
      lines.push(`Sisa: ${money(window.remaining)} · Reset: ${date(window.resetAt)}`);
    }
  }
  if (data.asOf !== undefined) lines.push("", `Diperbarui: ${date(data.asOf)}`);
  return lines.join("\n");
}

export async function usageReport(input?: string, env = process.env): Promise<string> {
  let settings: Awaited<ReturnType<typeof readSettings>>;
  try {
    settings = await readSettings(env);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const version = parseVersion(input, env.SEKAIGATEWAY_USAGE_VERSION || settings.version || "v1");
  const apiKey = env.SEKAIGATEWAY_API_KEY?.trim() || settings.apiKey;
  const data = await fetchUsage({ apiKey, version });
  const report = formatUsage(data, version);
  return apiKey?.trim() ? report.replaceAll(apiKey.trim(), "[REDACTED]") : report;
}
