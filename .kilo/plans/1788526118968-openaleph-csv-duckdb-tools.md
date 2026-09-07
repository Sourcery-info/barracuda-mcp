# Plan: OpenAleph CSV analysis via DuckDB tools

## Goal

Give LLMs calling barracuda-mcp the ability to analyze tabular OpenAleph entities (`Table`/`CSV`/`Workbook` family) with SQL. Raw CSVs are too large for LLM context, so the server downloads the data into an in-process DuckDB instance and exposes read-only query tools. Follows existing repo patterns: one module per tool in `src/mcp/`, zod `inputSchema` + `run<Tool>` function, wired in `registerTools.ts`, injectable `fetch` for tests.

## Resolved decisions

1. **Data acquisition:** raw file first, Row reconstruction as fallback.
   - Primary: entity detail view (`GET /api/2/entities/:id`) returns `links.csv` / `links.file` for Document-family schemas → `GET /api/2/archive?entity=<id>&prop=csvHash|contentHash` → 302 to a signed URL. Stream to temp file, load with DuckDB `read_csv`.
   - Fallback (mapping-created tables have no source file): reconstruct rows via `GET /api/2/search?filter:schema=Row&filter:properties.csv=<table_id>&limit=10000` (paginate by offset until `total`). Same exact-term filter pattern the repo already uses for `Page` children. Write rows as a JSON temp file and load with `read_json_auto` (avoids CSV quoting; column names are slugified properties; keep `row` index as `_row_index`).
2. **Tool surface:** exactly 3 tools — `aleph_load_csv`, `duckdb_query`, `duckdb_list_tables`. All tables share one per-process DuckDB instance, so cross-CSV joins are plain SQL.
3. **Persistence:** in-memory (`:memory:`) DuckDB, created lazily on first load; tables die with the server process. No disk cache.

## Key OpenAleph facts (verified)

- `EntitySerializer._serialize` (aleph/views/serializers.py): when `detail_view` and schema `is_a(Document)`, links are emitted for `("file", "contentHash")`, `("pdf", "pdfHash")`, `("csv", "csvHash")` → `url_for("archive_api.resolve", _query=[("entity", id), ("prop", prop)])`. So only the **single-entity detail** endpoint carries these links; search hits do not.
- `Row` entities: `properties.csv` → Table id, `properties.row` → index; column values are slugified property names.
- FtM hierarchy: `Document` → `Table` → `CSV`; `Workbook` is also Document-family. Ingest converts spreadsheets to a CSV (`csvHash`), so the file path transparently covers xlsx.

## Architecture / data flow

```
aleph_load_csv(id, alias?)
  → AlephClient.getEntity(id)                     // detail JSON: schema, properties, links, collection
  → schema/tabular check (Table|CSV|Workbook, or links.csv/links.file present)
  → if links.csv|links.file: stream download (auth headers on first hop only; follow redirect manually, strip Authorization for the signed URL) to temp file, enforcing max bytes
    else: Row fallback → paginate search → write JSON temp file
  → DuckDB: CREATE OR REPLACE TABLE <name> AS SELECT * FROM read_csv_auto('<tmp>') | read_json_auto('<tmp>')
  → unlink temp file
  → respond { table, source, rowCount, columns:[{name,type}], sample (first 10 rows), entity metadata }
```

`duckdb_query(sql, maxRows?)` → prepare → statement-type allowlist → execute → capped JSON rows.
`duckdb_list_tables()` → registry snapshot with columns + entity metadata.

## New dependency

- `@duckdb/node-api` (official Node binding; prebuilt platform binaries via optional deps; Node 20 OK).
- During implementation, verify exact API surface (instance create, `connect()`, `prepare()`/statement type, `fetchRowObjects`/row streaming, BigInt handling). If `prepare()` cannot expose statement type in the current release, fall back to `EXPLAIN <sql>` dry-run + keyword guard before executing.

## Files to create / change (ordered)

1. **`src/duckdb/manager.ts`** — `DuckDbManager` class:
   - Lazy `DuckDBInstance.create(":memory:")`, one connection; `SET memory_limit` from env (optional), `SET temp_directory` to `os.tmpdir()`.
   - `loadFileToTable(tmpPath, tableName, format: "csv" | "json")`, `runQuery(sql)`, `listTables()`.
   - Read-only enforcement: reject multi-statements; prepare and allow only statement types SELECT, EXPLAIN, PRAGMA, RELATION (`SHOW`/`DESCRIBE`). Everything else → clear error.
   - Row serialization: convert BigInt/Decimal/HUGEINT → string, dates → ISO strings; cap cell string length (default 200 chars, mark truncation with `...`); return rows + `rowLimitHit`.
2. **`src/aleph/csvSource.ts`** — acquisition logic on `AlephClient` or a new `CsvSourceClient` taking `Pick<AlephClient, "getEntity" | "search">` + config:
   - `fetchTabularEntity(id)`: entity detail; validate tabular; friendly errors (404/403; non-tabular schema lists actual schema; a `Row` id passed by mistake hints at the parent `properties.csv` id).
   - `downloadArchiveFile(entity)`: GET link with auth; on 301/302/303/307 re-fetch `Location` **without** Authorization header (S3 rejects signed-query + header auth); stream to temp file with byte cap (`ALEPH_CSV_MAX_BYTES`, default 500 MB) and abort on overrun; return temp path + byte size.
   - `reconstructRows(entity)`: paginate `filter:schema=Row&filter:properties.csv=<id>&limit=10000` by offset (reuse `clampSearchLimit` semantics; hard cap offsets at e.g. 1M rows); write JSON temp file; return path + row count.
3. **`src/mcp/alephLoadCsv.ts`** — tool module (zod schema: `id` required, `alias` optional sanitized to `[a-z0-9_]{1,63}`, default name `t_<sanitized entity id>`; `sampleRows` optional default 10; `force` optional to reload). Uses manager + csvSource; replaces existing table with same name (`CREATE OR REPLACE`); maintains registry `Map<tableName, { entityId, schema, fileName?, dataset, rowCount, columns, source, loadedAt }>`.
4. **`src/mcp/duckdbQuery.ts`** — tool module (zod: `sql` required, `maxRows` optional 1–5000 default 200). Returns `{ columns, rows, rowCount, rowLimitHit }` as JSON text; `isError` for blocked SQL, syntax errors, empty SQL.
5. **`src/mcp/duckdbListTables.ts`** — tool module (no args). Returns array of `{ table, entityId, schema, fileName, dataset, rowCount, columns:[{name,type}] }`; empty-array guidance message when nothing loaded ("load one with aleph_load_csv").
6. **`src/mcp/registerTools.ts`** — register the 3 tools (clear descriptions telling the LLM to load first, then analyze with SQL; mention joins across loaded tables).
7. **`src/index.ts`** — instantiate `DuckDbManager`, pass to `registerAlephTools`.
8. **`src/config.ts`** — add optional `ALEPH_CSV_MAX_BYTES` (default 524288000, min 1 MB), optional `ALEPH_DUCKDB_MEMORY_LIMIT` (string like `2GB`, unset = DuckDB default); extend `AppConfig` + tests.
9. **`src/aleph/client.ts`** — add raw-response fetch helper for archive download (returns `Response`/body stream rather than parsed JSON; shares headers/timeout machinery). Keep existing JSON methods untouched.
10. **Tests** (vitest, mock `FetchLike` like existing tests; real DuckDB against small fixture CSVs in `test/fixtures/`):
    - `test/duckdbManager.test.ts`: load csv/json, SELECT works, INSERT/COPY/ATTACH/INSTALL blocked, multi-statement rejected, row caps + cell truncation + BigInt→string.
    - `test/alephLoadCsv.test.ts`: file path (entity JSON with `links.csv` + streamed CSV body), Rows fallback path (no links; paginated search), non-tabular entity error, Row-id hint error, byte-cap overrun error, temp file cleanup.
    - `test/duckdbQuery.test.ts`, `test/duckdbListTables.test.ts`.
    - `test/e2e/aleph-csv.e2e.test.ts` gated on `ALEPH_E2E_CSV_ENTITY_ID` (load real Table entity, run COUNT + sample query). Skip cleanly when unset (match `aleph-entity.e2e.test.ts` pattern).
11. **`.env.example`** + **`README.md`** — new tool docs (args, output shape), env vars, troubleshooting (e.g. "no `links.csv` → Row fallback; mapping tables lose original headers"; UTF-8 assumption for exotic encodings). Optional: short CSV-workflow section in `prompts/`.

## Safety & limits

- SQL is LLM-generated: allowlist statement types; no DuckDB extensions installed/loaded; `read_*` table functions fine. Reject multi-statement input.
- Response size guards: `maxRows` cap; cell truncation; single-text-content JSON reply.
- Download guards: byte cap with abort; request timeout reused (`ALEPH_REQUEST_TIMEOUT_MS`); temp files in `os.tmpdir()`, always unlinked.
- Auth: `Authorization: ApiKey` on Aleph API calls only; never forwarded to the signed archive URL.

## Edge cases / failure modes

- Entity deleted/no access → pass through `AlephHttpError` formatting (existing pattern).
- Workbook/xlsx: `links.csv` present → works transparently.
- Mapping table (no links) + zero Row children → error: ingest gap vs access-scope message, echoing the exact fallback query tried (pattern used by `aleph_get_entity_markdown`).
- Re-loading the same entity id → replaces table under same auto-name, reports fresh rowCount.
- Table name collision between alias and auto-name → last load wins (`CREATE OR REPLACE`), registry updated.
- `Row` tables > 10k → offset pagination loop until `total`; log progress; hard offset cap.
- Non-UTF-8 CSV → DuckDB `read_csv_auto` may error; surface DuckDB message verbatim (known limitation, documented).

## Validation plan

- `npm test` (all unit tests, incl. new ones), `npm run lint`, `npm run build`.
- `npm run test:e2e` with `ALEPH_E2E_CSV_ENTITY_ID` set against the real instance (loads entity, asserts rowCount > 0 and a sample SELECT).
- Manual smoke: run server (`npm run dev`) with real credentials, drive the 3 tools from an MCP client.

## Out of scope (future)

- Disk cache by contentHash; persistent DuckDB file; unload tool.
- Non-Aleph local/remote CSV loading (`duckdb_query` against arbitrary paths).
- `Page`/`Pages`→DuckDB text extraction; xlsx via native `excel` extension; query timeouts via worker thread.
- Named-parameter reuse of existing e2e env plumbing for CSV (only add what's listed).

## Risks

- `@duckdb/node-api` statement-type API differences → fallback strategy specified above; pin exact version in `package.json`.
- Signed-URL redirect handling varies by deployment (same-origin S3 vs external bucket) → manual redirect handling covers both; unit-test both.
- Very large in-memory tables → `ALEPH_DUCKDB_MEMORY_LIMIT` + DuckDB temp spill mitigates; document.
