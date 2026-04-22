import type { SearchQueryInput } from "../../src/aleph/client.js";
import { clampSearchLimit } from "../../src/config.js";
import {
  parseCommaSeparatedList,
  parseJsonStringMap,
  parseNonNegativeInt,
  parseOptionalPositiveInt,
  parseShapingFromEnv,
  type E2eShapingArgs,
} from "./envParsers.js";

/**
 * Build {@link SearchQueryInput} from `ALEPH_E2E_SEARCH_*` environment variables (see `.env.example`).
 */
export function e2eSearchQueryFromEnv(env: NodeJS.ProcessEnv): SearchQueryInput {
  const q = env.ALEPH_E2E_SEARCH_Q?.trim() || "test";
  const limitRaw = env.ALEPH_E2E_SEARCH_LIMIT?.trim();
  const limit = limitRaw
    ? (clampSearchLimit(parseNonNegativeInt(limitRaw, 5)) ?? 5)
    : 5;

  const offsetRaw = env.ALEPH_E2E_SEARCH_OFFSET?.trim();
  const offset =
    offsetRaw !== undefined && offsetRaw !== ""
      ? parseNonNegativeInt(offsetRaw, 0)
      : undefined;

  const collectionId = env.ALEPH_E2E_SEARCH_COLLECTION_ID?.trim() || undefined;
  const schema = env.ALEPH_E2E_SEARCH_SCHEMA?.trim() || undefined;
  const schemata = env.ALEPH_E2E_SEARCH_SCHEMATA?.trim() || undefined;
  const facets = parseCommaSeparatedList(env.ALEPH_E2E_SEARCH_FACETS);
  const extraFilters = parseJsonStringMap(env.ALEPH_E2E_SEARCH_EXTRA_FILTERS);

  const highlight =
    env.ALEPH_E2E_SEARCH_HIGHLIGHT?.trim().toLowerCase() === "false"
      ? false
      : true;
  const highlightCount = parseOptionalPositiveInt(
    env.ALEPH_E2E_SEARCH_HIGHLIGHT_COUNT,
    { max: 100 }
  );
  const highlightLength = parseOptionalPositiveInt(
    env.ALEPH_E2E_SEARCH_HIGHLIGHT_LENGTH,
    { max: 50_000 }
  );

  return {
    q,
    limit,
    highlight,
    ...(highlightCount !== undefined ? { highlightCount } : {}),
    ...(highlightLength !== undefined ? { highlightLength } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(collectionId ? { collectionId } : {}),
    ...(schema ? { schema } : {}),
    ...(schemata ? { schemata } : {}),
    ...(facets ? { facets } : {}),
    ...(extraFilters ? { extraFilters } : {}),
  };
}

/**
 * Shaping options for the structured `aleph_search` response. See
 * {@link parseShapingFromEnv} — this reads the `ALEPH_E2E_SEARCH_*` prefix.
 */
export type E2eSearchShapingArgs = E2eShapingArgs;

export function e2eSearchShapingFromEnv(
  env: NodeJS.ProcessEnv
): E2eSearchShapingArgs {
  return parseShapingFromEnv(env, "ALEPH_E2E_SEARCH_");
}

const DEFAULT_E2E_FETCH_TOP_N = 2;
const MAX_E2E_FETCH_TOP_N = 50;

/**
 * How many search hits to fetch with GET /api/2/entities/:id after the e2e search (`ALEPH_E2E_FETCH_TOP_N`).
 */
export function parseE2eFetchTopN(env: NodeJS.ProcessEnv): number {
  const raw = env.ALEPH_E2E_FETCH_TOP_N?.trim();
  if (!raw) return DEFAULT_E2E_FETCH_TOP_N;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_E2E_FETCH_TOP_N;
  return Math.min(n, MAX_E2E_FETCH_TOP_N);
}

/** Collect up to `max` entity ids from an Aleph search response body. */
export function entityIdsFromSearchResults(data: unknown, max: number): string[] {
  const obj = (data ?? {}) as { results?: unknown[] };
  const results = Array.isArray(obj.results) ? obj.results : [];
  const ids: string[] = [];
  for (const hit of results) {
    if (ids.length >= max) break;
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) continue;
    const id = (hit as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return ids;
}
