import { DuckDBInstance } from "@duckdb/node-api";
import { StatementType } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";

/**
 * Statement types an LLM is allowed to run through `duckdb_query`. SELECT
 * covers reads, EXPLAIN query plans, PRAGMA table functions (pragma_table_info,
 * database_list, …) and RELATION covers SHOW/DESCRIBE/SUMMARIZE. Everything
 * else (INSERT, COPY, ATTACH, INSTALL, LOAD, CREATE, DROP, …) is rejected.
 */
const ALLOWED_STATEMENT_TYPES = new Set([
  StatementType.SELECT,
  StatementType.EXPLAIN,
  StatementType.PRAGMA,
  StatementType.RELATION,
]);

export type DuckDbColumn = { name: string; type: string };

export type DuckDbRow = Record<string, unknown>;

export type QueryResult = {
  columns: DuckDbColumn[];
  rows: DuckDbRow[];
  rowCount: number;
  rowLimitHit: boolean;
};

export type TableRegistryEntry = {
  tableName: string;
  entityId: string;
  /** FtM schema of the source entity (Table, CSV, Workbook, …). */
  entitySchema: string | null;
  fileName: string | null;
  dataset: string | null;
  rowCount: number;
  columns: DuckDbColumn[];
  source: "file" | "rows";
  loadedAt: string;
};

export type LoadFormat = "csv" | "json";

export class DuckDbQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuckDbQueryError";
  }
}

export const DEFAULT_QUERY_MAX_ROWS = 200;
export const MAX_QUERY_MAX_ROWS = 5_000;
export const DEFAULT_CELL_MAX_CHARS = 200;

/** Thrown by loadFileToTable when DuckDB rejects the load SQL. */
export class DuckDbLoadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "DuckDbLoadError";
  }
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Normalise a column name into a safe SQL identifier: lowercase, replace
 * anything that isn't a-z 0-9 _ with underscores, collapse & trim, cap at
 * 63 chars (PostgreSQL / DuckDB identifier limit).
 */
export function normalizeColumnName(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/g, "_")
    .replaceAll(/_{2,}/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 63)
    .replace(/^$/, "col");
}

/**
 * Truncate string values in a JSON-safe value tree so one cell cannot blow up
 * the response. Truncation is marked with a `...` suffix.
 */
function truncateCell(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateCell(v, maxChars));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateCell(v, maxChars);
    }
    return out;
  }
  return value;
}

export class DuckDbManager {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private readonly registry = new Map<string, TableRegistryEntry>();

  constructor(
    private readonly options: { memoryLimit?: string; tempDirectory?: string } = {}
  ) {}

  private async ensureConnection(): Promise<DuckDBConnection> {
    if (this.connection) return this.connection;
    const configOptions: Record<string, string> = {
      temp_directory: this.options.tempDirectory ?? "/tmp",
    };
    if (this.options.memoryLimit) {
      configOptions.memory_limit = this.options.memoryLimit;
    }
    this.instance = await DuckDBInstance.create(":memory:", configOptions);
    this.connection = await this.instance.connect();
    return this.connection;
  }

  /**
   * Load a local temp file into a table with normalised column names so that
   * every column is a safe SQL identifier (lowercase, underscores only).
   * Re-loading the same name is idempotent (last load wins).
   */
  async loadFileToTable(
    tmpPath: string,
    tableName: string,
    format: LoadFormat
  ): Promise<{ rowCount: number; columns: DuckDbColumn[] }> {
    const connection = await this.ensureConnection();
    const table = quoteIdentifier(tableName);
    const readerFn =
      format === "csv"
        ? `read_csv_auto(${quoteSqlString(tmpPath)})`
        : `read_json_auto(${quoteSqlString(tmpPath)})`;

    // Step 1: load into a temp table to discover column names.
    const tempName = `__load_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempTable = quoteIdentifier(tempName);
    const loadSql = `CREATE OR REPLACE TABLE ${tempTable} AS SELECT * FROM ${readerFn}`;
    try {
      await connection.run(loadSql);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new DuckDbLoadError(
        `DuckDB failed to load ${format.toUpperCase()} file into table "${tableName}": ${message}`,
        e
      );
    }

    // Step 2: DESCRIBE to get original column names.
    const reader = await connection.runAndReadAll(
      `DESCRIBE SELECT * FROM ${tempTable}`
    );
    await reader.readAll();
    const rows = reader.getRowObjectsJson();
    const originalCols: string[] = rows.map((r: Record<string, unknown>) =>
      String(r.column_name ?? "")
    );

    // Step 3: build the aliased SELECT with normalised names.
    const aliases = originalCols.map((name) => {
      const norm = normalizeColumnName(name);
      return `${quoteIdentifier(name)} AS ${quoteIdentifier(norm)}`;
    });
    const selectList = aliases.join(", ");

    // Step 4: create the final table with normalised column names.
    const finalSql = `CREATE OR REPLACE TABLE ${table} AS SELECT ${selectList} FROM ${tempTable}`;
    try {
      await connection.run(finalSql);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new DuckDbLoadError(
        `DuckDB failed to create table "${tableName}" with normalised columns: ${message}`,
        e
      );
    }

    // Step 5: drop the temp table.
    try {
      await connection.run(`DROP TABLE IF EXISTS ${tempTable}`);
    } catch {
      // best-effort cleanup
    }

    const columns = await this.describeTable(tableName);
    const rowCount = await this.countTableRows(tableName);
    return { rowCount, columns };
  }

  private async describeTable(tableName: string): Promise<DuckDbColumn[]> {
    const connection = await this.ensureConnection();
    const reader = await connection.runAndReadAll(
      `DESCRIBE SELECT * FROM ${quoteIdentifier(tableName)}`
    );
    await reader.readAll();
    const rows = reader.getRowObjectsJson();
    return rows.map((r) => ({
      name: String(r.column_name ?? ""),
      type: String(r.column_type ?? ""),
    }));
  }

  private async countTableRows(tableName: string): Promise<number> {
    const connection = await this.ensureConnection();
    const reader = await connection.runAndReadAll(
      `SELECT count(*) AS n FROM ${quoteIdentifier(tableName)}`
    );
    await reader.readAll();
    const rows = reader.getRowObjectsJson();
    const n = rows[0]?.n;
    const parsed = typeof n === "string" ? Number(n) : Number(n ?? NaN);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Run a read-only SQL statement. Enforces: single statement, allowlisted
   * statement type (SELECT / EXPLAIN / PRAGMA / SHOW / DESCRIBE), row cap and
   * cell truncation. Values are converted to JSON-safe forms (BigInt/Decimal →
   * string, dates → strings) before they leave this class.
   */
  async runQuery(
    sql: string,
    maxRows: number = DEFAULT_QUERY_MAX_ROWS,
    cellMaxChars: number = DEFAULT_CELL_MAX_CHARS
  ): Promise<QueryResult> {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new DuckDbQueryError("SQL query is empty.");
    }
    if (trimmed.includes(";")) {
      // DuckDB cannot prepare multi-statement input anyway, but call out the
      // multi-statement case explicitly for a clearer LLM-facing error.
      const connection = await this.ensureConnection();
      try {
        const extracted = await connection.extractStatements(trimmed);
        if (extracted.count > 1) {
          throw new DuckDbQueryError(
            `Rejected: ${extracted.count} SQL statements found. Run exactly one SELECT/EXPLAIN/SHOW/DESCRIBE statement per call (without trailing semicolons).`
          );
        }
      } catch (e) {
        if (e instanceof DuckDbQueryError) throw e;
        // extractStatements failed to parse; fall through to prepare() which
        // will surface the parser error below.
      }
    }

    const connection = await this.ensureConnection();
    let prepared;
    try {
      prepared = await connection.prepare(trimmed);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new DuckDbQueryError(`Invalid SQL: ${message}`);
    }

    try {
      const statementType = prepared.statementType;
      if (!ALLOWED_STATEMENT_TYPES.has(statementType)) {
        throw new DuckDbQueryError(
          `Rejected: only read-only statements (SELECT, EXPLAIN, SHOW, DESCRIBE, PRAGMA) are allowed; got statement type ${statementType}.`
        );
      }

      // Stream rows just past the cap so rowLimitHit is detectable without
      // materializing an unbounded result. If a chunk boundary lands exactly
      // at the cap, keep fetching one row at a time until the stream ends
      // (exactly `maxRows` rows) or the cap is exceeded.
      const reader = await prepared.runAndReadUntil(maxRows + 1);
      while (!reader.done && reader.currentRowCount <= maxRows) {
        const before = reader.currentRowCount;
        await reader.readUntil(before + 1);
        if (reader.currentRowCount === before) break;
      }
      const totalAvailable = reader.currentRowCount;
      const rowLimitHit = !reader.done || totalAvailable > maxRows;
      const columns: DuckDbColumn[] = [];
      for (let i = 0; i < reader.columnCount; i++) {
        columns.push({
          name: reader.columnName(i),
          type: String(reader.columnType(i)),
        });
      }

      const rows: DuckDbRow[] = [];
      const jsonRows = reader.getRowObjectsJson();
      const limit = Math.min(totalAvailable, maxRows);
      for (let r = 0; r < limit; r++) {
        const row: DuckDbRow = {};
        const obj = jsonRows[r];
        if (!obj) continue;
        for (const col of columns) {
          row[col.name] = truncateCell(obj[col.name], cellMaxChars);
        }
        rows.push(row);
      }

      return { columns, rows, rowCount: rows.length, rowLimitHit };
    } finally {
      prepared.destroySync();
    }
  }

  registerTable(entry: TableRegistryEntry): void {
    this.registry.set(entry.tableName, entry);
  }

  getTable(tableName: string): TableRegistryEntry | undefined {
    return this.registry.get(tableName);
  }

  listTables(): TableRegistryEntry[] {
    return [...this.registry.values()].sort((a, b) =>
      a.tableName.localeCompare(b.tableName)
    );
  }

  /** Close the in-memory database (used by tests; not exposed as a tool). */
  async close(): Promise<void> {
    this.connection?.closeSync();
    this.connection = null;
    this.instance?.closeSync();
    this.instance = null;
    this.registry.clear();
  }
}
