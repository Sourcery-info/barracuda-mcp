/**
 * Small env-string → typed-value helpers shared by the e2e tests and CLI
 * scripts. Kept in one place so every e2e knob parses the same way (empty /
 * invalid → `undefined`, numeric caps applied).
 */

export function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return v;
}

export function parseOptionalPositiveInt(
  raw: string | undefined,
  { min = 1, max }: { min?: number; max?: number } = {}
): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v) || v < min) return undefined;
  return max !== undefined ? Math.min(v, max) : v;
}

export function parseOptionalNonNegativeInt(
  raw: string | undefined,
  { max }: { max?: number } = {}
): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v) || v < 0) return undefined;
  return max !== undefined ? Math.min(v, max) : v;
}

export function parseOptionalBool(raw: string | undefined): boolean | undefined {
  const s = raw?.trim().toLowerCase();
  if (!s) return undefined;
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return undefined;
}

export function parseCommaSeparatedList(
  raw: string | undefined
): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

export function parseJsonStringMap(
  raw: string | undefined
): Record<string, string> | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  try {
    const o = JSON.parse(s) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (!k.trim()) continue;
      if (typeof v === "string") out[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shaping/formatting options shared by the `aleph_search` and `aleph_get_entity`
 * MCP tool layers. Control how the structured response is trimmed.
 */
export type E2eShapingArgs = {
  responseMode?: "structured" | "raw";
  includeRaw?: boolean;
  includeContentFields?: boolean;
  contentPreviewChars?: number;
  bodyMarkdownMaxChars?: number;
  maxArrayValuesPerField?: number;
};

/**
 * Parse shaping env vars keyed by `${prefix}RESPONSE_MODE`,
 * `${prefix}INCLUDE_RAW`, `${prefix}INCLUDE_CONTENT_FIELDS`,
 * `${prefix}CONTENT_PREVIEW_CHARS`, `${prefix}BODY_MARKDOWN_MAX_CHARS`,
 * and `${prefix}MAX_ARRAY_VALUES_PER_FIELD`.
 *
 * Only keys present in env are returned (so the result cleanly spreads onto
 * defaults).
 */
export function parseShapingFromEnv(
  env: NodeJS.ProcessEnv,
  prefix: string
): E2eShapingArgs {
  const out: E2eShapingArgs = {};

  const responseMode = env[`${prefix}RESPONSE_MODE`]?.trim().toLowerCase();
  if (responseMode === "raw" || responseMode === "structured") {
    out.responseMode = responseMode;
  }

  const includeRaw = parseOptionalBool(env[`${prefix}INCLUDE_RAW`]);
  if (includeRaw !== undefined) out.includeRaw = includeRaw;

  const includeContentFields = parseOptionalBool(
    env[`${prefix}INCLUDE_CONTENT_FIELDS`]
  );
  if (includeContentFields !== undefined) {
    out.includeContentFields = includeContentFields;
  }

  const contentPreviewChars = parseOptionalNonNegativeInt(
    env[`${prefix}CONTENT_PREVIEW_CHARS`],
    { max: 50_000 }
  );
  if (contentPreviewChars !== undefined) {
    out.contentPreviewChars = contentPreviewChars;
  }

  const bodyMarkdownMaxChars = parseOptionalPositiveInt(
    env[`${prefix}BODY_MARKDOWN_MAX_CHARS`],
    { max: 50_000 }
  );
  if (bodyMarkdownMaxChars !== undefined) {
    out.bodyMarkdownMaxChars = bodyMarkdownMaxChars;
  }

  const maxArrayValuesPerField = parseOptionalPositiveInt(
    env[`${prefix}MAX_ARRAY_VALUES_PER_FIELD`],
    { max: 200 }
  );
  if (maxArrayValuesPerField !== undefined) {
    out.maxArrayValuesPerField = maxArrayValuesPerField;
  }

  return out;
}
