# Scenario prompts — investigations (combine with `detailed.md` or `short.md`)

Paste one block as a **user** or **system** supplement when starting a focused task. All assume **`aleph_search`** + **`aleph_get_entity`** are available.

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
3. For promising **`Pages`** / **`Email`** rows, **`aleph_get_entity`** with **`includeContentFields: false`** first; escalate to full text only if snippets are insufficient.

---

## C. “One leak, many formats”

**Goal:** Triage a large upload (emails + PDFs + spreadsheets).

1. Fix **`collectionId`** to that dataset.  
2. Run several **`aleph_search`** passes with **`schemata:Pages`** for document/file content (and **`schemata:Email`** when you want mail): (1) top keywords, (2) file-type hints via `mime_type` / `extension` in **`extraFilters`** if your index uses them, (3) date windows via **`properties.*`** fields.  
3. Keep **`limit`** small; use **`offset`** to page.  
4. For each priority hit, fetch entity detail and produce a **table**: id, type, title/subject, date, why it matters.

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
- **Short verbatim excerpt** only if returned with **`includeContentFields`** or preview; otherwise describe the field (e.g. “title”, “date”) without fabricating text.

---

## F. “Cross-border shell trail”

**Goal:** Entities spanning countries.

Use boolean groups + country keywords, then **`aleph_get_entity`** on **`LegalEntity`** / **`Company`** hits. Prefer **metadata in `properties`** (registration number, jurisdiction) over body text when available.

---

Use [advanced-openaleph-search.md](advanced-openaleph-search.md) for `q` syntax (phrases, `properties.*`, dates, regex cautions).
