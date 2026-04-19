import { randomUUID } from "node:crypto";

const MAX_SEARCH_LIMIT = 10_000;

export type AppConfig = {
  /** Origin only, e.g. https://aleph.example.org (no trailing path) */
  alephOrigin: string;
  apiKey: string;
  requestTimeoutMs: number;
  sessionId: string;
  userAgent: string;
};

function pickBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.ALEPH_BASE_URL?.trim();
  if (explicit) return explicit;
  const opal = env.OPAL_HOST?.trim();
  if (opal) return opal;
  return undefined;
}

function pickApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = env.ALEPH_API_KEY?.trim();
  if (a) return a;
  const o = env.OPAL_API_KEY?.trim();
  if (o) return o;
  return undefined;
}

function normalizeOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = "";
  return url.origin;
}

export function loadConfig(
  env: NodeJS.ProcessEnv,
  version: string
): AppConfig {
  const rawUrl = pickBaseUrl(env);
  if (!rawUrl) {
    throw new Error(
      "Missing Aleph host: set ALEPH_BASE_URL or OPAL_HOST in the environment."
    );
  }
  const apiKey = pickApiKey(env);
  if (!apiKey) {
    throw new Error(
      "Missing API key: set ALEPH_API_KEY or OPAL_API_KEY in the environment."
    );
  }

  const timeoutRaw = env.ALEPH_REQUEST_TIMEOUT_MS?.trim();
  let requestTimeoutMs = 60_000;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isFinite(n)) {
      throw new Error("ALEPH_REQUEST_TIMEOUT_MS must be a number (milliseconds).");
    }
    requestTimeoutMs = Math.max(1_000, Math.min(600_000, n));
  }

  const sessionId = env.ALEPH_SESSION_ID?.trim() || randomUUID();

  return {
    alephOrigin: normalizeOrigin(rawUrl),
    apiKey,
    requestTimeoutMs,
    sessionId,
    userAgent: `barracuda-mcp/${version}`,
  };
}

export function clampSearchLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_SEARCH_LIMIT);
}
