import type { AppConfig } from "../config.js";
import { clampSearchLimit } from "../config.js";

/**
 * Schema filters can be either a single schema name ("Email"), a comma/space
 * separated string ("Email,Pages"), or an array (["Email", "Pages"]). Multiple
 * schemas are combined with OR because `filter:schema` / `filter:schemata`
 * only accept a single value per call on most OpenAleph deployments.
 */
export type SchemaFilterInput = string | string[];

export type SearchQueryInput = {
  q: string;
  limit?: number;
  offset?: number;
  collectionId?: string;
  facets?: string[];
  extraFilters?: Record<string, string>;
  schema?: SchemaFilterInput;
  schemata?: SchemaFilterInput;
  /** Ask OpenAleph for ES highlight fragments on each hit (`highlight=true`). */
  highlight?: boolean;
  /** Maps to `highlight_count` (default on server is often 3). */
  highlightCount?: number;
  /** Maps to `highlight_length` (fragment size). */
  highlightLength?: number;
};

/**
 * Normalize a schema filter argument to a de-duplicated list of trimmed schema
 * names. Accepts an array, a single name, or a comma/whitespace separated
 * string like `"Email,Pages"` or `"Email, Pages"`.
 */
export function normalizeSchemaList(
  value: SchemaFilterInput | undefined
): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    for (const part of item.split(/[,\s]+/)) {
      const trimmed = part.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

function buildSchemaOrClause(field: "schema" | "schemata", names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${field}:${names[0]}`;
  return names.map((name) => `${field}:${name}`).join(" OR ");
}

export class AlephHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "AlephHttpError";
  }
}

export type FetchLike = typeof fetch;

/** Redirect statuses we follow manually for archive downloads. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Max redirect hops when resolving an archive URL to its signed target. */
export const MAX_ARCHIVE_REDIRECTS = 3;

/**
 * Some OpenAleph/Elasticsearch deployments return 500 on `filter:schemata` while accepting
 * `schemata:Name` inside the main `q` string (see OpenAleph Advanced Search).
 */
function mergeLuceneClauseIntoQ(query: string, clause: string): string {
  const q = query.trim();
  const c = clause.trim();
  if (!c) return q;
  if (!q) return c;
  if (q.includes(c)) return q;
  return `(${q}) AND (${c})`;
}

export class AlephClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
  ) {}

  private headers(): Headers {
    const h = new Headers();
    h.set("Authorization", `ApiKey ${this.config.apiKey}`);
    h.set("X-Aleph-Session", this.config.sessionId);
    h.set("User-Agent", this.config.userAgent);
    h.set("Accept", "application/json");
    return h;
  }

  buildEntityUrl(id: string): string {
    const path = `/api/2/entities/${encodeURIComponent(id)}`;
    return `${this.config.alephOrigin}${path}`;
  }

  buildSearchUrl(input: SearchQueryInput): string {
    const params = new URLSearchParams();

    const schemataList = normalizeSchemaList(input.schemata);
    const schemaList = normalizeSchemaList(input.schema);

    let q = input.q;
    const schemataClause = buildSchemaOrClause("schemata", schemataList);
    if (schemataClause) {
      q = mergeLuceneClauseIntoQ(q, schemataClause);
    }

    const limit = clampSearchLimit(input.limit);
    if (limit !== undefined) params.set("limit", String(limit));
    if (input.offset !== undefined && Number.isFinite(input.offset)) {
      params.set("offset", String(Math.max(0, Math.floor(input.offset))));
    }

    if (input.collectionId) {
      params.set("filter:collection_id", input.collectionId);
    }
    if (schemaList.length === 1) {
      params.set("filter:schema", schemaList[0]!);
    } else if (schemaList.length > 1) {
      // `filter:schema` only accepts a single value; OR the names inside q.
      q = mergeLuceneClauseIntoQ(q, buildSchemaOrClause("schema", schemaList));
    }

    params.set("q", q);

    for (const facet of input.facets ?? []) {
      if (facet.trim()) params.append("facet", facet);
    }

    for (const [key, value] of Object.entries(input.extraFilters ?? {})) {
      if (!key.trim() || value === undefined) continue;
      params.set(`filter:${key}`, value);
    }

    if (input.highlight !== undefined) {
      params.set("highlight", input.highlight ? "true" : "false");
      if (input.highlight) {
        if (input.highlightCount !== undefined) {
          params.set("highlight_count", String(input.highlightCount));
        }
        if (input.highlightLength !== undefined) {
          params.set("highlight_length", String(input.highlightLength));
        }
      }
    }

    const path = "/api/2/search";
    return `${this.config.alephOrigin}${path}?${params.toString()}`;
  }

  private async requestJson(
    url: string,
    errorLabel: string
  ): Promise<unknown> {
    const response = await this.fetchWithTimeout(url, {
      headers: this.headers(),
      redirect: "follow",
    });

    const text = await response.text();
    let body: unknown = null;
    if (text.length) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { raw: text };
      }
    }

    if (!response.ok) {
      throw new AlephHttpError(
        `${errorLabel}: HTTP ${response.status}`,
        response.status,
        body
      );
    }

    return body;
  }

  private async fetchWithTimeout(
    url: string,
    init: { headers: Headers; redirect: "follow" | "manual" | "error" }
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs
    );

    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: init.headers,
        redirect: init.redirect,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AlephHttpError(
          `Aleph request timed out after ${this.config.requestTimeoutMs}ms`,
          408,
          null
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private archiveHeaders(): Headers {
    const h = this.headers();
    h.set("Accept", "*/*");
    return h;
  }

  /**
   * Fetch an archive URL and return the raw `Response` (body stream) without
   * parsing. The Aleph archive endpoint answers with a 302 redirect to a
   * signed URL (often S3). Node's `fetch` follows redirects and forwards the
   * `Authorization: ApiKey` header on same-origin hops, which S3 rejects
   * (SignatureDoesNotMatch) because the signed query did not include it. So
   * redirects are followed manually: auth headers are sent on the first hop
   * only and stripped from every subsequent hop.
   */
  async fetchArchive(url: string): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= MAX_ARCHIVE_REDIRECTS; hop++) {
      const isFirstHop = hop === 0;
      const response = await this.fetchWithTimeout(current, {
        headers: isFirstHop ? this.archiveHeaders() : this.plainHeaders(),
        redirect: "manual",
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        // Drain/cancel the redirect body before following.
        try {
          await response.arrayBuffer();
        } catch {
          // ignore body read failures on redirects
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new AlephHttpError(
            `Aleph archive redirect (${response.status}) without Location header`,
            502,
            null
          );
        }
        current = new URL(location, current).toString();
        continue;
      }
      return response;
    }
    throw new AlephHttpError(
      `Aleph archive redirect chain exceeded ${MAX_ARCHIVE_REDIRECTS} hops`,
      508,
      null
    );
  }

  /** Headers for signed redirect targets: no Authorization / session. */
  private plainHeaders(): Headers {
    const h = new Headers();
    h.set("User-Agent", this.config.userAgent);
    h.set("Accept", "*/*");
    return h;
  }

  async search(input: SearchQueryInput): Promise<unknown> {
    return this.requestJson(this.buildSearchUrl(input), "Aleph search failed");
  }

  /**
   * Fetch one entity by id (documents, emails, people, etc.).
   * OpenAleph: GET /api/2/entities/:id
   */
  async getEntity(id: string): Promise<unknown> {
    const trimmed = id.trim();
    if (!trimmed) {
      throw new AlephHttpError("Entity id is required", 400, null);
    }
    return this.requestJson(this.buildEntityUrl(trimmed), "Aleph get entity failed");
  }
}
