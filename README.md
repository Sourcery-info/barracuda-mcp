# barracuda-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **OpenAleph** entity and document search via the official HTTP API (`GET /api/2/search`). It is intended for use from **Cursor** (stdio transport) and other MCP clients.

## Requirements

- **Node.js 20+**
- An OpenAleph instance with a valid **API key** (see [OpenAleph Python guide](https://openaleph.org/docs/user-guide/104/python/) for `OPAL_HOST` / `OPAL_API_KEY` conventions)

## Install and build

```bash
npm ci
npm run build
```

The server entrypoint is `dist/index.js`.

## Configuration

Set environment variables (see [`.env.example`](.env.example)). You can load a `.env` file with your process manager or shell; this repo does not load `.env` automatically.

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

```bash
export ALEPH_BASE_URL=https://your-instance.example.org
export ALEPH_API_KEY=your_key
npm start
```

The server speaks MCP over **stdio** (stdin/stdout). Do not run it in a terminal you expect to use interactively for other output.

## Cursor MCP setup

Add a server entry to your Cursor MCP configuration (for example in **Cursor Settings → MCP**), pointing at the built JS and your environment:

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

For development without a prior `npm run build`, you can use `tsx`:

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
| `schema` | string (optional) | Sets `filter:schema`. |
| `schemata` | string (optional) | Appends `schemata:…` to **`q`** (and does not send `filter:schemata`), for compatibility with servers that error on the filter param. |
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
      "subject": ["RE: Q4 planning notes"],
      "peopleMentioned": ["pat example", "quinn example"]
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

Successful responses are JSON with **`id`**, **`schema`**, and either Email fields (**`bodyMarkdown`**, **`bodyMarkdownFullChars`**, **`htmlSourceTruncated`**) or Pages fields (**`bodyText`**, **`bodyTextFullChars`**, **`htmlSourceTruncated`**). If there is no usable body, the tool returns MCP **`isError: true`** with an explanatory message.

### API references

- [OpenAleph API layer (DeepWiki)](https://deepwiki.com/openaleph/openaleph/3.3-api-layer)
- [MCP specification](https://modelcontextprotocol.io)

## Security notes

- Treat the API key like a password: use Cursor `env` or your OS secret store; avoid committing keys.
- Stdio MCP assumes the client (Cursor) is trusted; do not expose this process to untrusted callers.

## Troubleshooting

- **500 on search with `schemata`:** Older setups used `filter:schemata`; this MCP now adds **`schemata:YourSchema` inside `q`** instead (same idea as [Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/)). Ensure the schema name exists in your FtM model (e.g. `Pages`, `Person`, `Email`).
- **401 / 403:** Invalid or expired API key, or role cannot browse/search the requested data.
- **408 from tool:** Request timed out; increase `ALEPH_REQUEST_TIMEOUT_MS` or narrow the query.
- **URL issues:** Only the **origin** of `ALEPH_BASE_URL` / `OPAL_HOST` is used; trailing paths are stripped.

## Development

```bash
npm test
npm run lint
```

### End-to-end search (real OpenAleph)

```bash
npm run test:e2e
```

Loads [`.env`](.env.example) via `test/e2e/setup-env.ts`. Set **`ALEPH_E2E_SEARCH_*`** variables (see [`.env.example`](.env.example)) to change **`q`**, **`limit`**, **`offset`**, **`collectionId`**, **`schema`**, **`schemata`**, **`facets`**, and optional **`ALEPH_E2E_SEARCH_EXTRA_FILTERS`** (JSON object for `filter:*` pairs). Set **`ALEPH_E2E_FETCH_TOP_N`** (default **2**, max **50**) to fetch that many search hits again via **`GET /api/2/entities/:id`** so logs include both search and per-entity responses. The e2e log header prints the resolved search parameters.

**Privacy:** Log files under `logs/` can contain API responses with sensitive content. They are listed in [`.cursorignore`](.cursorignore); do not commit them or paste them into shared chats.

## Prompts for AI assistants

Ready-to-use system prompts (short, detailed, investigative, workflows, advanced search crib) live in **[`prompts/`](prompts/)**. Start at [`prompts/README.md`](prompts/README.md).

## License

MIT
