import {
  parseOptionalBool,
  parseShapingFromEnv,
  type E2eShapingArgs,
} from "./envParsers.js";

/**
 * Arguments for the `aleph_get_entity` MCP tool layer driven from env. The
 * tool accepts the same shaping knobs as `aleph_search`; the id is separate
 * so callers can skip the test (or exit) when it is not provided.
 */
export type E2eEntityShapingArgs = E2eShapingArgs;

/** The entity id to fetch, read from `ALEPH_E2E_ENTITY_ID`. */
export function e2eEntityIdFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const id = env.ALEPH_E2E_ENTITY_ID?.trim();
  return id ? id : undefined;
}

/**
 * Whether to also exercise `aleph_get_entity_markdown` against the same id
 * (default: true). Toggle with `ALEPH_E2E_ENTITY_FETCH_MARKDOWN=false`.
 */
export function e2eEntityFetchMarkdownFromEnv(env: NodeJS.ProcessEnv): boolean {
  const v = parseOptionalBool(env.ALEPH_E2E_ENTITY_FETCH_MARKDOWN);
  return v ?? true;
}

export function e2eEntityShapingFromEnv(
  env: NodeJS.ProcessEnv
): E2eEntityShapingArgs {
  return parseShapingFromEnv(env, "ALEPH_E2E_ENTITY_");
}
