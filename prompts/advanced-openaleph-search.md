# Advanced OpenAleph search — reference for `aleph_search` / `q`

OpenAleph’s search bar uses **Elasticsearch-style** query strings. The `q` parameter in **`aleph_search`** follows the same ideas. Official guide: [Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/).

## Exact phrase

Double quotes:

```text
"Vladimir Putin"
```

Normalization may match transliterated forms (e.g. Cyrillic).

## Fuzzy / spelling variation

Tilde with edit distance:

```text
Putin~2
```

Matches terms within two character edits of “Putin”.

## Proximity

Terms within N words of each other:

```text
"Trump Putin"~10
```

## Boolean operators

- **AND** — both terms required: `Trump AND Putin`
- **OR** — either term: `Trump OR Putin`
- **NOT** — exclude: `Trump NOT Putin`
- **Parentheses** — grouping: `(Trump OR Biden) AND (Russia OR Ukraine)`

## Required / excluded terms (Lucene-style)

Example from the docs:

```text
+Trump AND (Salman OR Putin) -South Korea
```

(`+` must match, `-` must not.)

## Property filters (`properties.`)

**Email example**

```text
properties.email:john.doe@example.org
```

Approximate:

```text
properties.email:john.doe@example.org~1
```

Regex (expensive—use sparingly):

```text
properties.email:/john.?doe@example.org/
```

## Dates

Greater than:

```text
properties.incorporationDate:>2010-07-01
```

Range:

```text
properties.incorporationDate:[2010-01-01 TO 2015-12-31]
```

## Numeric fields (`numeric.` prefix)

```text
numeric.rowCount:>99
```

## Schema vs schemata

- **`schema:LegalEntity`** — exact schema  
- **`schemata:LegalEntity`** — that schema **and descendants**

In **`aleph_search`**, you can pass tool arg **`schema`** (HTTP `filter:schema`) or **`schemata`** (merged into **`q`** as `schemata:Name`, not as `filter:schemata`, for server compatibility). You can still write `schemata:…` or `schema:…` directly inside **`q`** if you prefer.

### Multiple schemas

Both **`schema`** and **`schemata`** accept **one name**, an **array**, or a **comma- or space-separated string**:

```json
{ "schemata": "Email,Pages" }
{ "schemata": ["Email", "Pages"] }
```

All of the above are normalized and merged into **`q`** as `(schemata:Email OR schemata:Pages)` so OpenAleph returns hits from **either** schema. **Do not** pass a bare `"Email,Pages"` expecting OpenAleph to match it as a single schema name—there is no such schema. For single-value **`schema`** the tool still uses HTTP **`filter:schema`**; multi-value **`schema`** is OR-merged into **`q`** because `filter:schema` only accepts one value.

### barracuda-mcp: documents and files

This MCP’s prompts assume **document and file-body retrieval** uses the **`Pages`** schema. Prefer **`schemata:Pages`** or **`schema:Pages`** when searching for PDFs, office documents, and similar indexed files—unless you know your OpenAleph instance labels them differently.

## Collection / dataset

In the query string:

```text
collection_id:123
```

Or use the tool argument **`collectionId`** (maps to `filter:collection_id` in the API). Replace `123` with the real id from the dataset/investigation URL.

## Field search in the UI vs API

The Advanced Search doc notes that **some property searches are not fully exposed in the UI** but still matter for precise API queries—use `q` with `properties.*` when you need that precision.
