# MCP system prompts (OpenAleph / barracuda-mcp)

Use these as **Cursor Rules**, **project instructions**, or paste into a pinned chat. They assume the **barracuda-mcp** server is enabled with tools. **Convention:** use the **`Pages`** schema for **all document / file retrieval** in search (`schema` / `schemata` or inside **`q`**); do not assume `Document` unless the user’s instance explicitly uses it.

| Tool | Purpose |
|------|---------|
| `aleph_search` | Search the instance (`GET /api/2/search`). |
| `aleph_get_entity` | Load one entity by id (`GET /api/2/entities/:id`)—documents, emails, people, etc. |
| `aleph_get_entity_markdown` | Full untruncated body (Email: Markdown from `bodyHtml`; Pages: plain `bodyText`). |

## Files

| File | Use when |
|------|----------|
| [short.md](short.md) | Tight token budget; minimal behavior. |
| [detailed.md](detailed.md) | Default assistant behavior; full tool + output semantics. |
| [master.md](master.md) | **Single paste:** both tools + condensed advanced search + workflow. |
| [investigative-journalism.md](investigative-journalism.md) | Newsroom / investigative workflows, verification, sensitivity. |
| [casefile-workflows.md](casefile-workflows.md) | Scenario prompts: follow-the-money, POI, leaks triage, timelines. |
| [advanced-openaleph-search.md](advanced-openaleph-search.md) | Crib sheet: phrases, operators, `properties.*`, schema filters (from [OpenAleph Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/)). |

## Official search docs

- [Basic Search](https://openaleph.org/docs/user-guide/101/basic-search/)
- [Advanced Search](https://openaleph.org/docs/user-guide/102/advanced-search/)
