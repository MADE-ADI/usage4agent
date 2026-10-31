import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchUsage, formatUsage, parseVersion, usageReport } from "../dist/usage.js";

const example = {
  object: "usage",
  currency: "IDR",
  balance: { available: 10_000 },
  key: { name: "example", status: "active" },
  payg: { active: false, balance: 0, spent: 0, tokensUsed: 0 },
  codingPlan: {
    active: true,
    status: "active",
    plan: "cp30",
    usage: { requests: 2, tokens: 9_571 },
    expiresAt: "2026-11-30T02:34:14.643Z",
    pool: {
      budget: 3_230_000,
      windows: {
        fiveHour: {
          limit: 290_700, spent: 111.974, remaining: 290_588.026,
          usedPercent: 0.04, resetAt: "2026-10-31T07:34:14.643Z", exceeded: false,
        },
        week: { limit: 1_162_800, remaining: 0, spent: 1_162_800, usedPercent: 100, exceeded: true },
        month: { limit: 2_907_000, remaining: 2_907_000, spent: 0, usedPercent: 0 },
      },
    },
  },
  asOf: "2026-10-31T02:35:03.712Z",
};

async function localGateway(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return (url, options) => {
    assert.equal(new URL(url).origin, "https://api.sekaigateway.xyz");
    return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
  };
}

test("GET usage selects the endpoint and sends Bearer authentication", async (t) => {
  const paths = [];
  const fetcher = await localGateway(t, (request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.authorization, "Bearer test-secret");
    assert.equal(request.headers.accept, "application/json");
    paths.push(request.url);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(example));
  });
  for (const version of ["v1", "v2"]) {
    assert.deepEqual(await fetchUsage({ apiKey: " test-secret ", version, fetcher }), example);
  }
  assert.deepEqual(paths, ["/v1/usage", "/v2/usage"]);
});

test("invalid configuration fails before making a request", async () => {
  const fetcher = () => assert.fail("must not make a request");
  await assert.rejects(fetchUsage({ apiKey: "  ", version: "v1", fetcher }), /SEKAIGATEWAY_API_KEY/);
  await assert.rejects(fetchUsage({ apiKey: "test-secret", version: "../other", fetcher }), /Gunakan/);
  assert.equal(parseVersion(undefined), "v1");
  assert.equal(parseVersion("", "v2"), "v2");
  assert.equal(parseVersion(" v1 ", "v2"), "v1");
  for (const input of ["v3", "v1 extra", "$(whoami)"]) {
    assert.throws(() => parseVersion(input), /Gunakan/);
  }
});

test("HTTP failures never expose upstream bodies or API keys", async (t) => {
  for (const status of [401, 403, 429, 500]) {
    await t.test(String(status), async (t) => {
      const fetcher = await localGateway(t, (_request, response) => {
        response.writeHead(status);
        response.end("Authorization: Bearer test-secret");
      });
      await assert.rejects(fetchUsage({ apiKey: "test-secret", version: "v1", fetcher }), (error) => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(error.message, /test-secret|Authorization/);
        return true;
      });
    });
  }
});

test("redirects are rejected without sending credentials to another path", async (t) => {
  const paths = [];
  const fetcher = await localGateway(t, (request, response) => {
    paths.push(request.url);
    response.writeHead(302, { Location: "/other" });
    response.end();
  });
  await assert.rejects(fetchUsage({ apiKey: "test-secret", version: "v1", fetcher }), /Tidak dapat menghubungi/);
  assert.deepEqual(paths, ["/v1/usage"]);
});

test("malformed JSON and unexpected response shapes have readable errors", async (t) => {
  for (const body of ["<html>error</html>", "null", "[]", '{"error":"failed"}']) {
    const fetcher = await localGateway(t, (_request, response) => response.end(body));
    await assert.rejects(fetchUsage({ apiKey: "test-secret", version: "v1", fetcher }), /JSON|Format respons/);
  }
});

test("timeout also covers an incomplete response body", async (t) => {
  const fetcher = await localGateway(t, (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"object":"usage"');
  });
  await assert.rejects(fetchUsage({ apiKey: "test-secret", version: "v1", fetcher, timeoutMs: 100 }), /batas 0.1 detik/);
});

test("network errors are sanitized", async () => {
  const fetcher = async () => { throw new Error("test-secret: connection refused"); };
  await assert.rejects(fetchUsage({ apiKey: "test-secret", version: "v1", fetcher }), (error) => {
    assert.match(error.message, /koneksi internet/);
    assert.doesNotMatch(error.message, /test-secret/);
    return true;
  });
});

test("report distinguishes tokens from currency and renders all coding windows", () => {
  const report = formatUsage(example, "v2");
  for (const expected of [
    "Sekai Gateway · v2", "Saldo tersedia: IDR 10.000", "PAYG: nonaktif",
    "Coding Plan: cp30 (active)", "Token terpakai: 9.571 · Request: 2",
    "Budget pool: IDR 3.230.000", "5 jam: 0,04% terpakai",
    "Terpakai: IDR 111,974 / IDR 290.700", "Sisa: IDR 290.588,026",
    "Mingguan: 100% terpakai · BATAS TERCAPAI", "Bulanan: 0% terpakai",
  ]) assert.ok(report.includes(expected), expected);
  assert.doesNotMatch(report, /undefined|NaN|Invalid Date/);
});

test("PAYG-only data does not invent a coding plan or missing usage totals", () => {
  const report = formatUsage({ object: "usage", payg: { active: true, balance: 0 } }, "v1");
  assert.match(report, /PAYG: aktif/);
  assert.match(report, /Saldo: IDR 0 · Terpakai: —/);
  assert.match(report, /Token terpakai: —/);
  assert.doesNotMatch(report, /Coding Plan|5 jam|undefined|NaN/);
});

test("end-to-end report applies environment defaults and redacts an echoed key", async (t) => {
  const config = await mkdtemp(join(tmpdir(), "mytoken-report-"));
  t.after(() => rm(config, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const paths = [];
  globalThis.fetch = async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    return Response.json({ ...example, key: { name: "test-secret", status: "active" } });
  };
  const env = { XDG_CONFIG_HOME: config, SEKAIGATEWAY_API_KEY: "test-secret", SEKAIGATEWAY_USAGE_VERSION: "v2" };
  assert.match(await usageReport(undefined, env), /Key: \[REDACTED\]/);
  assert.doesNotMatch(await usageReport("v1", env), /test-secret/);
  assert.deepEqual(paths, ["/v2/usage", "/v1/usage"]);
});
