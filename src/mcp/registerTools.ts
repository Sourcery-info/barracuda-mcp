import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AlephClient } from "../aleph/client.js";
import type { AppConfig } from "../config.js";
import type { DuckDbManager } from "../duckdb/manager.js";
import {
  alephGetEntityMarkdownInputSchema,
  runAlephGetEntityMarkdownTool,
} from "./alephGetEntityMarkdown.js";
import { alephGetEntityInputSchema, runAlephGetEntityTool } from "./alephGetEntity.js";
import { alephLoadCsvInputSchema, runAlephLoadCsvTool } from "./alephLoadCsv.js";
import { alephSearchInputSchema, runAlephSearchTool } from "./alephSearch.js";
import { duckdbListTablesInputSchema, runDuckDbListTablesTool } from "./duckdbListTables.js";
import { duckdbQueryInputSchema, runDuckDbQueryTool } from "./duckdbQuery.js";

const searchShape = alephSearchInputSchema.shape;
const getEntityShape = alephGetEntityInputSchema.shape;
const getEntityMarkdownShape = alephGetEntityMarkdownInputSchema.shape;
const loadCsvShape = alephLoadCsvInputSchema.shape;
const duckdbQueryShape = duckdbQueryInputSchema.shape;
const duckdbListTablesShape = duckdbListTablesInputSchema.shape;

export function registerAlephTools(
  server: McpServer,
  client: AlephClient,
  duckdb: DuckDbManager,
  config: AppConfig
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

  server.registerTool(
    "aleph_load_csv",
    {
      title: "OpenAleph load CSV into DuckDB",
      description:
        "Load a tabular OpenAleph entity (schema Table, CSV, or Workbook) into an in-memory DuckDB table for SQL analysis. " +
        "Downloads the source file via the archive API when available (links.csv/links.file); otherwise reconstructs rows from child Row entities. " +
        "Call this first, then analyze the data with duckdb_query (tables persist for the life of the server; cross-table JOINs work). " +
        "Returns the table name, row count, column names/types, and sample rows.",
      inputSchema: loadCsvShape,
    },
    async (args) => runAlephLoadCsvTool(client, duckdb, config, args)
  );

  server.registerTool(
    "duckdb_query",
    {
      title: "DuckDB read-only SQL query",
      description:
        "Run one read-only SQL statement (SELECT, EXPLAIN, SHOW, DESCRIBE, PRAGMA) against the in-memory DuckDB instance holding tables loaded with aleph_load_csv. " +
        "INSERT/UPDATE/CREATE/COPY/ATTACH and multi-statement input are rejected. " +
        "Results are capped (maxRows, default 200) and long cell values are truncated. " +
        "Join multiple loaded tables with plain SQL.",
      inputSchema: duckdbQueryShape,
    },
    async (args) => runDuckDbQueryTool(duckdb, args)
  );

  server.registerTool(
    "duckdb_list_tables",
    {
      title: "DuckDB list loaded tables",
      description:
        "List the tables currently loaded in the in-memory DuckDB instance (from aleph_load_csv), with their source entity, row count, and columns. " +
        "Use this before duckdb_query to see which table names are available.",
      inputSchema: duckdbListTablesShape,
    },
    async (args) => runDuckDbListTablesTool(duckdb, args)
  );
}
