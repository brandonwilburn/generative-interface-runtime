/**
 * Backward-compat test for the source store.
 *
 * Specifically, the case where `data/sources.json` was written by
 * an older version of the dev server that didn't include the
 * `docsFiles` field. The DELETE handler used to crash with
 * "Cannot convert undefined or null to object" because
 * `delete undefined[id]` throws.
 *
 * This test:
 *   1. Replaces data/sources.json with a minimal store that has
 *      no docsFiles field
 *   2. Calls DELETE /api/sources/:id through the real middleware
 *   3. Verifies the call returns 200 (not 500)
 *   4. Restores the original file from a backup taken at start
 *
 * Run with:  node scripts/test-store-compat.mjs
 * Exit code 0 = pass, 1 = at least one assertion failed.
 *
 * Assumes a dev server is running on http://localhost:5173.
 */
import process from "node:process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const STORE = resolve(process.cwd(), "data", "sources.json");
const BACKUP = STORE + ".test-backup";

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

function restore() {
  try {
    if (existsSync(BACKUP)) {
      copyFileSync(BACKUP, STORE);
      try { unlinkSync(BACKUP); } catch {}
    }
  } catch (e) {
    console.error(`Could not restore ${STORE}: ${e.message}`);
  }
}

if (!existsSync(STORE)) {
  console.error("No data/sources.json — cannot test backward compat without one.");
  process.exit(1);
}

// Snapshot the current store. Restore on exit (success OR failure).
copyFileSync(STORE, BACKUP);
process.on("exit", restore);

try {
  console.log("\nSetup:");
  // Write a minimal store WITHOUT the docsFiles field, simulating
  // an older version of the file.
  const oldShape = {
    sources: [
      {
        kind: "api",
        id: "src_legacy01",
        name: "legacy",
        registeredAt: "2026-08-01T00:00:00.000Z",
        capability: "user.legacy",
        baseUrl: "http://example.com",
        authHeader: "Bearer old",
        endpoints: [],
        // NOTE: no docsFiles field anywhere
      },
    ],
    rows: { src_legacy01: [] },
    // NOTE: no docsFiles at the top level either
  };
  writeFileSync(STORE, JSON.stringify(oldShape, null, 2), "utf8");
  check("wrote a legacy-shape store to disk", () => {});

  console.log("\nList works on the legacy shape:");
  const list = await fetch(`${APP}/api/sources`).then((r) => r.json());
  check("GET /api/sources returns the legacy source", () => {
    if (!Array.isArray(list.sources) || list.sources.length !== 1) {
      throw new Error(`got ${list.sources?.length} sources`);
    }
  });

  console.log("\nDELETE on the legacy source (the regression case):");
  let status, body;
  try {
    const res = await fetch(`${APP}/api/sources/src_legacy01`, { method: "DELETE" });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch (e) {
    status = 0;
    body = { _fetchError: e.message };
  }
  check("DELETE returns 200 (not 500)", () => {
    if (status !== 200) throw new Error(`status=${status} body=${JSON.stringify(body)}`);
  });
  check("response is { ok: true }", () => {
    if (body.ok !== true) throw new Error(`got: ${JSON.stringify(body)}`);
  });

  console.log("\nSubsequent reads still work:");
  const after = await fetch(`${APP}/api/sources`).then((r) => r.json());
  check("GET /api/sources now returns 0 sources", () => {
    if (after.sources.length !== 0) {
      throw new Error(`got ${after.sources.length} sources`);
    }
  });
} catch (e) {
  console.error(`Unexpected error: ${e.message}`);
  fail++;
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
