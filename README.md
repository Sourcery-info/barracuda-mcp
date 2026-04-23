# barracuda-mcp

[![npm version](https://img.shields.io/npm/v/barracuda-mcp.svg)](https://www.npmjs.com/package/barracuda-mcp)
[![npm downloads](https://img.shields.io/npm/dm/barracuda-mcp.svg)](https://www.npmjs.com/package/barracuda-mcp)
[![license](https://img.shields.io/npm/l/barracuda-mcp.svg)](./LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **OpenAleph** entity and document search via the official HTTP API (`GET /api/2/search`). It is intended for use from **LM Studio** (recommended), **Cursor**, **Claude Desktop**, and other MCP clients over **stdio**.

[![Add to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-light.svg)](lmstudio://add_mcp?name=barracuda-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJhcnJhY3VkYS1tY3AiXSwiZW52Ijp7IkFMRVBIX0JBU0VfVVJMIjoiaHR0cHM6Ly95b3VyLWluc3RhbmNlLmV4YW1wbGUub3JnIiwiQUxFUEhfQVBJX0tFWSI6InlvdXJfYXBpX2tleV9oZXJlIn19)

> After clicking **Add to LM Studio**, update `ALEPH_BASE_URL` and `ALEPH_API_KEY` in LM Studio's MCP settings.

## Requirements

- **Node.js 20+**
- An OpenAleph instance with a valid **API key** (see [OpenAleph Python guide](https://openaleph.org/docs/user-guide/104/python/) for `OPAL_HOST` / `OPAL_API_KEY` conventions)

## Install

### As an npm package (recommended)

Run the latest published version directly with `npx` (no install needed):

```bash
npx -y barracuda-mcp
```

Or install globally:

```bash
npm install -g barracuda-mcp
barracuda-mcp
```

Or add it as a dependency to another project:

```bash
npm install barracuda-mcp
```

The package ships with a `barracuda-mcp` executable (defined in the `bin` field) that speaks MCP over **stdio**.

### From source

```bash
git clone https://github.com/Sourcery-info/barracuda-mcp.git
cd barracuda-mcp
npm ci
npm run build
```

The built entrypoint is `dist/index.js`.

## Configuration

The server reads configuration from environment variables. This package does **not** load a `.env` file automatically — export the variables in your shell, process manager, or MCP client's `env` block.

| Variable | Description |
|----------|-------------|
| `ALEPH_BASE_URL` | Origin of your OpenAleph instance (e.g. `https://aleph.example.org`). **Preferred** if set. |
| `OPAL_HOST` | Same role as `ALEPH_BASE_URL` if the latter is unset. Path components are ignored; only the origin is used. |
| `ALEPH_API_KEY` | API key. **Preferred** if set. |
| `OPAL_API_KEY` | Used if `ALEPH_API_KEY` is unset. |
| `ALEPH_REQUEST_TIMEOUT_MS` | Optional. Request timeout in milliseconds (default `60000`, clamped between `1000` and `600000`). |
| `ALEPH_SESSION_ID` | Optional. Sent as `X-Aleph-Session`; defaults to a random UUID per process. |

**Precedence:** `ALEPH_BASE_URL` over `OPAL_HOST`; `ALEPH_API_KEY` over `OPAL_API_KEY`.

**Authentication:** Requests use `Authorization: ApiKey <your_key>`, consistent with the [openaleph-client](https://github.com/dataresearchcenter/opal-client) library.

## Run locally

From an npm install:

```bash
export ALEPH_BASE_URL=https://your-instance.example.org
export ALEPH_API_KEY=your_key
npx -y barracuda-mcp
```

From source:

```bash
export ALEPH_BASE_URL=https://your-instance.example.org
export ALEPH_API_KEY=your_key
npm start
```

The server speaks MCP over **stdio** (stdin/stdout). Do not run it in a terminal you expect to use interactively for other output.

## MCP client setup

### LM Studio (recommended)

The easiest way to get started: click the **Add to LM Studio** button at the top of this README for one-click install.

After clicking, open **LM Studio → Program → MCP** and replace the placeholder `ALEPH_BASE_URL` and `ALEPH_API_KEY` values with your own.

To add it manually instead:

```json
{
  "mcpServers": {
    "barracuda-mcp": {
      "command": "npx",
      "args": ["-y", "barracuda-mcp"],
      "env": {
        "ALEPH_BASE_URL": "https://your-instance.example.org",
        "ALEPH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

See the [LM Studio MCP docs](https://lmstudio.ai/docs/app/mcp) for more.

### Cursor

Add a server entry in **Cursor Settings → MCP**:

```json
{
  "mcpServers": {
    "openaleph": {
      "command": "npx",
      "args": ["-y", "barracuda-mcp"],
      "env": {
        "ALEPH_BASE_URL": "https://your-instance.example.org",
        "ALEPH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Cursor from a local source build

If you've cloned and built from source, point Cursor at the built JS:

```json
{
  "mcpServers": {
    "openaleph": {
      "command": "node",
      "args": ["/absolute/path/to/barracuda-mcp/dist/index.js"],
      "env": {
        "ALEPH_BASE_URL": "https://your-instance.example.org",
        "ALEPH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

For development without running `npm run build`, you can use `tsx`:

```json
{
  "mcpServers": {
    "openaleph-dev": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/barracuda-mcp/src/index.ts"],
      "env": {
        "ALEPH_BASE_URL": "https://your-instance.example.org",
        "ALEPH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Claude Desktop / other stdio MCP clients

Any MCP client that supports stdio works — use the same `command` / `args` / `env` shape as above.

## Tool: `aleph_search`

Searches OpenAleph using the same query model as the REST API (Elasticsearch-style `q`, pagination, facets, and `filter:*` parameters). The tool does **not** add default `schemata` filters unless you pass `schema` or `schemata`.

| Argument | Type | Description |
|----------|------|-------------|
| `q` | string (required) | Search query (e.g. plain text or `field:value`). |
| `limit` | number (optional) | Page size, max **10000** (server-enforced cap). |
| `offset` | number (optional) | Results to skip. |
| `collectionId` | string (optional) | Sets `filter:collection_id`. |
| `facets` | string[] (optional) | Repeated `facet` query params (e.g. `languages`, `countries`). |
| `extraFilters` | object (optional) | Map of filter name → value; each becomes `filter:{name}`. |
| `schema` | string \| string[] (optional) | Exact-schema filter. A single value becomes `filter:schema=X`. An **array** (`["Email","Pages"]`) or **comma/space-separated string** (`"Email,Pages"`) is OR-merged into **`q`** as `(schema:A OR schema:B)` because `filter:schema` only accepts one value. |
| `schemata` | string \| string[] (optional) | Schema-with-descendants filter. Single / array / comma-separated are all accepted. Appends `schemata:X` (or `(schemata:A OR schemata:B …)`) to **`q`** — never sent as `filter:schemata`, which errors on some servers. |
| `highlight` | boolean (optional) | Sends `highlight=true` / `false` to OpenAleph (Elasticsearch match snippets). Default: **`true`**. |
| `highlightCount` | number (optional) | `highlight_count` — max fragments per hit (server default often **3**). |
| `highlightLength` | number (optional) | `highlight_length` — fragment size in characters. |
| `responseMode` | `"structured" \| "raw"` (optional) | Output mode. Default: `structured`. |
| `includeRaw` | boolean (optional) | In `structured` mode, wrap as `{ "results": [...], "raw": … }` (search) or `{ "result": {...}, "raw": … }` (get entity). Default: `false`. |
| `includeContentFields` | boolean (optional) | Include heavy content fields (`bodyHtml`, `bodyText`, `translatedText`). Default: `false`. |
| `contentPreviewChars` | number (optional) | When `> 0`, caps **Email** `bodyMarkdown` (after HTML→Markdown) or **Pages** `bodyText` (plain; overrides `bodyMarkdownMaxChars`). Default: `0`. |
| `bodyMarkdownMaxChars` | number (optional) | When `contentPreviewChars` is `0`, max length of **Email** `bodyMarkdown` or **Pages** `bodyText` (same boundary-aware truncation). Default: **200** (short for search context). |
| `maxArrayValuesPerField` | number (optional) | Max values returned per field in structured mode. Default: `20`. |

Successful responses return **JSON text** (pretty-printed). In default `structured` mode, the tool returns a **compact JSON array of hits** (no Aleph `status` / `total` wrapper) to keep LLM context small.

### Structured output shape (default)

The root value is a **JSON array** of slim hit objects:

```json
[
  {
    "schema": "Email",
    "properties": {
      "subject": ["FW: Donald Trump"],
      "peopleMentioned": ["jane french", "frank kuhnke"]
    },
    "dataset": "collection-id-or-null",
    "score": null,
    "id": "entity-id",
    "link": "https://your-instance.example.org/entities/entity-id"
  }
]
```

Each hit includes:

- **`schema`**, **`properties`**, **`dataset`** (from `dataset` on the entity if present, else `collection_id` / `collection.id`), **`score`** (from `score` / `_score` when present, else `null`), **`id`**, **`link`** (only `links.ui` from Aleph; other link relations are omitted). Search responses may also include **`highlight`** (array of HTML snippet strings from Elasticsearch when `highlight=true` in the API)—passed through on each slim hit so you can see query terms in context when **`bodyText`** / **`bodyMarkdown`** is truncated.
- **`properties`** drops `processingAgent` and `processingStatus`; compresses **`parent`** and **`ancestors`** to `{ schema, caption, id }`; compresses **`recipients`** to `{ schema, id, name?, email? }` with `name` / `email` lifted from nested FtM properties. For **`schema: "Email"`** (case-insensitive), when **`includeContentFields`** is `false`, **`bodyHtml`** is **preprocessed** (strip `<!-- … -->` comments, `<style>`, `<script>`, `<head>`, etc.—Outlook/Word often wraps CSS in comments so Turndown would otherwise emit that as “Markdown”), then converted with [Turndown](https://github.com/mixmark-io/turndown); the Markdown is shortened after conversion, preferring cuts at paragraph breaks (`\n\n`), then line breaks, then spaces. Very large HTML is trimmed at a safe tag boundary **before** Turndown only as a safety cap. If Aleph also sends **`bodyMarkdown`**, it is **not** passed through when **`bodyHtml`** is present (it often duplicates HTML). For **`schema: "Pages"`**, when **`includeContentFields`** is `false`, plain **`bodyText`** is returned (normalized line endings) with the **same** boundary-aware shortening (not HTML/Markdown conversion). Use **`contentPreviewChars`** when `> 0`, otherwise **`bodyMarkdownMaxChars`** (search default **200**, get-entity default **6000**). When **`bodyMarkdown`** (Email) or truncated **`bodyText`** (Pages) is present, the slim hit also includes **`truncatedBody`**, **`bodyMarkdownFullChars`** (full length before the response cap—applies to Pages plain text too), and **`bodyMarkdownReturnedChars`**. Other heavy fields still follow the usual omit/preview rules. Remaining keys follow the same array-cap rules (`maxArrayValuesPerField`).
- **`id`** is the canonical OpenAleph entity id. If the API omits top-level `id`, it is **parsed from `links.self`** (or `links.ui`).

**Page / Pages body text (Aleph / FollowTheMoney):** **`Page`** is a per-page shard (often filtered with `properties.document` + `properties.index`); **`Pages`** is the multi-page file. In [Aleph’s entity index](https://github.com/alephdata/aleph), extracted text is often stored as **`indexText`** and folded into Elasticsearch’s internal `text` field; that aggregate field is **not** stored in `_source`, and **`properties.bodyText`** may be empty even when search matches. This MCP treats **`Page`** and **`Pages`** the same for body text: it builds truncated **`properties.bodyText`** from, in order: **`bodyText`**, **`indexText`**, **`rawText`**, then (search only) joined **`highlight`** snippets. When the content came from **`highlight`**, the slim hit includes **`bodyTextFromSearchHighlight`: true** (preview snippets, not the full file). Use **`aleph_get_entity`** or **`aleph_get_entity_markdown`** when you need full text and the entity has **`bodyText`** / **`indexText`** in the API response.

With **`includeRaw: true`**, structured mode returns `{ "results": [ … ], "raw": <original Aleph search JSON> }` so the slim array and the full API body can both be inspected.

Use `responseMode: "raw"` to receive the unmodified Aleph JSON payload (including `status`, `total`, and full `links`).

Errors use MCP `isError` with status and body when available.

## Tool: `aleph_get_entity`

Fetches **one entity by id** using OpenAleph `GET /api/2/entities/:id`. Use this when you already have an entity id (from `aleph_search`, the web UI, or exports)—including **documents**, **emails**, **people**, and other FtM schemata.

| Argument | Type | Description |
|----------|------|-------------|
| `id` | string (required) | Entity id (URL-encoded on the wire if it contains special characters). |
| `responseMode` | `"structured" \| "raw"` (optional) | Default: `structured` (same shaping as search). |
| `includeRaw` | boolean (optional) | Include Aleph’s JSON under `raw` in structured mode. Default: `false`. |
| `includeContentFields` | boolean (optional) | Include heavy fields (`bodyHtml`, `bodyText`, …). Default: `false`. |
| `contentPreviewChars` | number (optional) | When `> 0`, caps **Email** `bodyMarkdown` or **Pages** `bodyText` (overrides `bodyMarkdownMaxChars`). Default: `0`. |
| `bodyMarkdownMaxChars` | number (optional) | When `contentPreviewChars` is `0`, max length of **Email** `bodyMarkdown` or **Pages** `bodyText`. Default: **6000** (longer than search for reading one entity). |
| `maxArrayValuesPerField` | number (optional) | Cap per field. Default: `20`. |

### Structured output shape (default)

The root value is a **single slim entity object**—the same shape as one element of the `aleph_search` array:

```json
{
  "schema": "Pages",
  "properties": {
    "title": ["…"],
    "fileName": ["…"]
  },
  "dataset": "collection-id-or-null",
  "score": null,
  "id": "your-entity-id",
  "link": "https://your-instance.example.org/entities/your-entity-id"
}
```

With **`includeRaw: true`**, structured mode returns `{ "result": { … }, "raw": <original Aleph entity JSON> }`.

Set `includeContentFields: true` when you need full document or email body text.

## Tool: `aleph_get_entity_markdown`

Fetches **one entity by id** (`GET /api/2/entities/:id`) and returns **full** body text (same source as structured mode, but **no** length cap on the returned string except the internal safety limit on huge inputs). **Email:** **`bodyMarkdown`** (HTML→Markdown from **`bodyHtml`**). **Pages:** plain **`bodyText`**. Use this when **`truncatedBody`** is `true` on search/get-entity output or you need the complete text.

| Argument | Type | Description |
|----------|------|-------------|
| `id` | string (required) | Entity id (**Email** with usable **`bodyHtml`**, or **Pages** with **`bodyText`**). |
| `includeRaw` | boolean (optional) | Include Aleph’s JSON under `raw`. Default: `false`. |

Successful responses are JSON with **`id`**, **`schema`**, and either Email fields (**`bodyMarkdown`**, **`bodyMarkdownFullChars`**, **`htmlSourceTruncated`**) or Pages fields (**`bodyText`**, **`bodyTextFullChars`**, **`htmlSourceTruncated`**). If there is no usable body, the tool returns MCP **`isError: true`** with an explanatory message that lists which property keys **were** present on the parent and the exact child-pages query that was tried — helpful for telling ingest gaps apart from access-scope problems.

### Pages: automatic child-page aggregation

OpenAleph’s `/api/2/entities/:id` handler for a single entity sets `excludes = ["text", "numeric.*"]`, so the parent of a paginated `Pages` document almost always has an empty `properties.bodyText`. FollowTheMoney keeps per-page text on child `Page` entities (`Page:bodyText`, `Page:index`, `Page:document → <parent_id>`).

When the parent has no own `bodyText` / `indexText` / `rawText`, this tool transparently issues:

```text
GET /api/2/search?q=*&filter:schema=Page&filter:properties.document=<id>&limit=500
```

sorts the returned children by `properties.index`, and concatenates their `bodyText` (falling back to `indexText` / `rawText` per child). When that path is taken the response adds:

- **`bodyTextFromChildren`**: `true`
- **`childPageCount`**: number of pages concatenated

HTTP filters are used (not a Lucene `q:` clause) because `properties.document` is analyzed/tokenized — phrase-matching the dotted child id against it does **not** work; exact filter-term matching does.

### API references

- [OpenAleph API layer (DeepWiki)](https://deepwiki.com/openaleph/openaleph/3.3-api-layer)
- [MCP specification](https://modelcontextprotocol.io)

## Security notes

- Treat the API key like a password: use Cursor `env` or your OS secret store; avoid committing keys.
- Stdio MCP assumes the client (Cursor) is trusted; do not expose this process to untrusted callers.

## Troubleshooting

- **500 on search with `schemata`:** Older setups used `filter:schemata`; this MCP now adds **`schemata:YourSchema` inside `q`** instead (same idea as [Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/)). Ensure the schema name exists in your FtM model (e.g. `Pages`, `Person`, `Email`).
- **"No results" when searching multiple schemata:** Don't pass `"Email,Pages"` expecting it to match as a single schema — there is no such schema. Use the supported forms: `"schemata": ["Email","Pages"]` or `"schemata": "Email,Pages"` / `"Email Pages"`; both are OR-merged into `q` as `(schemata:Email OR schemata:Pages)`.
- **Empty `bodyText` on a `Pages` entity from `aleph_get_entity`:** Expected — OpenAleph's `/api/2/entities/:id` handler uses `excludes = ["text", "numeric.*"]`, so the indexed text is stripped from the single-entity response. Call **`aleph_get_entity_markdown`** instead; it automatically aggregates the child `Page` entities (`filter:schema=Page&filter:properties.document=<id>`) and sets `bodyTextFromChildren: true` + `childPageCount` on the response. If *that* also comes back empty, the error lists which property keys were present on the parent and the exact child query that was tried — useful for distinguishing an ingest/OCR gap from an access-scope problem on the child pages' collection.
- **401 / 403:** Invalid or expired API key, or role cannot browse/search the requested data.
- **408 from tool:** Request timed out; increase `ALEPH_REQUEST_TIMEOUT_MS` or narrow the query.
- **URL issues:** Only the **origin** of `ALEPH_BASE_URL` / `OPAL_HOST` is used; trailing paths are stripped.

## Development

```bash
npm test           # unit tests (vitest)
npm run lint       # eslint + typescript-eslint
npm run build      # type-check + emit to dist/
```

### End-to-end (real OpenAleph)

All e2e commands load [`.env`](.env.example) via `test/e2e/setup-env.ts`.

| Command | What it does |
|---------|--------------|
| `npm run test:e2e` | Runs **all** e2e tests — includes the full search flow (and the targeted entity test when `ALEPH_E2E_ENTITY_ID` is set). |
| `npm run test:e2e:entity` | Runs **only** the targeted entity test (`test/e2e/aleph-entity.e2e.test.ts`); skips cleanly when `ALEPH_E2E_ENTITY_ID` is unset. |
| `npm run e2e:entity -- <id>` | Standalone CLI: fetches one entity by id via `aleph_get_entity` and `aleph_get_entity_markdown`, printing JSON to stdout. Flags: `--raw`, `--markdown` / `--no-markdown`, `-h`. Id on the CLI wins over `ALEPH_E2E_ENTITY_ID`. |

#### Search tuning — `ALEPH_E2E_SEARCH_*`

Control the **HTTP query** issued to `/api/2/search`:

- **`ALEPH_E2E_SEARCH_Q`** (default `test`), **`ALEPH_E2E_SEARCH_LIMIT`** (default `5`), **`ALEPH_E2E_SEARCH_OFFSET`**, **`ALEPH_E2E_SEARCH_COLLECTION_ID`**
- **`ALEPH_E2E_SEARCH_SCHEMA`** / **`ALEPH_E2E_SEARCH_SCHEMATA`** (single name, or comma/space-separated list — OR-combined)
- **`ALEPH_E2E_SEARCH_FACETS`** (comma list), **`ALEPH_E2E_SEARCH_EXTRA_FILTERS`** (JSON object for additional `filter:*` pairs)
- **`ALEPH_E2E_SEARCH_HIGHLIGHT`** (`true`/`false`, default `true`), **`ALEPH_E2E_SEARCH_HIGHLIGHT_COUNT`**, **`ALEPH_E2E_SEARCH_HIGHLIGHT_LENGTH`**
- **`ALEPH_E2E_FETCH_TOP_N`** (default `2`, max `50`) — after search, `GET /api/2/entities/:id` for this many hits so logs include both search and per-entity responses

Control the **structured-response shaping** of `runAlephSearchTool` (applied in addition to the raw `client.search` call, so the log has both):

- **`ALEPH_E2E_SEARCH_RESPONSE_MODE`** (`structured` | `raw`)
- **`ALEPH_E2E_SEARCH_INCLUDE_RAW`**, **`ALEPH_E2E_SEARCH_INCLUDE_CONTENT_FIELDS`**
- **`ALEPH_E2E_SEARCH_CONTENT_PREVIEW_CHARS`**, **`ALEPH_E2E_SEARCH_BODY_MARKDOWN_MAX_CHARS`**, **`ALEPH_E2E_SEARCH_MAX_ARRAY_VALUES_PER_FIELD`**

The e2e log header prints both the resolved search parameters and the shaping args actually applied.

#### Targeted entity — `ALEPH_E2E_ENTITY_*`

For reproducing a problem against **one specific document**:

- **`ALEPH_E2E_ENTITY_ID`** — required to enable `npm run test:e2e:entity`; ignored (overridden) if you pass an id to `npm run e2e:entity --`.
- **`ALEPH_E2E_ENTITY_FETCH_MARKDOWN`** (default `true`) — also run `aleph_get_entity_markdown` after `aleph_get_entity`.
- **`ALEPH_E2E_ENTITY_RESPONSE_MODE`**, **`ALEPH_E2E_ENTITY_INCLUDE_RAW`**, **`ALEPH_E2E_ENTITY_INCLUDE_CONTENT_FIELDS`**, **`ALEPH_E2E_ENTITY_CONTENT_PREVIEW_CHARS`**, **`ALEPH_E2E_ENTITY_BODY_MARKDOWN_MAX_CHARS`**, **`ALEPH_E2E_ENTITY_MAX_ARRAY_VALUES_PER_FIELD`** — same semantics as their `SEARCH_` counterparts, applied to the entity tool.

Example:

```bash
# Reproduce an issue against one document, including its full body text:
npm run e2e:entity -- 858652c8362c662b8a8f2506b27559e5ce2cb277.ec6b1042b7bd113518dd690a83b9c52655d277b5

# Or pin it in .env and run as a test:
ALEPH_E2E_ENTITY_ID=<id> npm run test:e2e:entity
```

**Privacy:** Log files under `logs/` can contain API responses with sensitive content. They are listed in [`.cursorignore`](.cursorignore); do not commit them or paste them into shared chats.

## Prompts for AI assistants

Ready-to-use system prompts (short, detailed, investigative, workflows, advanced search crib) live in **[`prompts/`](prompts/)**. Start at [`prompts/README.md`](prompts/README.md).

## License

MIT
