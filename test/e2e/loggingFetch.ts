import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FetchLike } from "../../src/aleph/client.js";
import {
  ENTITY_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
  formatAlephStructuredResponse,
  formatEntityGetResponse,
  SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
  type FormatterOptions,
} from "../../src/mcp/formatAlephResponse.js";

const MAX_BODY_FILE_CHARS = 500_000;
const MAX_BODY_CONSOLE_CHARS = 12_000;

const SLIM_LOG_SHARED: Pick<
  FormatterOptions,
  "includeRaw" | "includeContentFields" | "contentPreviewChars" | "maxArrayValuesPerField"
> = {
  includeRaw: false,
  includeContentFields: false,
  contentPreviewChars: 0,
  maxArrayValuesPerField: 20,
};

/**
 * For successful JSON from OpenAleph search / entity endpoints, log the same slim shape as the MCP tools.
 * Otherwise returns `null` and the caller logs the raw body (with truncation).
 */
function slimBodyForLog(urlString: string, status: number, text: string): string | null {
  if (status < 200 || status >= 300) return null;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const path = url.pathname;

  if (path === "/api/2/search" || path.endsWith("/api/2/search")) {
    const slim = formatAlephStructuredResponse(parsed, {
      ...SLIM_LOG_SHARED,
      query: url.searchParams.get("q"),
      filtersApplied: {},
      bodyMarkdownMaxChars: SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
    });
    return JSON.stringify(slim, null, 2);
  }

  const entityMatch = path.match(/\/api\/2\/entities\/([^/]+)\/?$/);
  if (entityMatch) {
    const id = decodeURIComponent(entityMatch[1]!);
    const slim = formatEntityGetResponse(parsed, {
      ...SLIM_LOG_SHARED,
      entityId: id,
      filtersApplied: { id },
      bodyMarkdownMaxChars: ENTITY_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
    });
    return JSON.stringify(slim, null, 2);
  }

  return null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function resolveMethod(input: RequestInfo, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input === "object" && !(input instanceof URL) && typeof input.method === "string") {
    return input.method;
  }
  return "GET";
}

function sanitizeHeadersForLog(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = new Headers(headers);
  h.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "authorization") {
      const v = value.trim();
      out[key] = /^apikey\s+/i.test(v) ? "ApiKey ***" : "***";
    } else {
      out[key] = value;
    }
  });
  return out;
}

function headersObject(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function appendLog(logPath: string, chunk: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, chunk, "utf8");
}

function truncateForFile(text: string): string {
  if (text.length <= MAX_BODY_FILE_CHARS) return text;
  return `${text.slice(0, MAX_BODY_FILE_CHARS)}\n… [truncated, ${text.length} chars total]\n`;
}

function truncateForConsole(text: string): string {
  if (text.length <= MAX_BODY_CONSOLE_CHARS) return text;
  return `${text.slice(0, MAX_BODY_CONSOLE_CHARS)}\n… [truncated for console, ${text.length} chars total; see log file for up to ${MAX_BODY_FILE_CHARS} chars]\n`;
}

/**
 * Wraps `fetch` to log each request/response to stdout/stderr and append to `logPath`.
 * Authorization headers are redacted in logs.
 * For OpenAleph search/entity JSON, logs the **slim MCP-shaped** body only (same as tool output).
 */
export function createLoggingFetch(logPath: string): FetchLike {
  let seq = 0;

  return async (input, init) => {
    const n = ++seq;
    const url = requestUrl(input as RequestInfo);
    const method = resolveMethod(input as RequestInfo, init);

    const reqHeaders = sanitizeHeadersForLog(init?.headers);
    const reqBlock = [
      "",
      `========== e2e request #${n} ${new Date().toISOString()} ==========`,
      `${method} ${url}`,
      "Request headers:",
      JSON.stringify(reqHeaders, null, 2),
      "",
    ].join("\n");

    console.log(reqBlock);
    await appendLog(logPath, reqBlock);

    const response = await globalThis.fetch(input as RequestInfo, init);

    const text = await response.text();
    const slimLog = slimBodyForLog(url, response.status, text);
    const bodyForLog = slimLog ?? text;
    const bodyLabel = slimLog ? "Body (slim MCP shape — same as tool output)" : "Body";

    const respBlockFile = [
      `---------- response #${n} HTTP ${response.status} ----------`,
      "Response headers:",
      JSON.stringify(headersObject(response), null, 2),
      `${bodyLabel}:`,
      truncateForFile(bodyForLog),
      "",
    ].join("\n");

    const respBlockConsole = [
      `---------- response #${n} HTTP ${response.status} ----------`,
      "Response headers:",
      JSON.stringify(headersObject(response), null, 2),
      `${bodyLabel}:`,
      truncateForConsole(bodyForLog),
      "",
    ].join("\n");

    console.log(respBlockConsole);
    await appendLog(logPath, respBlockFile);

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
