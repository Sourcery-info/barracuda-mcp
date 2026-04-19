import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AlephClient } from "../aleph/client.js";
import {
  alephGetEntityMarkdownInputSchema,
  runAlephGetEntityMarkdownTool,
} from "./alephGetEntityMarkdown.js";
import { alephGetEntityInputSchema, runAlephGetEntityTool } from "./alephGetEntity.js";
import { alephSearchInputSchema, runAlephSearchTool } from "./alephSearch.js";

const searchShape = alephSearchInputSchema.shape;
const getEntityShape = alephGetEntityInputSchema.shape;
const getEntityMarkdownShape = alephGetEntityMarkdownInputSchema.shape;

export function registerAlephTools(
  server: McpServer,
  client: AlephClient
): void {
  server.registerTool(
    "aleph_search",
    {
      title: "OpenAleph search",
      description:
        "Search entities and documents in an OpenAleph instance via GET /api/2/search. " +
        "Uses the same query parameters as the official API (q, limit, offset, facet, filter:*). " +
        "Does not add default schemata filters unless you pass schema/schemata. " +
        "Returns a compact JSON array of hits by default (use responseMode=raw for full Aleph JSON). " +
        "Requests highlight=true by default; each hit may include a highlight array of match snippets.",
      inputSchema: searchShape,
    },
    async (args) => runAlephSearchTool(client, args)
  );

  server.registerTool(
    "aleph_get_entity",
    {
      title: "OpenAleph get entity",
      description:
        "Fetch a single entity by id via GET /api/2/entities/:id. " +
        "Use this to load a specific document, email, person, or other entity when you already have its id (e.g. from aleph_search). " +
        "Structured output matches aleph_search (use includeContentFields for full body text).",
      inputSchema: getEntityShape,
    },
    async (args) => runAlephGetEntityTool(client, args)
  );

  server.registerTool(
    "aleph_get_entity_markdown",
    {
      title: "OpenAleph get entity body Markdown (full)",
      description:
        "Fetch one entity by id and return full untruncated body text. " +
        "Email: HTML→Markdown in bodyMarkdown. Page/Pages: plain bodyText. " +
        "Use when structured output shows truncatedBody or you need the complete text. " +
        "See bodyMarkdownFullChars and htmlSourceTruncated in the JSON (latter is set when input was cut at the safety limit before conversion).",
      inputSchema: getEntityMarkdownShape,
    },
    async (args) => runAlephGetEntityMarkdownTool(client, args)
  );
}
