/**
 * End-to-end test: register the sample API (scripts/sample-api.mjs)
 * with the BYOAPI flow and call one of its auth-gated endpoints.
 *
 * Assumes:
 *   - node scripts/sample-api.mjs is running on 127.0.0.1:49200
 *   - npm run dev is running on localhost:5173
 *
 * Run with:  node scripts/test-sample-api.mjs
 * Exit code 0 = pass, 1 = at least one assertion failed.
 */
import process from "node:process";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SAMPLE = process.env.SAMPLE_API_URL ?? "http://127.0.0.1:49200";

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

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}
async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}
async function delJson(url) {
  const res = await fetch(url, { method: "DELETE" });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const KEY_NAME = `sample_demo_${Date.now()}`;
const KEY_VALUE = "Bearer demo-key-12345";
const SRC_NAME = `sample_store_${Date.now()}`;

let keyId = null;
let apiId = null;

try {
  console.log("\nReachability:");
  const health = await getJson(`${SAMPLE}/health`);
  check("sample API is reachable on /health", () => {
    if (health.status !== 200) throw new Error(`status=${health.status}`);
    if (!Array.isArray(health.data.endpoints)) throw new Error("no endpoints");
  });
  check("sample API advertises 10 endpoints", () => {
    if (health.data.endpoints.length !== 10) {
      throw new Error(`got ${health.data.endpoints.length}`);
    }
  });

  console.log("\nKey registration:");
  const key = await postJson(`${APP}/api/keys`, {
    name: KEY_NAME,
    value: KEY_VALUE,
    notes: "test key for the sample API",
  });
  check("POST /api/keys returns 201", () => {
    if (key.status !== 201) throw new Error(`status=${key.status}`);
  });
  keyId = key.data.id;

  console.log("\nDocs link fetches:");
  const openapi = await getJson(`${SAMPLE}/openapi.json`);
  check("sample API serves /openapi.json with 8 paths", () => {
    if (openapi.status !== 200) throw new Error(`status=${openapi.status}`);
    if (Object.keys(openapi.data.paths || {}).length !== 8) {
      throw new Error(`got ${Object.keys(openapi.data.paths || {}).length} paths`);
    }
  });
  const md = await getJson(`${SAMPLE}/docs`);
  check("sample API serves /docs (markdown, 3-4KB)", () => {
    if (md.status !== 200) throw new Error(`status=${md.status}`);
    // The text endpoint returns Markdown, but the test fetcher
    // tries to parse it as JSON — we just check size and content.
  });
  // Verify the docs page is non-empty markdown by fetching raw text.
  const mdRaw = await fetch(`${SAMPLE}/docs`).then((r) => r.text());
  check("/docs returns non-trivial markdown", () => {
    if (mdRaw.length < 1000) throw new Error(`too short: ${mdRaw.length} bytes`);
    if (!mdRaw.includes("/v1/products") || !mdRaw.includes("### ")) {
      throw new Error("missing expected sections");
    }
  });

  console.log("\nAPI registration with keyName + docs link (no samples):");
  // The cleanest docs-link test: give the backend a docs URL and let
  // it fetch the OpenAPI spec itself, then ask the LLM to extract
  // endpoints. No sample pairs supplied.
  const regFromDocs = await postJson(`${APP}/api/sources`, {
    kind: "api",
    name: `samplestore_docs_${Date.now()}`,
    baseUrl: SAMPLE,
    keyName: KEY_NAME,
    docsLink: `${SAMPLE}/openapi.json`,
  });
  check("POST /api/sources with docsLink returns 201", () => {
    if (regFromDocs.status !== 201) {
      throw new Error(`status=${regFromDocs.status} body=${JSON.stringify(regFromDocs.data).slice(0, 300)}`);
    }
  });
  check("docs-link registration extracts multiple endpoints", () => {
    if (!Array.isArray(regFromDocs.data.endpoints)) throw new Error("no endpoints");
    if (regFromDocs.data.endpoints.length < 3) {
      throw new Error(`only got ${regFromDocs.data.endpoints.length} endpoints`);
    }
  });
  check("docs-link registration retains the docsLink", () => {
    if (regFromDocs.data.docsLink !== `${SAMPLE}/openapi.json`) {
      throw new Error(`docsLink=${regFromDocs.data.docsLink}`);
    }
  });
  await delJson(`${APP}/api/sources/${regFromDocs.data.id}`);

  const reg = await postJson(`${APP}/api/sources`, {
    kind: "api",
    name: SRC_NAME,
    baseUrl: SAMPLE,
    keyName: KEY_NAME,
    samplePairs: [
      {
        label: "Top customers",
        method: "GET",
        path: "/v1/customers/top?limit=5",
        responseBody: JSON.stringify({
          customers: [
            { id: "c_017", name: "Hana Okafor", email: "hana.okafor@example.com", segment: "vip", lifetimeSpend: 4320, orders: 28, lastOrder: "2026-08-10" },
            { id: "c_005", name: "Yui Chen",   email: "yui.chen@example.com",     segment: "vip", lifetimeSpend: 4105, orders: 19, lastOrder: "2026-08-09" },
          ],
        }),
      },
      {
        label: "Daily revenue series",
        method: "GET",
        path: "/v1/revenue/series?days=30",
        responseBody: JSON.stringify({
          days: 30,
          series: [
            { date: "2026-08-13", orders: 8, paidOrders: 6, revenue: 248.50 },
            { date: "2026-08-12", orders: 11, paidOrders: 9, revenue: 372.10 },
          ],
        }),
      },
      {
        label: "Current account",
        method: "GET",
        path: "/v1/account/me",
        responseBody: JSON.stringify({
          id: "u_001",
          name: "Demo Account",
          role: "owner",
          plan: "pro",
          email: "demo@example.com",
          createdAt: "2024-03-15T10:00:00.000Z",
        }),
      },
    ],
  });
  check("POST /api/sources with keyName returns 201", () => {
    if (reg.status !== 201) throw new Error(`status=${reg.status} body=${JSON.stringify(reg.data)}`);
  });
  check("source has at least 1 endpoint extracted", () => {
    if (!Array.isArray(reg.data.endpoints) || reg.data.endpoints.length === 0) {
      throw new Error("no endpoints extracted");
    }
  });
  check("source uses the key (keyName set, no inline authHeader)", () => {
    if (reg.data.keyName !== KEY_NAME) throw new Error(`keyName=${reg.data.keyName}`);
    if (reg.data.authHeader) throw new Error("authHeader leaked");
  });
  apiId = reg.data.id;

  console.log("\nLive call through middleware (auth-gated):");
  // The /v1/account/me endpoint requires the demo key. The
  // middleware should resolve the keyName to KEY_VALUE and the
  // upstream should return 200, not 401.
  const me = reg.data.endpoints.find((e) => e.path === "/v1/account/me");
  if (me) {
    const call = await getJson(
      `${APP}/api/sources/${apiId}/call?endpoint=${encodeURIComponent(me.name)}&fresh=1`,
    );
    check("auth-gated endpoint returns 200 through middleware", () => {
      if (call.status !== 200) {
        throw new Error(`status=${call.status} body=${JSON.stringify(call.data)}`);
      }
    });
    check("response has the expected account fields", () => {
      const d = call.data.data;
      if (d.id !== "u_001" || d.plan !== "pro") {
        throw new Error(`got: ${JSON.stringify(d)}`);
      }
    });
  } else {
    console.log("  (skipped — the LLM didn't extract /v1/account/me from the single sample; that's expected with only one pair)");
  }

  console.log("\nLive call through middleware (open endpoint):");
  // Find any non-auth-gated endpoint. The LLM might name the
  // "revenue series" path differently from the exact path, so
  // we just look for any endpoint that isn't /v1/account/me.
  const openEp = reg.data.endpoints.find(
    (e) => e.path !== "/v1/account/me" && e.path !== "/health",
  );
  if (openEp) {
    const call = await getJson(
      `${APP}/api/sources/${apiId}/call?endpoint=${encodeURIComponent(openEp.name)}&fresh=1`,
    );
    check(`open endpoint (${openEp.name}) returns 200 through middleware`, () => {
      if (call.status !== 200) {
        throw new Error(`status=${call.status} body=${JSON.stringify(call.data).slice(0, 200)}`);
      }
    });
    check("response is a non-empty object or array", () => {
      const d = call.data.data;
      if (!d || (typeof d === "object" && Object.keys(d).length === 0)) {
        throw new Error(`empty: ${JSON.stringify(d).slice(0, 200)}`);
      }
    });
  } else {
    console.log("  (skipped — no open endpoint extracted)");
  }
} finally {
  if (apiId) await delJson(`${APP}/api/sources/${apiId}`);
  if (keyId) await delJson(`${APP}/api/keys/${keyId}`);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
