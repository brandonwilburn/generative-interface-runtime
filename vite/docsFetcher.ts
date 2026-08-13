/**
 * Fetches documentation text from a URL.
 *
 * Used by the API registration flow when the user supplies a docs
 * link. The result is fed to the LLM extractor. We:
 *   - apply a hard size cap (1 MB) to keep memory sane
 *   - set a short timeout (8s) so a slow upstream doesn't block the UI
 *   - strip HTML tags so the LLM sees plain text
 *   - return the original Content-Type for debugging
 *
 * Anything that isn't `text/*` or `application/json` is rejected —
 * PDFs and binary docs are out of scope for v1.
 */
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;

export interface FetchedDocs {
  text: string;
  contentType: string;
  finalUrl: string;
  bytes: number;
}

export async function fetchDocs(url: string): Promise<FetchedDocs> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Docs URL must start with http:// or https://");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
  } catch (e) {
    throw new Error(`Failed to fetch docs: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Docs fetch returned HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (
    !contentType.match(/^text\//i) &&
    !contentType.match(/application\/(json|xml|yaml|javascript)/i)
  ) {
    throw new Error(
      `Docs content-type "${contentType}" is not supported (text/JSON/XML/YAML only).`,
    );
  }
  // Read with a size cap.
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Docs response has no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`Docs too large (>${MAX_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const raw = buf.toString("utf8");
  const text = contentType.match(/^text\/html/i) ? stripHtml(raw) : raw;
  return {
    text,
    contentType,
    finalUrl: res.url,
    bytes: total,
  };
}

/**
 * Very small HTML-to-text stripper. Good enough for API docs which
 * are mostly <h1>, <p>, <code>, <pre>, and <li>. We keep newlines so
 * the LLM can see paragraph boundaries.
 */
function stripHtml(html: string): string {
  return html
    // Drop scripts and styles entirely.
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    // Convert structural tags to newlines.
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|td|th|pre)[^>]*>/gi, "\n")
    // Strip all other tags.
    .replace(/<[^>]+>/g, "")
    // Decode common entities.
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse runs of blank lines.
    .replace(/\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
