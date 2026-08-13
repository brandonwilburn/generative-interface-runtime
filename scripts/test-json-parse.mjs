/**
 * Tests the LLM JSON extractor (parseLLMJson) in src/planner/openaiPlanner.ts.
 *
 * The extractor must handle the chatty output real LLMs produce:
 *  - plain JSON object
 *  - ```json ... ``` fences
 *  - <think>...</think> reasoning blocks
 *  - trailing prose after the object
 *  - leading prose before the object
 *  - array wrapper like `[ {...} ]`
 *  - nested braces inside string values
 *  - escaped quotes inside strings
 *  - junk before/after that the walker can't balance
 *
 * Run with:  node scripts/test-json-parse.mjs
 * Exit code 0 = all assertions pass, 1 = at least one failed.
 *
 * (The function is not exported, so we re-implement the same logic
 * here. Keep this in sync with src/planner/openaiPlanner.ts.)
 */
import process from "node:process";

const stripCodeFence = (text) => {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1];
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return t;
};

const walkBalanced = (text, start, open, close) => {
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
};

const extractFirstJsonObject = (text) => {
  const start = text.indexOf("{");
  if (start === -1) return "";
  return walkBalanced(text, start, "{", "}");
};

const extractFirstJsonArray = (text) => {
  const start = text.indexOf("[");
  if (start === -1) return "";
  return walkBalanced(text, start, "[", "]");
};

const parseLLMJson = (text) => {
  const candidates = [];
  const obj = extractFirstJsonObject(text);
  if (obj) candidates.push(obj);
  const arr = extractFirstJsonArray(text);
  if (arr) {
    try {
      const parsed = JSON.parse(arr);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(JSON.stringify(parsed));
      }
    } catch {}
  }
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) candidates.push(greedy[0]);

  let lastErr = null;
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("no JSON");
};

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    fail++;
  }
}

function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg ?? "values differ"}: got ${sa} want ${sb}`);
}

console.log("parseLLMJson — strict object cases:");

check("plain JSON object", () => {
  const v = parseLLMJson('{"a":1,"b":"two"}');
  eq(v, { a: 1, b: "two" });
});

check("JSON with trailing prose", () => {
  const v = parseLLMJson('{"a":1}\nLooks good!');
  eq(v, { a: 1 });
});

check("JSON with leading prose", () => {
  const v = parseLLMJson('Sure, here you go:\n{"a":1}');
  eq(v, { a: 1 });
});

check("JSON with both leading and trailing prose", () => {
  const v = parseLLMJson('Here is the dashboard:\n{"type":"dashboard","title":"X"}\nLet me know if you need more.');
  eq(v, { type: "dashboard", title: "X" });
});

check("```json fenced payload", () => {
  const v = parseLLMJson('```json\n{"a":1}\n```');
  eq(v, { a: 1 });
});

check("``` fenced payload without language", () => {
  const v = parseLLMJson('```\n{"a":1}\n```');
  eq(v, { a: 1 });
});

check("<think> block before JSON", () => {
  const v = parseLLMJson('<think>the user wants a dashboard so I will return one</think>\n{"a":1}');
  eq(v, { a: 1 });
});

check("multiple <think> blocks before JSON", () => {
  const v = parseLLMJson('<think>step 1</think>intermediate prose<think>step 2</think>\n{"a":1}');
  eq(v, { a: 1 });
});

console.log("\nparseLLMJson — array-wrapped cases:");

check("[ {...} ] wrapper (unwrapped to object)", () => {
  const v = parseLLMJson('[{"type":"dashboard","title":"X"}]');
  eq(v, { type: "dashboard", title: "X" });
});

check("[ {...} ] wrapper with leading prose", () => {
  const v = parseLLMJson('Here you go:\n[{"a":1}]');
  eq(v, { a: 1 });
});

console.log("\nparseLLMJson — string-literal edge cases:");

check("nested braces inside string values", () => {
  const v = parseLLMJson('{"a":"this { has braces }","b":2}');
  eq(v, { a: "this { has braces }", b: 2 });
});

check("escaped quotes inside strings", () => {
  const v = parseLLMJson('{"a":"she said \\"hi\\"","b":2}');
  eq(v, { a: 'she said "hi"', b: 2 });
});

check("braces inside strings with trailing prose", () => {
  const v = parseLLMJson('{"a":"x { y } z","b":2}\nSome text');
  eq(v, { a: "x { y } z", b: 2 });
});

console.log("\nparseLLMJson — empty / garbage cases:");

check("empty input throws", () => {
  try { parseLLMJson(""); throw new Error("should have thrown"); }
  catch (e) { if (!(e instanceof SyntaxError) && !/no JSON|Could not/.test(e.message)) throw e; }
});

check("plain text with no JSON throws", () => {
  try { parseLLMJson("Sorry, I can't help with that."); throw new Error("should have thrown"); }
  catch (e) { if (!/no JSON|Could not|SyntaxError/.test(String(e))) throw e; }
});

check("truncated JSON throws (object not closed)", () => {
  try { parseLLMJson('{"a":1'); throw new Error("should have thrown"); }
  catch (e) { if (!/Could not|SyntaxError|Unexpected/.test(String(e))) throw e; }
});

console.log("\nparseLLMJson — full dashboard spec (realistic shape):");

check("full spec with children array", () => {
  const spec = {
    type: "dashboard",
    title: "Test",
    children: [
      { type: "section", title: "Headline", columns: 3, children: [
        { type: "metricCard", label: "Revenue", valueRef: { capability: "merchant.getRevenue", params: { range: "30d" } }, format: "currency" }
      ]}
    ]
  };
  const v = parseLLMJson(JSON.stringify(spec));
  eq(v, spec);
});

check("full spec with trailing comment", () => {
  const v = parseLLMJson('{"type":"dashboard","title":"X","children":[]}\n// done');
  eq(v, { type: "dashboard", title: "X", children: [] });
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
