# MCP system prompts (OpenAleph / barracuda-mcp)

Use these as **Cursor Rules**, **project instructions**, or paste into a pinned chat. They assume the **barracuda-mcp** server is enabled with tools. **Conventions:** use the **`Pages`** schema for **all document / file retrieval** in search (`schema` / `schemata` or inside **`q`**), and the **`Table`** schema for **spreadsheets / CSVs / tabular data**; do not assume `Document` unless the user’s instance explicitly uses it.

| Tool | Purpose |
|------|---------|
| `aleph_search` | Search the instance (`GET /api/2/search`). |
| `aleph_get_entity` | Load one entity by id (`GET /api/2/entities/:id`) for **metadata** — documents, emails, people, etc. Note: for `Pages` the upstream endpoint excludes the indexed `text` field, so `bodyText` here is often empty. |
| `aleph_get_entity_markdown` | **Full untruncated body text** for one entity. Email: Markdown from `bodyHtml`. Pages: plain `bodyText` — **auto-aggregated from child `Page` entities** when the parent has none (response flags `bodyTextFromChildren: true`, `childPageCount`). |
| `aleph_load_csv` | Load a **tabular** entity (schema **`Table`**, also `CSV` / `Workbook`) into an in-memory **DuckDB** table for SQL analysis. Returns table name, row count, columns, sample rows. |
| `duckdb_query` | Run **one read-only SQL statement** (`SELECT` / `EXPLAIN` / `SHOW` / `DESCRIBE` / `PRAGMA`) over the loaded tables. Cross-table JOINs are plain SQL. |
| `duckdb_list_tables` | List what is currently loaded in DuckDB (table name, source entity, row count, columns). |

**Tabular data:** OpenAleph indexes spreadsheets and CSVs as schema **`Table`** (search with `schemata:Table`). Never try to read a big table through `aleph_get_entity_markdown` or by paging `Row` children — load it with `aleph_load_csv` and answer with `duckdb_query`.

## Files

| File | Use when |
|------|----------|
| [short.md](short.md) | Tight token budget; minimal behavior. |
| [detailed.md](detailed.md) | Default assistant behavior; full tool + output semantics. |
| [master.md](master.md) | **Single paste:** both tools + condensed advanced search + workflow. |
| [investigative-journalism.md](investigative-journalism.md) | Newsroom / investigative workflows, verification, sensitivity. |
| [casefile-workflows.md](casefile-workflows.md) | Scenario prompts: follow-the-money, POI, leaks triage, timelines, spreadsheet analysis. |
| [advanced-openaleph-search.md](advanced-openaleph-search.md) | Crib sheet: phrases, operators, `properties.*`, schema filters (from [OpenAleph Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/)). |

## Official search docs

- [Basic Search](https://openaleph.org/docs/user-guide/101/basic-search/)
- [Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/)
