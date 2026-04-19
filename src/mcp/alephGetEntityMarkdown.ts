import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AlephClient } from "../aleph/client.js";
import { AlephHttpError } from "../aleph/client.js";
import {
  getCanonicalEntityId,
  getEmailBodyMarkdownUntruncated,
  getPagesBodyTextUntruncated,
  type RawEntity,
} from "./formatAlephResponse.js";

export const alephGetEntityMarkdownInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .describe(
      "OpenAleph entity id. Email: properties.bodyHtml → Markdown. Page/Pages: plain bodyText (or indexText, rawText)."
    ),
  includeRaw: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include the raw Aleph entity JSON in the response."),
});

function formatAlephError(err: AlephHttpError): string {
  const body =
    err.body !== null && err.body !== undefined
      ? JSON.stringify(err.body)
      : "";
  return body ? `HTTP ${err.status}: ${err.message}\n${body}`
    : `HTTP ${err.status}: ${err.message}`;
}

export async function runAlephGetEntityMarkdownTool(
  client: Pick<AlephClient, "getEntity">,
  rawArgs: unknown
): Promise<CallToolResult> {
  const parsed = alephGetEntityMarkdownInputSchema.safeParse(rawArgs);
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
  const { id, includeRaw } = parsed.data;

  try {
    const data = await client.getEntity(id);
    if (!data || typeof data !== "object") {
      return {
        isError: true,
        content: [{ type: "text", text: "Empty response from Aleph" }],
      };
    }
    const entity = data as RawEntity;
    const emailOut = getEmailBodyMarkdownUntruncated(entity);
    const pagesOut = getPagesBodyTextUntruncated(entity);
    if (!emailOut && !pagesOut) {
      const sch = typeof entity.schema === "string" ? entity.schema : "unknown";
      const resolvedId = getCanonicalEntityId(entity) ?? id;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `No body text available for id ${resolvedId} (schema: ${sch}). ` +
              `For Email, properties.bodyHtml must convert to non-empty Markdown. ` +
              `For Pages, provide non-empty properties.bodyText, indexText, or rawText (Aleph often stores extract text as indexText in the index).`,
          },
        ],
      };
    }
    const resolvedId = getCanonicalEntityId(entity) ?? id;
    const payload: Record<string, unknown> = {
      id: resolvedId,
      schema: entity.schema ?? null,
    };
    if (emailOut) {
      payload.bodyMarkdown = emailOut.markdown;
      payload.bodyMarkdownFullChars = emailOut.bodyMarkdownFullChars;
      payload.htmlSourceTruncated = emailOut.htmlSourceTruncated;
    } else if (pagesOut) {
      payload.bodyText = pagesOut.text;
      payload.bodyTextFullChars = pagesOut.bodyTextFullChars;
      payload.htmlSourceTruncated = pagesOut.htmlSourceTruncated;
    }
    if (includeRaw) payload.raw = data;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
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
