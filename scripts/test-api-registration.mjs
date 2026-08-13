/**
 * End-to-end test for the BYOAPI (Bring Your Own API) flow.
 *
 * The flow is:
 *   1. Start a tiny upstream API server (this script's first half).
 *   2. Register that API with the local sourcesApi middleware by
 *      POSTing to /api/sources with kind=api and a sample response.
 *   3. Read the registered endpoints from the response.
 *   4. Call /api/sources/:id/call?endpoint=<name> for each.
 *   5. Verify the responses match the upstream.
 *
 * The extractor is hit with only sample pairs (no docs), which falls
 * into the "local" path (no LLM call) since the dev server has no
 * MINIMAX_API_KEY in CI. That's the same path a user with no API
 * key would get.
 *
 * Run with:  node scripts/test-api-registration.mjs
 * Exit code 0 = pass, 1 = at least one assertion failed.
 *
 * Assumes a dev server is running on http://localhost:5173 with the
 * sourcesApi middleware wired in. Run `npm run dev` in another shell
 * first.
 */
import process from "node:process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = parseInt(process.env["TEST_API_PORT"] ?? "49100", 10);
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.APP_URL ?? "http://localhost:5173";

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => { console.log(`  ✓ ${name}`); pass++; },
        (e) => { console.error(`  ✗ ${name}: ${e.message}`); fail++; },
      );
    }
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    fail++;
  }
}

// ----- tiny upstream API -----
const upstreamRequests = [];
const upstreamServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://x`);
  upstreamRequests.push({ method: req.method, url: req.url, headers: req.headers });
  if (url.pathname === "/v1/weather/London") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ temp: 18, conditions: "cloudy", city: "London" }));
    return;
  }
  if (url.pathname === "/v1/weather/Tokyo") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ temp: 24, conditions: "sunny", city: "Tokyo" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});
await new Promise((r) => upstreamServer.listen(PORT, "127.0.0.1", r));
console.log(`Upstream test API listening on ${BASE}`);

// ----- helpers -----
async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}
async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}
async function delJson(url) {
  const res = await fetch(url, { method: "DELETE" });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let apiId = null;

try {
  console.log("\nRegistration:");
  const reg = await postJson(`${APP}/api/sources`, {
    kind: "api",
    name: `weather_test_${Date.now()}`,
    baseUrl: BASE,
    samplePairs: [
      {
        label: "London weather",
        method: "GET",
        path: "/v1/weather/London",
        responseBody: JSON.stringify({ temp: 18, conditions: "cloudy", city: "London" }),
      },
    ],
  });
  check("POST /api/sources returns 201", () => {
    if (reg.status !== 201) throw new Error(`status=${reg.status} body=${JSON.stringify(reg.data)}`);
  });
  check("response has no authHeader in public view", () => {
    if ("authHeader" in reg.data) throw new Error("authHeader leaked to client");
  });
  check("response has at least one endpoint", () => {
    if (!Array.isArray(reg.data.endpoints) || reg.data.endpoints.length === 0) {
      throw new Error(`endpoints=${JSON.stringify(reg.data.endpoints)}`);
    }
  });
  check("endpoint has a sanitized snake_case name", () => {
    const ep = reg.data.endpoints[0];
    if (!/^[a-z][a-z0-9_]*$/.test(ep.name)) throw new Error(`bad name: ${ep.name}`);
  });
  check("endpoint has method + path + returnsDescription", () => {
    const ep = reg.data.endpoints[0];
    if (!ep.method || !ep.path || !ep.returnsDescription) {
      throw new Error(`incomplete endpoint: ${JSON.stringify(ep)}`);
    }
  });
  apiId = reg.data.id;

  console.log("\nExecution:");
  const ep = reg.data.endpoints[0];

  // 1. Real call through the middleware.
  const call = await getJson(
    `${APP}/api/sources/${apiId}/call?endpoint=${encodeURIComponent(ep.name)}`,
  );
  check("GET /call returns 200", () => {
    if (call.status !== 200) throw new Error(`status=${call.status} body=${JSON.stringify(call.data)}`);
  });
  check("call returns parsed JSON data", () => {
    if (!call.data.data || typeof call.data.data !== "object") {
      throw new Error(`data=${JSON.stringify(call.data)}`);
    }
  });
  check("call data has the expected fields", () => {
    const d = call.data.data;
    if (typeof d.temp !== "number" || typeof d.conditions !== "string") {
      throw new Error(`bad data: ${JSON.stringify(d)}`);
    }
  });
  check("upstream actually received the request", () => {
    if (upstreamRequests.length === 0) throw new Error("no upstream requests logged");
    const r = upstreamRequests.find((x) => x.url?.includes("/v1/weather/"));
    if (!r) throw new Error(`upstream got: ${JSON.stringify(upstreamRequests)}`);
  });

  // 2. Cache: second call should return cached=true.
  const call2 = await getJson(
    `${APP}/api/sources/${apiId}/call?endpoint=${encodeURIComponent(ep.name)}`,
  );
  check("second call hits the cache", () => {
    if (call2.data.cached !== true) {
      throw new Error(`expected cached=true, got cached=${call2.data.cached}`);
    }
  });

  // 3. fresh=1 bypasses the cache.
  const call3 = await getJson(
    `${APP}/api/sources/${apiId}/call?endpoint=${encodeURIComponent(ep.name)}&fresh=1`,
  );
  check("fresh=1 bypasses the cache", () => {
    if (call3.data.cached !== false) {
      throw new Error(`expected cached=false, got cached=${call3.data.cached}`);
    }
  });

  // 4. Unknown endpoint → 404.
  const bad = await getJson(
    `${APP}/api/sources/${apiId}/call?endpoint=does_not_exist`,
  );
  check("unknown endpoint returns 404", () => {
    if (bad.status !== 404) throw new Error(`expected 404, got ${bad.status}`);
  });

  // 5. GET /api/sources strips authHeader even if the user supplied one.
  const reg2 = await postJson(`${APP}/api/sources`, {
    kind: "api",
    name: `weather_with_auth_${Date.now()}`,
    baseUrl: BASE,
    authHeader: "Bearer secret-token-12345",
    samplePairs: [
      {
        label: "x",
        method: "GET",
        path: "/v1/weather/London",
        responseBody: JSON.stringify({ temp: 1, conditions: "x", city: "L" }),
      },
    ],
  });
  check("authHeader never appears in registration response", () => {
    if ("authHeader" in reg2.data) {
      throw new Error(`authHeader leaked: ${JSON.stringify(reg2.data)}`);
    }
  });
  const list = await getJson(`${APP}/api/sources`);
  check("authHeader never appears in list response", () => {
    for (const s of list.data.sources) {
      if ("authHeader" in s) throw new Error(`leaked from: ${s.id}`);
    }
  });
  // Cleanup the second registration.
  await delJson(`${APP}/api/sources/${reg2.data.id}`);
} finally {
  // Always clean up.
  if (apiId) await delJson(`${APP}/api/sources/${apiId}`);
  upstreamServer.close();
  // Give the server a tick to actually close.
  await sleep(50);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
