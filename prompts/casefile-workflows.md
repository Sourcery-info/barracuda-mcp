# Scenario prompts — investigations (combine with `detailed.md` or `short.md`)

Paste one block as a **user** or **system** supplement when starting a focused task. All assume **`aleph_search`**, **`aleph_get_entity`**, **`aleph_get_entity_markdown`**, **`aleph_load_csv`**, **`duckdb_query`**, and **`duckdb_list_tables`** are available.

> **Reading full document text:** `aleph_get_entity` returns **metadata** for a `Pages` entity but its `bodyText` is usually empty — OpenAleph’s single-entity endpoint excludes the indexed text field. For the **actual extracted text of a PDF/document**, call **`aleph_get_entity_markdown`**; it auto-aggregates per-page text from child `Page` entities (flagged with `bodyTextFromChildren: true`, `childPageCount`).

> **Reading tabular data:** spreadsheets and CSVs are schema **`Table`** in OpenAleph (also `CSV` / `Workbook`). Don’t read them as text and don’t page their child `Row` entities — call **`aleph_load_csv`** with the `Table` id to load it into in-memory DuckDB, then analyze with **`duckdb_query`** (one read-only statement per call). **`duckdb_list_tables`** shows what is loaded; tables share one database, so **cross-table JOINs are plain SQL**.

---

## A. “Follow the company”

**Goal:** Map a corporate network mentioned in a tip.

1. Search the legal name in quotes; add jurisdiction tokens if known.  
2. Narrow with **`schemata:Company`** or **`schema:Company`** if your instance uses that split.  
3. Open the strongest **`Company`** hits with **`aleph_get_entity`**, then pivot using related properties (directors, addresses) surfaced in **`properties`**.  
4. Summarize as a **bullet timeline**: entity id → role → source doc id (if any).

---

## B. “Person of interest”

**Goal:** Find documents and emails mentioning a person without over-collecting.

1. Use quoted name variants + **`NOT`** common false positives if needed.  
2. Add **`schema:Person`** only when you want profile-like entities; use free-text search when you want **mentions inside documents**. When you need **document or file hits**, include **`schemata:Pages`** (or **`schema:Pages`**)—use **`Pages`** for all document retrieval in this setup.  
3. For promising **`Pages`** / **`Email`** rows, **`aleph_get_entity`** with **`includeContentFields: false`** first; escalate to full text with **`aleph_get_entity_markdown`** (Email Markdown, Pages plain text auto-aggregated from child pages) when snippets are insufficient.

---

## C. “One leak, many formats”

**Goal:** Triage a large upload (emails + PDFs + spreadsheets).

1. Fix **`collectionId`** to that dataset.  
2. Run several **`aleph_search`** passes with **`schemata:Pages`** for document/file content (and **`schemata:Email`** when you want mail, **`schemata:Table`** for spreadsheets/CSVs): (1) top keywords, (2) file-type hints via `mime_type` / `extension` in **`extraFilters`** if your index uses them, (3) date windows via **`properties.*`** fields.  
3. Keep **`limit`** small; use **`offset`** to page.  
4. For each priority hit, fetch entity detail and produce a **table**: id, type, title/subject, date, why it matters.  
5. Route by type: `Pages` / `Email` → **`aleph_get_entity_markdown`**; **`Table`** → **`aleph_load_csv`** + **`duckdb_query`** (see block **G**). A single spreadsheet often characterizes a dump faster than reading documents — get its row count, column list, and date range first.

---

## D. “Verify the allegation”

**Goal:** Check whether a specific claim appears in the index.

1. Encode the claim as **testable queries** (names, amounts, locations)—quotes for phrases.  
2. If nothing returns, broaden with **`OR`**, **`~2`**, or property-specific filters.  
3. Report **negative results** honestly: “no indexed match for … under these filters.”

---

## E. “Export-ready citations”

**Goal:** Give an editor traceable references.

For each material fact, output:

- **Entity id**  
- **Schema**  
- **`link`** — the **exact** OpenAleph UI URL from tool output only (markdown link in deliverables); never substitute or supplement with non-OpenAleph URLs  
- **Collection** (if present)  
- **Short verbatim excerpt** — for `Pages` / `Email` quote from **`aleph_get_entity_markdown`** (full, untruncated); for structured fields, use the preview from search / `aleph_get_entity`. Never fabricate text.
- **For figures from a `Table`** — the **SQL statement** you ran, the **source `Table` entity id + `link`** (not the DuckDB table name), and any caveat: `maxRows` cap, `WHERE` filters, rows excluded as null/unparseable, or `source: "rows"` (headers reconstructed, see block **G**).

---

## F. “Cross-border shell trail”

**Goal:** Entities spanning countries.

Use boolean groups + country keywords, then **`aleph_get_entity`** on **`LegalEntity`** / **`Company`** hits. Prefer **metadata in `properties`** (registration number, jurisdiction) over body text when available.

---

## G. “Interrogate the spreadsheet”

**Goal:** Answer questions from a payments ledger, tender list, registry export, or any other sheet — without pulling thousands of rows into context.

1. Find it: **`aleph_search`** with **`schemata:Table`** (OpenAleph’s schema for spreadsheets and CSVs; add `CSV` / `Workbook` if your instance mixes them), plus **`collectionId`** when the dataset is known.  
2. **`aleph_load_csv`** with the hit’s **`id`** and a readable **`alias`** (e.g. `payments`). Read the response before writing SQL: **`rowCount`**, **`columns`**, **`sample`**, and **`source`** — `"file"` keeps the original headers, **`"rows"`** means the table was rebuilt from child `Row` entities so headers are **slugified property names** and original order lives in **`_row_index`**.  
3. **Profile first** with `duckdb_query`: `SELECT count(*) …`, `DESCRIBE payments`, `SELECT min(date), max(date) …`, `SELECT col, count(*) … GROUP BY col ORDER BY 2 DESC LIMIT 20`. Cheap queries that tell you what the sheet actually contains.  
4. **Then ask the story questions**: totals by counterparty, payments above a threshold, duplicates (`GROUP BY … HAVING count(*) > 1`), round-number or out-of-hours outliers, gaps in a sequence.  
5. **Pivot back to OpenAleph**: take the top names from SQL and run them through **`aleph_search`** for contracts, emails, and company records.  
6. Report with the **SQL**, the **source entity id + `link`**, and the caveats (filters, casts, nulls dropped, `maxRows` cap).

**Watch for:** amounts stored as text (cast explicitly and say you did), mixed date formats, trailing-space name variants (`trim`/`lower` before grouping), and totals that exclude unparseable rows — count those rows rather than ignoring them.

---

## H. “Join two tables”

**Goal:** Cross-reference two sheets — e.g. suppliers paid against a directors or sanctions list.

1. **`aleph_load_csv`** each one with a distinct **`alias`** (`payments`, `directors`). All loaded tables share one in-memory DuckDB, so a JOIN is plain SQL — no export step.  
2. **`duckdb_list_tables`** to confirm both names and their columns.  
3. Normalize in the JOIN key (`lower(trim(name))`), and treat matches as **candidates**: name collisions are not identity. Report them as “names matching in both sheets”, then verify each one against `Person` / `Company` entities in OpenAleph.  
4. Quantify both sides: how many rows matched, how many did not, and what the unmatched remainder looks like.

---

Use [advanced-openaleph-search.md](advanced-openaleph-search.md) for `q` syntax (phrases, `properties.*`, dates, regex cautions).
