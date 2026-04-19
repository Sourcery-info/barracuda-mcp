import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AlephClient } from "../aleph/client.js";
import { AlephHttpError } from "../aleph/client.js";
import {
  ENTITY_DEFAULT_BODY_MARKDOWN_MAX_CHARS,
  formatEntityGetResponse,
} from "./formatAlephResponse.js";

export const alephGetEntityInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .describe(
      "OpenAleph entity id from search or the UI (documents, emails, people, and other entities share this endpoint)."
    ),
  responseMode: z
    .enum(["structured", "raw"])
    .optional()
    .default("structured")
    .describe("Response mode. Default is structured."),
  includeRaw: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include unmodified Aleph entity JSON in structured mode."),
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
    .default(ENTITY_DEFAULT_BODY_MARKDOWN_MAX_CHARS)
    .describe(
      "When contentPreviewChars is 0, max length for Email bodyMarkdown for a single entity (default is larger than search)."
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

export type AlephGetEntityArgs = z.infer<typeof alephGetEntityInputSchema>;

function formatAlephError(err: AlephHttpError): string {
  const body =
    err.body !== null && err.body !== undefined
      ? JSON.stringify(err.body)
      : "";
  return body ? `HTTP ${err.status}: ${err.message}\n${body}`
    : `HTTP ${err.status}: ${err.message}`;
}

export async function runAlephGetEntityTool(
  client: Pick<AlephClient, "getEntity">,
  rawArgs: unknown
): Promise<CallToolResult> {
  const parsed = alephGetEntityInputSchema.safeParse(rawArgs);
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
    const data = await client.getEntity(args.id);
    const filtersApplied = { id: args.id };
    const responsePayload =
      args.responseMode === "raw"
        ? data
        : formatEntityGetResponse(data, {
            entityId: args.id,
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
