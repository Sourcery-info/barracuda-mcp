import { randomUUID } from "node:crypto";

const MAX_SEARCH_LIMIT = 10_000;

/** Default cap for archive CSV downloads (500 MB). */
export const DEFAULT_CSV_MAX_BYTES = 524_288_000;
/** Minimum accepted value for ALEPH_CSV_MAX_BYTES (1 MB). */
export const MIN_CSV_MAX_BYTES = 1_048_576;

export type AppConfig = {
  /** Origin only, e.g. https://aleph.example.org (no trailing path) */
  alephOrigin: string;
  apiKey: string;
  requestTimeoutMs: number;
  sessionId: string;
  userAgent: string;
  /** Max bytes for archive file downloads (default 500 MB, min 1 MB). */
  csvMaxBytes: number;
  /** DuckDB memory_limit setting, e.g. "2GB" (unset = DuckDB default). */
  duckdbMemoryLimit?: string;
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

  const csvMaxBytesRaw = env.ALEPH_CSV_MAX_BYTES?.trim();
  let csvMaxBytes = DEFAULT_CSV_MAX_BYTES;
  if (csvMaxBytesRaw) {
    const n = Number(csvMaxBytesRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(
        "ALEPH_CSV_MAX_BYTES must be a positive integer (bytes)."
      );
    }
    csvMaxBytes = Math.max(MIN_CSV_MAX_BYTES, n);
  }

  const duckdbMemoryLimitRaw = env.ALEPH_DUCKDB_MEMORY_LIMIT?.trim();
  let duckdbMemoryLimit: string | undefined;
  if (duckdbMemoryLimitRaw) {
    if (!/^\d+(\.\d+)?\s*(b|kb|mb|gb|tb)$/i.test(duckdbMemoryLimitRaw)) {
      throw new Error(
        'ALEPH_DUCKDB_MEMORY_LIMIT must look like "2GB", "512MB", or "1073741824B".'
      );
    }
    duckdbMemoryLimit = duckdbMemoryLimitRaw.replace(/\s+/g, "").toUpperCase();
  }

  return {
    alephOrigin: normalizeOrigin(rawUrl),
    apiKey,
    requestTimeoutMs,
    sessionId,
    userAgent: `barracuda-mcp/${version}`,
    csvMaxBytes,
    ...(duckdbMemoryLimit !== undefined ? { duckdbMemoryLimit } : {}),
  };
}

export function clampSearchLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_SEARCH_LIMIT);
}
