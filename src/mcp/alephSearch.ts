import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AlephClient } from "../aleph/client.js";
import { AlephHttpError } from "../aleph/client.js";
import {
  formatAlephStructuredResponse,
  SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
} from "./formatAlephResponse.js";

export const alephSearchInputSchema = z.object({
  q: z
    .string()
    .min(1)
    .describe(
      "Search query in Elasticsearch syntax (e.g. plain terms or field:value)."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .optional()
    .describe("Max results (1–10000)."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Results to skip for pagination."),
  collectionId: z
    .string()
    .optional()
    .describe("Restrict to a collection (sets filter:collection_id)."),
  facets: z
    .array(z.string())
    .optional()
    .describe(
      "Facet field names to include (e.g. languages, countries, mime_type)."
    ),
  extraFilters: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Additional filters as key/value; each becomes filter:{key}=value (e.g. countries, mime_type)."
    ),
  schema: z
    .string()
    .optional()
    .describe("Single schema filter (filter:schema)."),
  schemata: z
    .string()
    .optional()
    .describe(
      "Restrict to this schema and its FtM descendants via `schemata:Name` merged into `q` (avoids brittle filter:schemata on some servers)."
    ),
  highlight: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Request Elasticsearch highlight fragments (`highlight=true`). Structured hits include a top-level `highlight` array when the API returns it."
    ),
  highlightCount: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max highlight snippets per hit (`highlight_count`)."),
  highlightLength: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .optional()
    .describe("Character length of each fragment (`highlight_length`)."),
  responseMode: z
    .enum(["structured", "raw"])
    .optional()
    .default("structured")
    .describe("Response mode. Default is structured."),
  includeRaw: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include unmodified Aleph response in structured mode."),
  includeContentFields: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include heavy text fields like bodyHtml/bodyText."),
  contentPreviewChars: z
    .number()
    .int()
    .min(0)
    .max(50_000)
    .optional()
    .default(0)
    .describe(
      "When > 0, caps Email bodyMarkdown length after HTML→Markdown (overrides bodyMarkdownMaxChars)."
    ),
  bodyMarkdownMaxChars: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .optional()
    .default(SEARCH_DEFAULT_BODY_MARKDOWN_MAX_CHARS)
    .describe(
      "When contentPreviewChars is 0, max length for Email bodyMarkdown (search default is short to save context)."
    ),
  maxArrayValuesPerField: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(20)
    .describe("Max values returned per property field."),
});

export type AlephSearchArgs = z.infer<typeof alephSearchInputSchema>;

function formatAlephError(err: AlephHttpError): string {
  const body =
    err.body !== null && err.body !== undefined
      ? JSON.stringify(err.body)
      : "";
  return body ? `HTTP ${err.status}: ${err.message}\n${body}`
    : `HTTP ${err.status}: ${err.message}`;
}

export async function runAlephSearchTool(
  client: Pick<AlephClient, "search">,
  rawArgs: unknown
): Promise<CallToolResult> {
  const parsed = alephSearchInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Invalid arguments: ${parsed.error.message}`,
        },
      ],
    };
  }
  const args = parsed.data;

  try {
    const data = await client.search({
      q: args.q,
      limit: args.limit,
      offset: args.offset,
      collectionId: args.collectionId,
      facets: args.facets,
      extraFilters: args.extraFilters,
      schema: args.schema,
      schemata: args.schemata,
      highlight: args.highlight,
      highlightCount: args.highlightCount,
      highlightLength: args.highlightLength,
    });
    const filtersApplied: Record<string, unknown> = {
      collectionId: args.collectionId ?? null,
      facets: args.facets ?? [],
      extraFilters: args.extraFilters ?? {},
      schema: args.schema ?? null,
      schemata: args.schemata ?? null,
      highlight: args.highlight,
      highlightCount: args.highlightCount ?? null,
      highlightLength: args.highlightLength ?? null,
    };
    const responsePayload =
      args.responseMode === "raw"
        ? data
        : formatAlephStructuredResponse(data, {
            query: args.q,
            filtersApplied,
            includeRaw: args.includeRaw,
            includeContentFields: args.includeContentFields,
            contentPreviewChars: args.contentPreviewChars,
            maxArrayValuesPerField: args.maxArrayValuesPerField,
            bodyMarkdownMaxChars: args.bodyMarkdownMaxChars,
          });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
    };
  } catch (e) {
    if (e instanceof AlephHttpError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAlephError(e),
          },
        ],
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unexpected error: ${message}`,
        },
      ],
    };
  }
}
