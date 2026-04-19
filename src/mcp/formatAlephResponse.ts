import TurndownService from "turndown";

type UnknownRecord = Record<string, unknown>;

/** Default max length for Email `bodyMarkdown` in structured `aleph_search` when `contentPreviewChars` is 0. */
export const SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS = 200;
/** Default for structured `aleph_get_entity` (longer read of one email). */
export const ENTITY_DEFAULT_BODY_MARKDOWN_MAX_CHARS = 6_000;

/** Max HTML length passed to Turndown (guards against pathological bodies). */
const MAX_HTML_INPUT_CHARS_FOR_TURNDOWN = 400_000;

let turndownService: TurndownService | undefined;

function getTurndown(): TurndownService {
  if (!turndownService) {
    turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
  }
  return turndownService;
}

/**
 * Remove Outlook/Word HTML noise so Turndown sees real content, not comment-wrapped CSS.
 * Without this, `<!-- ... @font-face ... -->` blocks become literal "Markdown" full of HTML/CSS.
 */
function sanitizeEmailHtmlBeforeTurndown(html: string): string {
  let s = html;
  // HTML comments (Outlook puts huge CSS blocks inside <!-- ... -->)
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Conditional comments e.g. <!--[if gte mso 9]>...<![endif]-->
  s = s.replace(/<!--\s*\[if[\s\S]*?<!\s*\[endif\]\s*-->/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<\?xml\b[^?]*\?>/gi, "");
  return s;
}

/** Lines that are clearly CSS / Word section metadata mistaken for body text after conversion. */
function dropCssLikeMarkdownLines(markdown: string): string {
  const cssLine =
    /^[\s]*(@font-face|@page|@media|font-family:|panose-|mso-|\.Mso|\.WordSection|div\.WordSection|size:\s*\d)/i;
  return markdown
    .split("\n")
    .filter((line) => !cssLine.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove leftover angle-bracket fragments that look like HTML tags (Outlook cruft). */
function stripResidualHtmlTagChunks(markdown: string): string {
  return markdown
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9:._-]*(?:\s[^<>]*)?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function emailHtmlToMarkdown(html: string): string {
  const cleaned = sanitizeEmailHtmlBeforeTurndown(html);
  const t = cleaned.trim();
  if (!t) return "";
  let md: string;
  try {
    md = getTurndown().turndown(t).trim();
  } catch {
    return "";
  }
  md = dropCssLikeMarkdownLines(md);
  md = stripResidualHtmlTagChunks(md);
  return md.trim();
}

/**
 * Join FtM `bodyHtml` fragments (usually string[]) without walking nested objects
 * (avoids mis-extracting strings from odd shapes).
 */
function flattenBodyHtmlStrings(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length ? t : null;
  }
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) parts.push(item.trim());
    }
    if (parts.length === 0) return null;
    return parts.join("\n\n");
  }
  return null;
}

/** If HTML is huge, cut after a closing `>` so Turndown sees mostly well-formed markup. */
function safeTruncateHtmlForTurndown(html: string, maxChars: number): string {
  if (html.length <= maxChars) return html;
  const slice = html.slice(0, maxChars);
  const lastGt = slice.lastIndexOf(">");
  const minKeep = Math.floor(maxChars * 0.85);
  if (lastGt >= minKeep) return slice.slice(0, lastGt + 1);
  return slice;
}

/**
 * After Markdown is produced, shorten to maxChars at a paragraph or line break when possible.
 */
function truncateMarkdownAtBoundary(markdown: string, maxChars: number): string {
  if (maxChars <= 0 || markdown.length <= maxChars) return markdown;
  const head = markdown.slice(0, maxChars);
  const minKeep = Math.floor(maxChars * 0.45);

  let cut = head.lastIndexOf("\n\n");
  if (cut >= minKeep) {
    return `${markdown.slice(0, cut).trimEnd()}\n\n…`;
  }
  cut = head.lastIndexOf("\n");
  if (cut >= minKeep) {
    return `${markdown.slice(0, cut).trimEnd()}\n…`;
  }
  cut = head.lastIndexOf(" ");
  if (cut >= minKeep) {
    return `${markdown.slice(0, cut).trimEnd()} …`;
  }
  return `${head.trimEnd()}…`;
}

function isEmailSchema(schema: string): boolean {
  return schema.trim().toLowerCase() === "email";
}

/**
 * FollowTheMoney **`Pages`** = multi-page file; **`Page`** = one page shard (has `bodyText`, `index`, links to `document`).
 * OpenAleph search often returns **`Page`** rows; both need the same plain-body handling.
 */
function isPageOrPagesSchema(schema: string): boolean {
  const n = schema.trim().toLowerCase();
  return n === "page" || n === "pages";
}

function safeTruncatePlainTextForMarkdown(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastNl = slice.lastIndexOf("\n");
  const minKeep = Math.floor(maxChars * 0.85);
  if (lastNl >= minKeep) return slice.slice(0, lastNl);
  return slice;
}

/** Elasticsearch highlight snippets often include `<em>`; strip for plain preview text. */
function stripHighlightMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Join OpenAleph search `highlight` fragments (see ES `unpack_result`) into one plain string.
 */
function flattenHighlightToPlain(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const parts: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      const t = stripHighlightMarkup(item);
      if (t) parts.push(t);
    }
  }
  if (parts.length === 0) return null;
  return parts.join("\n...\n");
}

const PAGES_TEXT_PROPERTY_FALLBACKS = ["bodyText", "indexText", "rawText"] as const;

/**
 * Aleph indexing moves `indexText` into the aggregate ES `text` field and excludes `text` from
 * stored `_source`, so API hits often have **no** `bodyText` unless the ingest pipeline set it.
 * Prefer `bodyText`, then `indexText` / `rawText` on `properties`, then search `highlight`.
 */
function pickPagesPlainTextForSlim(
  sourceProperties: Record<string, unknown>,
  highlight: unknown
): { text: string; deleteKeys: string[] } | null {
  for (const key of PAGES_TEXT_PROPERTY_FALLBACKS) {
    const t = flattenBodyHtmlStrings(sourceProperties[key]);
    if (t) {
      return { text: t, deleteKeys: [key] };
    }
  }
  const fromHl = flattenHighlightToPlain(highlight);
  if (fromHl) {
    return { text: fromHl, deleteKeys: [] };
  }
  return null;
}

export type FormatterOptions = {
  /** Search query; omitted when fetching a single entity. */
  query?: string | null;
  /** Entity id when using GET /api/2/entities/:id. */
  entityId?: string | null;
  filtersApplied: UnknownRecord;
  includeRaw: boolean;
  includeContentFields: boolean;
  contentPreviewChars: number;
  maxArrayValuesPerField: number;
  /**
   * When `contentPreviewChars` is 0, max length for Email `bodyMarkdown` (after HTML→Markdown) or **Page** /
   * **Pages** `bodyText` (plain, same boundary-aware truncation). If `contentPreviewChars` is positive, that value
   * is used instead for the cap.
   */
  bodyMarkdownMaxChars: number;
};

export type RawEntity = {
  id?: string;
  schema?: string;
  created_at?: string;
  updated_at?: string;
  collection_id?: string;
  collection?: { id?: string };
  links?: UnknownRecord;
  properties?: Record<string, unknown>;
  /** Search hits only: ES highlight fragments (array of HTML strings). */
  highlight?: unknown;
  score?: number;
  _score?: number;
};

/** Extract entity id from `.../api/2/entities/<id>` (self, expand, etc.). */
function extractEntityIdFromApiEntitiesUrl(href: string): string | null {
  const s = href.trim();
  if (!s) return null;
  try {
    const path = new URL(s).pathname;
    const m = path.match(/\/api\/2\/entities\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    const m = s.match(/\/api\/2\/entities\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

/** Extract entity id from UI path `.../entities/<id>`. */
function extractEntityIdFromUiUrl(href: string): string | null {
  const s = href.trim();
  if (!s) return null;
  try {
    const path = new URL(s).pathname;
    const m = path.match(/\/entities\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    const m = s.match(/\/entities\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

/**
 * When `id` is missing on the entity, OpenAleph still returns full URLs under `links`.
 */
function resolveOpenAlephEntityIdFromLinks(entity: RawEntity): string | null {
  const links = entity.links;
  if (!links || typeof links !== "object") return null;
  const o = links as Record<string, unknown>;
  for (const key of ["self", "expand", "tags"] as const) {
    const v = o[key];
    if (typeof v === "string") {
      const id = extractEntityIdFromApiEntitiesUrl(v);
      if (id) return id;
    }
  }
  const ui = o.ui;
  if (typeof ui === "string") {
    return extractEntityIdFromUiUrl(ui);
  }
  return null;
}

/** Prefer top-level `id`; otherwise parse `links.self` / `links.ui`. */
export function getCanonicalEntityId(entity: RawEntity): string | null {
  const fromBody = typeof entity.id === "string" ? entity.id.trim() : "";
  if (fromBody) return fromBody;
  return resolveOpenAlephEntityIdFromLinks(entity);
}

const HEAVY_FIELDS = new Set([
  "bodyHtml",
  "bodyText",
  "translatedText",
  "indexText",
  "rawText",
]);

const MAX_JSON_LEN = 800;

function pickFirstStringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = pickFirstStringFromUnknown(item);
      if (s) return s;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const directName = pickFirstStringFromUnknown(o.name);
    if (directName) return directName;
    const nested = o.properties;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nameVal = (nested as Record<string, unknown>).name;
      const s = pickFirstStringFromUnknown(nameVal);
      if (s) return s;
    }
  }
  return null;
}

/**
 * Turn a single Aleph/FtM property value into a readable string.
 * Avoids `String(object)` which becomes "[object Object]".
 */
function valueToDisplayString(value: unknown, depth = 0): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (depth > 4) return null;
    const parts: string[] = [];
    for (const item of value) {
      const s = valueToDisplayString(item, depth + 1);
      if (s) parts.push(s);
    }
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const caption = pickFirstStringFromUnknown(o.caption);
    if (caption) return caption;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (label) return label;
    const name = pickFirstStringFromUnknown(o.name ?? o.properties);
    if (name) return name;
    const id = typeof o.id === "string" ? o.id : null;
    const schema = typeof o.schema === "string" ? o.schema : null;
    if (schema && id) return `${schema}:${id}`;
    if (id) return id;
    try {
      const s = JSON.stringify(o);
      if (!s || s === "{}") return null;
      return s.length > MAX_JSON_LEN ? `${s.slice(0, MAX_JSON_LEN - 3)}...` : s;
    } catch {
      return null;
    }
  }
  return String(value);
}

/** Aleph stores most properties as string[]; values may be strings or nested entity objects. */
function valuesFromPropertyRaw(rawValue: unknown): string[] {
  if (rawValue === null || rawValue === undefined) return [];
  const arr = Array.isArray(rawValue) ? rawValue : [rawValue];
  const out: string[] = [];
  for (const v of arr) {
    const s = valueToDisplayString(v);
    if (s) out.push(s);
  }
  return out;
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function normalizeSchema(schema: string | undefined): string {
  return schema?.trim() || "Unknown";
}

function trimEntityRef(o: unknown): {
  schema: string | null;
  caption: string | null;
  id: string | null;
} | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const e = o as Record<string, unknown>;
  return {
    schema: typeof e.schema === "string" ? e.schema : null,
    caption: typeof e.caption === "string" ? e.caption : null,
    id: typeof e.id === "string" ? e.id : null,
  };
}

/** Compress `parent` / `ancestors` to { schema, caption, id } per entry. */
function normalizeParentAncestors(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    const out = raw
      .map((item) => trimEntityRef(item))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return out.length ? out : undefined;
  }
  const one = trimEntityRef(raw);
  return one ?? undefined;
}

function trimRecipientEntry(item: unknown): UnknownRecord | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const e = item as Record<string, unknown>;
  const schema = typeof e.schema === "string" ? e.schema : null;
  const id = typeof e.id === "string" ? e.id : null;
  const props =
    e.properties && typeof e.properties === "object" && !Array.isArray(e.properties)
      ? (e.properties as Record<string, unknown>)
      : {};
  const name = pickFirstStringFromUnknown(props.name);
  const email = pickFirstStringFromUnknown(props.email);
  const out: UnknownRecord = {};
  if (schema !== null) out.schema = schema;
  if (id !== null) out.id = id;
  if (name) out.name = name;
  if (email) out.email = email;
  if (Object.keys(out).length === 0) return null;
  return out;
}

function trimRecipientsRaw(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const out = raw
    .map(trimRecipientEntry)
    .filter((x): x is UnknownRecord => x !== null);
  return out.length ? out : undefined;
}

function withContentHandling(
  properties: Record<string, unknown>,
  options: FormatterOptions
): { normalized: Record<string, unknown> } {
  const normalized: Record<string, unknown> = {};
  for (const [field, rawValue] of Object.entries(properties)) {
    const values = valuesFromPropertyRaw(rawValue);
    if (values.length === 0) continue;

    if (HEAVY_FIELDS.has(field) && !options.includeContentFields) {
      if (options.contentPreviewChars > 0) {
        normalized[`${field}Preview`] = truncateText(
          values[0] ?? "",
          options.contentPreviewChars
        );
      }
      continue;
    }
    normalized[field] = values.slice(0, options.maxArrayValuesPerField);
  }
  return { normalized };
}

function parseSearchResults(raw: unknown): RawEntity[] {
  const obj = (raw ?? {}) as UnknownRecord;
  return Array.isArray(obj.results) ? (obj.results as RawEntity[]) : [];
}

function resolveDataset(entity: RawEntity & Record<string, unknown>): string | null {
  const d = entity.dataset;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (typeof entity.collection_id === "string" && entity.collection_id.trim()) {
    return entity.collection_id.trim();
  }
  const cid = entity.collection?.id;
  if (typeof cid === "string" && cid.trim()) return cid.trim();
  return null;
}

function resolveScore(entity: RawEntity & Record<string, unknown>): number | null {
  const s = entity.score ?? entity._score;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  return null;
}

function resolveLink(entity: RawEntity): string | null {
  const links = entity.links;
  if (!links || typeof links !== "object") return null;
  const ui = (links as Record<string, unknown>).ui;
  return typeof ui === "string" ? ui : null;
}

/**
 * One compact OpenAleph entity row for search hits and GET /entities/:id.
 */
export function formatSlimEntity(
  entity: RawEntity,
  options: FormatterOptions
): UnknownRecord {
  const ext = entity as RawEntity & Record<string, unknown>;
  const sourceProperties: Record<string, unknown> =
    entity.properties && typeof entity.properties === "object"
      ? { ...entity.properties }
      : {};

  delete sourceProperties.processingAgent;
  delete sourceProperties.processingStatus;

  const trimmedParent =
    "parent" in sourceProperties
      ? normalizeParentAncestors(sourceProperties.parent)
      : undefined;
  const trimmedAncestors =
    "ancestors" in sourceProperties
      ? normalizeParentAncestors(sourceProperties.ancestors)
      : undefined;
  const trimmedRecipients =
    "recipients" in sourceProperties
      ? trimRecipientsRaw(sourceProperties.recipients)
      : undefined;

  delete sourceProperties.parent;
  delete sourceProperties.ancestors;
  delete sourceProperties.recipients;

  const schemaNorm = normalizeSchema(entity.schema);
  const isEmail = isEmailSchema(schemaNorm);
  const isPageOrPages = isPageOrPagesSchema(schemaNorm);

  let emailBodyHtmlForMarkdown: string | null = null;
  if (isEmail && !options.includeContentFields) {
    const rawHtml = flattenBodyHtmlStrings(sourceProperties.bodyHtml);
    if (rawHtml) {
      emailBodyHtmlForMarkdown = rawHtml;
      delete sourceProperties.bodyHtml;
      // Aleph sometimes echoes HTML under `bodyMarkdown`; never pass it through unconverted.
      delete sourceProperties.bodyMarkdown;
    }
  }

  let pagesBodyTextRaw: string | null = null;
  let pagesHighlightSource = false;
  if (isPageOrPages && !options.includeContentFields) {
    const ext = entity as RawEntity & { highlight?: unknown };
    const picked = pickPagesPlainTextForSlim(
      sourceProperties,
      ext.highlight
    );
    if (picked) {
      pagesBodyTextRaw = picked.text;
      pagesHighlightSource = picked.deleteKeys.length === 0;
      for (const k of picked.deleteKeys) {
        delete sourceProperties[k];
      }
    }
  }

  const { normalized } = withContentHandling(sourceProperties, options);

  if (trimmedParent !== undefined) normalized.parent = trimmedParent;
  if (trimmedAncestors !== undefined) normalized.ancestors = trimmedAncestors;
  if (trimmedRecipients !== undefined) normalized.recipients = trimmedRecipients;

  let bodyMarkdownMeta:
    | {
        truncatedBody: boolean;
        bodyMarkdownFullChars: number;
        bodyMarkdownReturnedChars: number;
      }
    | undefined;

  if (emailBodyHtmlForMarkdown !== null) {
    const raw = emailBodyHtmlForMarkdown;
    const htmlForTurndown =
      raw.length > MAX_HTML_INPUT_CHARS_FOR_TURNDOWN
        ? safeTruncateHtmlForTurndown(raw, MAX_HTML_INPUT_CHARS_FOR_TURNDOWN)
        : raw;
    const md = emailHtmlToMarkdown(htmlForTurndown);
    if (md) {
      const maxChars =
        options.contentPreviewChars > 0
          ? options.contentPreviewChars
          : options.bodyMarkdownMaxChars;
      const fullMarkdownChars = md.length;
      const truncatedStr = truncateMarkdownAtBoundary(md, maxChars);
      const returnedMarkdownChars = truncatedStr.length;
      bodyMarkdownMeta = {
        truncatedBody: returnedMarkdownChars < fullMarkdownChars,
        bodyMarkdownFullChars: fullMarkdownChars,
        bodyMarkdownReturnedChars: returnedMarkdownChars,
      };
      normalized.bodyMarkdown = [truncatedStr];
    }
  } else if (pagesBodyTextRaw !== null) {
    const raw = pagesBodyTextRaw;
    const textSlice =
      raw.length > MAX_HTML_INPUT_CHARS_FOR_TURNDOWN
        ? safeTruncatePlainTextForMarkdown(raw, MAX_HTML_INPUT_CHARS_FOR_TURNDOWN)
        : raw;
    const plain = textSlice.replace(/\r\n/g, "\n");
    if (plain) {
      const maxChars =
        options.contentPreviewChars > 0
          ? options.contentPreviewChars
          : options.bodyMarkdownMaxChars;
      const fullChars = plain.length;
      const truncatedStr = truncateMarkdownAtBoundary(plain, maxChars);
      const returnedChars = truncatedStr.length;
      bodyMarkdownMeta = {
        truncatedBody: returnedChars < fullChars,
        bodyMarkdownFullChars: fullChars,
        bodyMarkdownReturnedChars: returnedChars,
      };
      normalized.bodyText = [truncatedStr];
    }
  }

  const out: UnknownRecord = {
    schema: normalizeSchema(entity.schema),
    properties: normalized,
    dataset: resolveDataset(ext),
    score: resolveScore(ext),
    id: getCanonicalEntityId(entity),
    link: resolveLink(entity),
    ...(bodyMarkdownMeta ? bodyMarkdownMeta : {}),
  };
  if (pagesHighlightSource) {
    out.bodyTextFromSearchHighlight = true;
  }

  const hl = (entity as RawEntity & { highlight?: unknown }).highlight;
  if (hl !== undefined && hl !== null) {
    if (Array.isArray(hl) && hl.length > 0) {
      out.highlight = hl;
    } else if (!Array.isArray(hl)) {
      out.highlight = hl;
    }
  }

  return out;
}

/**
 * Full Email body as Markdown (HTML→Markdown, no Markdown length cap).
 * HTML is still capped at {@link MAX_HTML_INPUT_CHARS_FOR_TURNDOWN} for safety; see `htmlSourceTruncated`.
 */
export function getEmailBodyMarkdownUntruncated(entity: RawEntity): {
  markdown: string;
  bodyMarkdownFullChars: number;
  htmlSourceTruncated: boolean;
} | null {
  const schemaNorm = normalizeSchema(entity.schema);
  if (!isEmailSchema(schemaNorm)) return null;
  const props =
    entity.properties && typeof entity.properties === "object"
      ? entity.properties
      : {};
  const rawHtml = flattenBodyHtmlStrings(props.bodyHtml);
  if (!rawHtml) return null;
  const htmlSourceTruncated = rawHtml.length > MAX_HTML_INPUT_CHARS_FOR_TURNDOWN;
  const htmlForTurndown = htmlSourceTruncated
    ? safeTruncateHtmlForTurndown(rawHtml, MAX_HTML_INPUT_CHARS_FOR_TURNDOWN)
    : rawHtml;
  const md = emailHtmlToMarkdown(htmlForTurndown);
  if (!md) return null;
  return {
    markdown: md,
    bodyMarkdownFullChars: md.length,
    htmlSourceTruncated,
  };
}

/**
 * Full **Page** / **Pages** `bodyText` (plain), no response length cap (same safety cap on input size as Email HTML).
 */
export function getPagesBodyTextUntruncated(entity: RawEntity): {
  text: string;
  bodyTextFullChars: number;
  htmlSourceTruncated: boolean;
} | null {
  const schemaNorm = normalizeSchema(entity.schema);
  if (!isPageOrPagesSchema(schemaNorm)) return null;
  const props =
    entity.properties && typeof entity.properties === "object"
      ? entity.properties
      : {};
  let raw: string | null = flattenBodyHtmlStrings(props.bodyText);
  if (!raw) raw = flattenBodyHtmlStrings(props.indexText);
  if (!raw) raw = flattenBodyHtmlStrings(props.rawText);
  if (!raw) return null;
  const htmlSourceTruncated = raw.length > MAX_HTML_INPUT_CHARS_FOR_TURNDOWN;
  const slice = htmlSourceTruncated
    ? safeTruncatePlainTextForMarkdown(raw, MAX_HTML_INPUT_CHARS_FOR_TURNDOWN)
    : raw;
  const text = slice.replace(/\r\n/g, "\n");
  if (!text) return null;
  return {
    text,
    bodyTextFullChars: text.length,
    htmlSourceTruncated,
  };
}

/**
 * Structured search response: bare array of slim hits, or `{ results, raw }` when `includeRaw`.
 */
export function formatAlephStructuredResponse(
  raw: unknown,
  options: FormatterOptions
): unknown {
  const results = parseSearchResults(raw).map((entity) =>
    formatSlimEntity(entity, options)
  );
  if (options.includeRaw) {
    return { results, raw };
  }
  return results;
}

/**
 * Structured GET /api/2/entities/:id: single slim object, or `{ result, raw }` when `includeRaw`.
 */
export function formatEntityGetResponse(
  raw: unknown,
  options: FormatterOptions
): UnknownRecord {
  if (!raw || typeof raw !== "object") {
    return { error: "Empty or invalid response from Aleph" };
  }
  const slim = formatSlimEntity(raw as RawEntity, options);
  if (options.includeRaw) {
    return { result: slim, raw };
  }
  return slim;
}
