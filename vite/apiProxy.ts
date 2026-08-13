/**
 * Vite dev-server middleware.
 *
 * Forwards POST /api/chat to an OpenAI-compatible upstream (default
 * https://api.minimax.io/v1). Adds the Authorization header from a
 * non-VITE_ env var so the API key never reaches the browser bundle.
 *
 * In production, the user is expected to deploy a small backend that
 * implements the same /api/chat contract (or to point VITE_OPENAI_BASE_URL
 * at a public proxy they trust).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_UPSTREAM = "https://api.minimax.io/v1";

interface ProxyEnv {
  upstream: string;
  apiKey: string;
  debug: boolean;
}

/**
 * Vite exposes VITE_* env vars to the bundle but doesn't auto-load the rest
 * for plugins. We manually parse .env and .env.local so `npm run dev` Just
 * Works regardless of whether the user exported the key in their shell.
 */
function readDotenvFile(filename: string): Record<string, string> {
  const file = resolve(process.cwd(), filename);
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function readEnv(): ProxyEnv {
  const fromShell = {
    upstream: process.env.MINIMAX_BASE_URL,
    apiKey: process.env.MINIMAX_API_KEY,
    debug: process.env.MINIMAX_DEBUG,
  };
  const fromLocal = { ...readDotenvFile(".env.local"), ...readDotenvFile(".env") };
  const upstream = (fromShell.upstream ?? fromLocal.MINIMAX_BASE_URL ?? DEFAULT_UPSTREAM).replace(/\/+$/, "");
  const apiKey = fromShell.apiKey ?? fromLocal.MINIMAX_API_KEY ?? "";
  const debug = (fromShell.debug ?? fromLocal.MINIMAX_DEBUG) === "1";
  return { upstream, apiKey, debug };
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body).toString());
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(body);
}

function makeMiddleware(env: ProxyEnv): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.method !== "POST" || !req.url) return next();

    // Match any POST under /api/ and forward the rest of the path to the
    // upstream. So the planner can construct `${baseUrl}/chat/completions`
    // and the proxy transparently rewrites /api/* → upstream/*.
    const url = req.url.split("?")[0]!;
    const apiMatch = url.match(/^\/api\/(.+?)\/?$/);
    if (!apiMatch) return next();
    const upstreamPath = apiMatch[1]!;

    if (!env.apiKey) {
      writeJson(res, 500, {
        error:
          "MINIMAX_API_KEY is not set. Add it to your .env.local (or process env) and restart the dev server.",
      });
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (e) {
      writeJson(res, 400, { error: `Could not read request body: ${(e as Error).message}` });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      writeJson(res, 400, { error: "Request body is not valid JSON" });
      return;
    }

    const upstreamUrl = `${env.upstream}/${upstreamPath}`;
    if (env.debug) {
      // eslint-disable-next-line no-console
      console.log(`[api-proxy] ${url} → ${upstreamUrl}  model=${(body as { model?: string })?.model ?? "?"}`);
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      writeJson(res, 502, {
        error: `Upstream fetch failed: ${(e as Error).message}`,
        upstream: env.upstream,
      });
      return;
    }

    const text = await upstreamRes.text();
    const headers: Record<string, string> = {
      "Content-Type": upstreamRes.headers.get("content-type") ?? "application/json",
    };
    writeJson(res, upstreamRes.status, text ? safeParse(text) : null, headers);
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

export function apiProxy(): Plugin {
  const env = readEnv();
  const masked = env.apiKey
    ? `${env.apiKey.slice(0, 4)}…${env.apiKey.slice(-4)} (${env.apiKey.length} chars)`
    : "(missing — set MINIMAX_API_KEY in .env.local)";
  // eslint-disable-next-line no-console
  console.log(`[api-proxy] upstream=${env.upstream}  key=${masked}  debug=${env.debug}`);
  return {
    name: "gir-api-proxy",
    configureServer(server) {
      server.middlewares.use(makeMiddleware(env));
    },
  };
}
