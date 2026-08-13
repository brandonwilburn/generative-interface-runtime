/**
 * End-to-end test for the API Keys vault.
 *
 * Flow:
 *   1. Start a tiny upstream API that checks for a specific auth header.
 *   2. Create a key in the vault via POST /api/keys.
 *   3. Verify GET /api/keys returns metadata but NOT the value.
 *   4. Register an API source with keyName pointing at the key.
 *   5. Call the API and verify the upstream got the expected auth header.
 *   6. Delete the key.
 *   7. Verify the next call returns a clear "key not found" error.
 *   8. Cleanup.
 *
 * Run with:  node scripts/test-api-keys.mjs
 * Exit code 0 = pass, 1 = at least one assertion failed.
 *
 * Assumes a dev server is running on http://localhost:5173.
 */
import process from "node:process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = parseInt(process.env["TEST_API_PORT"] ?? "49101", 10);
const APP = process.env.APP_URL ?? "http://localhost:5173";
const BASE = `http://127.0.0.1:${PORT}`;

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

// ----- tiny upstream API that echoes the auth header -----
const upstreamRequests = [];
const upstreamServer = http.createServer((req, res) => {
  upstreamRequests.push({
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization ?? null,
  });
  if (req.url?.startsWith("/v1/echo")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      sawAuth: req.headers.authorization ?? null,
    }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});
await new Promise((r) => upstreamServer.listen(PORT, "127.0.0.1", r));
console.log(`Upstream test API listening on ${BASE}`);

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
async function patchJson(url, body) {
  const res = await fetch(url, {
    method: "PATCH",
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

const KEY_VALUE = "Bearer test-secret-12345";
const KEY_NAME = `test_key_${Date.now()}`;
let keyId = null;
let apiId = null;
const epName = "echo";

try {
  console.log("\nCreate:");
  const created = await postJson(`${APP}/api/keys`, {
    name: KEY_NAME,
    value: KEY_VALUE,
    notes: "test key for e2e test",
  });
  check("POST /api/keys returns 201", () => {
    if (created.status !== 201) throw new Error(`status=${created.status} body=${JSON.stringify(created.data)}`);
  });
  check("response includes the key name", () => {
    if (created.data.name !== KEY_NAME) throw new Error(`name=${created.data.name}`);
  });
  check("response includes the key id", () => {
    if (!created.data.id || !created.data.id.startsWith("key_")) {
      throw new Error(`bad id: ${created.data.id}`);
    }
  });
  check("response includes notes", () => {
    if (created.data.notes !== "test key for e2e test") {
      throw new Error(`notes=${created.data.notes}`);
    }
  });
  check("response does NOT include the key value", () => {
    if ("value" in created.data) throw new Error(`value leaked: ${created.data.value}`);
  });
  check("usedBySources starts at 0", () => {
    if (created.data.usedBySources !== 0) throw new Error(`usedBySources=${created.data.usedBySources}`);
  });
  keyId = created.data.id;

  console.log("\nList:");
  const list = await getJson(`${APP}/api/keys`);
  check("GET /api/keys returns 200", () => {
    if (list.status !== 200) throw new Error(`status=${list.status}`);
  });
  check("list includes the new key", () => {
    const found = list.data.keys.find((k) => k.id === keyId);
    if (!found) throw new Error(`key not found in list`);
  });
  check("list does NOT include any key values", () => {
    for (const k of list.data.keys) {
      if ("value" in k) throw new Error(`value leaked in list: ${k.value}`);
    }
  });

  console.log("\nDuplicate name:");
  const dup = await postJson(`${APP}/api/keys`, {
    name: KEY_NAME,
    value: "anything",
  });
  check("duplicate name returns 409", () => {
    if (dup.status !== 409) throw new Error(`expected 409, got ${dup.status}`);
  });

  console.log("\nRegister API with keyName:");
  const reg = await postJson(`${APP}/api/sources`, {
    kind: "api",
    name: `key_test_${Date.now()}`,
    baseUrl: BASE,
    keyName: KEY_NAME,
    samplePairs: [
      {
        label: "echo",
        method: "GET",
        path: "/v1/echo",
        responseBody: JSON.stringify({ ok: true, sawAuth: "(auth was here)" }),
      },
    ],
  });
  check("POST /api/sources with keyName returns 201", () => {
    if (reg.status !== 201) throw new Error(`status=${reg.status} body=${JSON.stringify(reg.data)}`);
  });
  check("source stores keyName in public view", () => {
    if (reg.data.keyName !== KEY_NAME) throw new Error(`keyName=${reg.data.keyName}`);
  });
  check("source does NOT store inline authHeader when keyName is used", () => {
    if (reg.data.authHeader) throw new Error(`authHeader leaked: ${reg.data.authHeader}`);
  });
  apiId = reg.data.id;

  // Now GET the source directly to verify the keyName persists.
  const fetched = await getJson(`${APP}/api/sources/${apiId}`);
  check("GET /api/sources/:id returns keyName", () => {
    if (fetched.data.keyName !== KEY_NAME) throw new Error(`keyName=${fetched.data.keyName}`);
  });
  check("GET /api/sources/:id does NOT leak the key value", () => {
    if ("value" in fetched.data) throw new Error("value leaked from source fetch");
  });

  console.log("\nCall API (key is used):");
  // Wait a moment so the upstream request is unambiguously newer than
  // any previous registration-time call.
  await sleep(50);
  const before = upstreamRequests.length;
  const call = await getJson(
    `${APP}/api/sources/${apiId}/call?endpoint=${epName}&fresh=1`,
  );
  check("GET /call returns 200", () => {
    if (call.status !== 200) throw new Error(`status=${call.status} body=${JSON.stringify(call.data)}`);
  });
  check("upstream got a new request", () => {
    if (upstreamRequests.length <= before) throw new Error("no new upstream request");
  });
  check("upstream received the resolved auth header", () => {
    const last = upstreamRequests[upstreamRequests.length - 1];
    if (last.authorization !== KEY_VALUE) {
      throw new Error(`expected ${KEY_VALUE}, got ${last.authorization}`);
    }
  });

  console.log("\nUsage tracking:");
  const afterUse = await getJson(`${APP}/api/keys`);
  check("usedBySources incremented to 1", () => {
    const k = afterUse.data.keys.find((x) => x.id === keyId);
    if (!k) throw new Error("key not found");
    if (k.usedBySources !== 1) throw new Error(`usedBySources=${k.usedBySources}`);
  });
  check("lastUsedAt is set", () => {
    const k = afterUse.data.keys.find((x) => x.id === keyId);
    if (!k.lastUsedAt) throw new Error("lastUsedAt missing");
  });

  console.log("\nDelete key + verify call fails:");
  const del = await delJson(`${APP}/api/keys/${keyId}`);
  check("DELETE /api/keys/:id returns 200", () => {
    if (del.status !== 200) throw new Error(`status=${del.status}`);
  });
  keyId = null; // mark deleted so the cleanup doesn't try again
  const callAfter = await getJson(
    `${APP}/api/sources/${apiId}/call?endpoint=${epName}&fresh=1`,
  );
  check("call after key deletion returns 502", () => {
    if (callAfter.status !== 502) throw new Error(`expected 502, got ${callAfter.status}`);
  });
  check("error message mentions the missing key by name", () => {
    if (!callAfter.data.error?.includes(KEY_NAME)) {
      throw new Error(`error=${callAfter.data.error}`);
    }
  });
} finally {
  if (apiId) await delJson(`${APP}/api/sources/${apiId}`);
  if (keyId) await delJson(`${APP}/api/keys/${keyId}`);
  upstreamServer.close();
  await sleep(50);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
