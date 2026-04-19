import type { AppConfig } from "../config.js";
import { clampSearchLimit } from "../config.js";

export type SearchQueryInput = {
  q: string;
  limit?: number;
  offset?: number;
  collectionId?: string;
  facets?: string[];
  extraFilters?: Record<string, string>;
  schema?: string;
  schemata?: string;
  /** Ask OpenAleph for ES highlight fragments on each hit (`highlight=true`). */
  highlight?: boolean;
  /** Maps to `highlight_count` (default on server is often 3). */
  highlightCount?: number;
  /** Maps to `highlight_length` (fragment size). */
  highlightLength?: number;
};

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

    let q = input.q;
    if (input.schemata?.trim()) {
      q = mergeLuceneClauseIntoQ(q, `schemata:${input.schemata.trim()}`);
    }

    const limit = clampSearchLimit(input.limit);
    if (limit !== undefined) params.set("limit", String(limit));
    if (input.offset !== undefined && Number.isFinite(input.offset)) {
      params.set("offset", String(Math.max(0, Math.floor(input.offset))));
    }

    if (input.collectionId) {
      params.set("filter:collection_id", input.collectionId);
    }
    if (input.schema) {
      params.set("filter:schema", input.schema);
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
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs
    );

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers(),
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
