import { open, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AlephClient } from "./client.js";
import { AlephHttpError } from "./client.js";

/**
 * Minimal entity shape needed for CSV acquisition (subset of the full Aleph
 * entity JSON returned by GET /api/2/entities/:id).
 */
export type CsvEntity = {
  id?: string;
  schema?: string;
  dataset?: string;
  collection_id?: string;
  collection?: { id?: string };
  links?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

/** FtM schema names that are always tabular. */
const TABULAR_SCHEMAS = new Set(["Table", "CSV", "Workbook"]);

/** Page size for Row reconstruction (server cap for search is 10000). */
const ROW_FALLBACK_PAGE_SIZE = 10_000;
/** Hard cap on reconstructed Row entities (guards runaway pagination). */
const MAX_ROW_FALLBACK_ROWS = 1_000_000;

export class CsvSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvSourceError";
  }
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return null;
}

function firstNumber(value: unknown): number | null {
  const s = firstString(value);
  if (s !== null) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** Flatten an FtM property value for JSON loading (arrays of 1 → scalar). */
function flattenPropertyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return value[0] ?? null;
    return value;
  }
  return value ?? null;
}

function summarizePropertyKeys(entity: CsvEntity): string {
  const props = entity.properties ?? {};
  const keys = Object.keys(props).filter((k) => {
    const v = props[k];
    if (v === null || v === undefined) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (keys.length === 0) return "(no non-empty properties)";
  const MAX_KEYS = 20;
  const head = keys.slice(0, MAX_KEYS).join(", ");
  return keys.length > MAX_KEYS
    ? `${head}, … (+${keys.length - MAX_KEYS} more)`
    : head;
}

export type TabularEntity = {
  id: string;
  entity: CsvEntity;
  dataset: string | null;
  fileName: string | null;
};

export type DownloadedFile = { tmpPath: string; bytes: number };

export type ReconstructedRows = { tmpPath: string; rowCount: number };

export type CsvSourceConfig = {
  alephOrigin: string;
  csvMaxBytes: number;
};

/**
 * Acquires tabular data for an OpenAleph entity:
 *  - file-first: download `links.csv` (or `links.file`) from the archive and
 *    stream it to a temp file, enforcing a byte cap;
 *  - Row fallback: mapping-created tables have no source file, so their rows
 *    are reconstructed by paginating `filter:schema=Row&filter:properties.csv=<id>`
 *    search results and writing them as a JSON temp file (avoids CSV quoting
 *    pitfalls entirely).
 */
export class CsvSourceClient {
  constructor(
    private readonly client: Pick<
      AlephClient,
      "getEntity" | "search" | "fetchArchive"
    >,
    private readonly config: CsvSourceConfig
  ) {}

  /**
   * Fetch one entity and validate that it is tabular. Throws
   * {@link CsvSourceError} with a friendly message for 404-free cases like a
   * non-tabular schema or a `Row` id passed by mistake. HTTP errors from the
   * Aleph client (404/403/…) propagate as {@link AlephHttpError}.
   */
  async fetchTabularEntity(id: string): Promise<TabularEntity> {
    const data = await this.client.getEntity(id);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new CsvSourceError(`Empty response from Aleph for id ${id}`);
    }
    const entity = data as CsvEntity;
    const resolvedId =
      typeof entity.id === "string" && entity.id.trim() ? entity.id.trim() : id;
    const schema = typeof entity.schema === "string" ? entity.schema : "";
    const links = entity.links ?? {};
    const hasCsvLink = typeof links.csv === "string" && links.csv.length > 0;
    const hasFileLink =
      typeof links.file === "string" && links.file.length > 0;

    if (schema === "Row") {
      const parentId = firstString(entity.properties?.csv);
      throw new CsvSourceError(
        `Entity ${resolvedId} is a Row entity (a single row of a table), not a table. ` +
          (parentId
            ? `Load the parent table instead: aleph_load_csv with id ${parentId}.`
            : "Load the parent table id from its properties.csv instead.")
      );
    }

    if (!TABULAR_SCHEMAS.has(schema) && !hasCsvLink && !hasFileLink) {
      throw new CsvSourceError(
        `Entity ${resolvedId} is not tabular (schema: ${schema || "unknown"}). ` +
          `Tabular entities have schema Table, CSV, or Workbook, or expose links.csv/links.file. ` +
          `Entity properties present: ${summarizePropertyKeys(entity)}.`
      );
    }

    return {
      id: resolvedId,
      entity,
      dataset:
        entity.dataset ??
        entity.collection_id ??
        entity.collection?.id ??
        null,
      fileName: firstString(entity.properties?.fileName),
    };
  }

  /**
   * Resolve the archive download link for the entity (prefers `links.csv`
   * over `links.file`), resolving relative URLs against the Aleph origin.
   */
  archiveLinkUrl(
    entity: CsvEntity
  ): { url: string; prop: "csv" | "file" } | null {
    const links = entity.links ?? {};
    const csv = typeof links.csv === "string" ? links.csv : null;
    const file = typeof links.file === "string" ? links.file : null;
    const raw = csv ?? file;
    if (!raw) return null;
    let url: string;
    try {
      url = new URL(raw, this.config.alephOrigin).toString();
    } catch {
      return null;
    }
    return { url, prop: csv ? "csv" : "file" };
  }

  /**
   * Download the archive file to a temp file (auth headers are applied by
   * {@link AlephClient.fetchArchive} on the first hop only; the signed
   * redirect target never sees them). Aborts when the byte cap is exceeded.
   * Unlinks the temp file on failure.
   */
  async downloadArchiveFile(entity: CsvEntity): Promise<DownloadedFile> {
    const link = this.archiveLinkUrl(entity);
    if (!link) {
      throw new CsvSourceError(
        "Entity has no links.csv or links.file in its detail view; " +
          "mapping-created tables have no source file (Row reconstruction applies)."
      );
    }
    const response = await this.client.fetchArchive(link.url);
    if (!response.ok) {
      let bodyText = "";
      try {
        bodyText = (await response.text()).slice(0, 500);
      } catch {
        // ignore body read failures
      }
      throw new AlephHttpError(
        `Aleph archive download failed: HTTP ${response.status}`,
        response.status,
        bodyText ? { raw: bodyText } : null
      );
    }
    if (!response.body) {
      throw new CsvSourceError("Archive response has no body stream.");
    }

    const tmpPath = join(tmpdir(), `barracuda-csv-${randomUUID()}.csv`);
    const handle = await open(tmpPath, "w");
    let bytes = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.config.csvMaxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel failures
          }
          throw new CsvSourceError(
            `Download aborted: archive file exceeded the byte cap of ` +
              `${this.config.csvMaxBytes} bytes (ALEPH_CSV_MAX_BYTES). ` +
              `Raise ALEPH_CSV_MAX_BYTES to allow larger downloads.`
          );
        }
        await handle.write(value);
      }
    } catch (e) {
      await unlink(tmpPath).catch(() => {});
      throw e;
    } finally {
      await handle.close();
    }
    return { tmpPath, bytes };
  }

  /**
   * Reconstruct table rows from child `Row` entities via paginated search:
   *
   *   GET /api/2/search?q=*&filter:schema=Row&filter:properties.csv=<id>&limit=10000&offset=…
   *
   * Writes the rows as a JSON array to a temp file and loads it with
   * `read_json_auto` (avoids CSV quoting/escaping pitfalls). `properties.row`
   * is preserved as `_row_index`; rows are sorted by it when present.
   */
  async reconstructRows(entity: CsvEntity): Promise<ReconstructedRows> {
    const tableId =
      typeof entity.id === "string" && entity.id.trim()
        ? entity.id.trim()
        : "unknown";
    const rows: Record<string, unknown>[] = [];
    let total: number | null = null;
    let offset = 0;

    for (;;) {
      const data = (await this.client.search({
        q: "*",
        schema: "Row",
        extraFilters: { "properties.csv": tableId },
        limit: ROW_FALLBACK_PAGE_SIZE,
        offset,
        highlight: false,
      })) as { total?: unknown; results?: unknown } | null;

      if (total === null && data && typeof data.total === "number") {
        total = data.total;
      }
      const results = data ? data.results : undefined;
      const hits = Array.isArray(results) ? results : [];

      for (const hit of hits) {
        if (hit && typeof hit === "object" && !Array.isArray(hit)) {
          rows.push(rowObjectFromEntity(hit as CsvEntity));
        }
      }

      offset += hits.length;
      if (hits.length === 0) break;
      if (total !== null && rows.length >= total) break;
      if (offset >= MAX_ROW_FALLBACK_ROWS) break;
    }

    if (rows.length === 0) {
      throw new CsvSourceError(
        `No rows reconstructed for table ${tableId}: the search ` +
          `\`filter:schema=Row&filter:properties.csv=${tableId}\` returned nothing. ` +
          `This usually means either the table was never ingested into Row entities ` +
          `(ingest gap) or the rows belong to a collection your API key cannot access ` +
          `(access scope). Table entity properties present: ${summarizePropertyKeys(entity)}.`
      );
    }

    rows.sort((a, b) => {
      const ia = typeof a._row_index === "number" ? a._row_index : Number.MAX_SAFE_INTEGER;
      const ib = typeof b._row_index === "number" ? b._row_index : Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });

    const tmpPath = join(tmpdir(), `barracuda-rows-${randomUUID()}.json`);
    try {
      await writeFile(tmpPath, JSON.stringify(rows), "utf8");
    } catch (e) {
      await unlink(tmpPath).catch(() => {});
      throw e;
    }
    return { tmpPath, rowCount: rows.length };
  }
}

function rowObjectFromEntity(hit: CsvEntity): Record<string, unknown> {
  const props = hit.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "csv" || key === "row") continue;
    out[key] = flattenPropertyValue(value);
  }
  const rowIndex = firstNumber(props.row);
  out._row_index = rowIndex ?? null;
  return out;
}
