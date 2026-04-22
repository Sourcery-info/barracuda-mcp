import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AlephClient } from "../aleph/client.js";
import { AlephHttpError } from "../aleph/client.js";
import {
  getCanonicalEntityId,
  getEmailBodyMarkdownUntruncated,
  getPagesBodyTextWithChildren,
  parseSearchResults,
  type PagesChildrenFetcher,
  type RawEntity,
} from "./formatAlephResponse.js";

/** Upper bound on pages fetched when a `Pages` parent has no own body text. */
const MAX_CHILD_PAGES_TO_FETCH = 500;

/**
 * Build a {@link PagesChildrenFetcher} backed by the Aleph search API. Child
 * `Page` entities for a `Pages` parent are found via the exact HTTP filters
 * OpenAleph uses in its own UI:
 *
 *   `filter:schema=Page` + `filter:properties.document=<parent_id>`
 *
 * We deliberately **do not** put the id in a Lucene `q` clause because the
 * indexed `properties.document` field is analyzed/tokenized; the dotted id
 * `<hash>.<hash>` will not phrase-match. HTTP filters do an exact term match
 * against the stored keyword value and match reliably.
 */
function makeChildrenFetcher(
  client: Pick<AlephClient, "search">
): PagesChildrenFetcher {
  return async (pagesId) => {
    const data = await client.search({
      // OpenAleph accepts an empty/wildcard q when filters carry the selection.
      q: "*",
      schema: "Page",
      extraFilters: {
        "properties.document": pagesId,
      },
      limit: MAX_CHILD_PAGES_TO_FETCH,
      highlight: false,
    });
    return parseSearchResults(data);
  };
}

/**
 * Return a short, stable diagnostic summary of property keys present on the
 * entity (truncated) — used in the error when no body text is found so the
 * caller can see what OpenAleph actually returned.
 */
function summarizePropertyKeys(entity: RawEntity): string {
  const props =
    entity.properties && typeof entity.properties === "object"
      ? (entity.properties as Record<string, unknown>)
      : {};
  const keys = Object.keys(props).filter((k) => {
    const v = props[k];
    if (v === null || v === undefined) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (keys.length === 0) return "(no non-empty properties)";
  const MAX_KEYS = 20;
  const head = keys.slice(0, MAX_KEYS).join(", ");
  return keys.length > MAX_KEYS
    ? `${head}, … (+${keys.length - MAX_KEYS} more)`
    : head;
}

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
  client: Pick<AlephClient, "getEntity" | "search">,
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
    const pagesOut = emailOut
      ? null
      : await getPagesBodyTextWithChildren(entity, makeChildrenFetcher(client));
    if (!emailOut && !pagesOut) {
      const sch = typeof entity.schema === "string" ? entity.schema : "unknown";
      const resolvedId = getCanonicalEntityId(entity) ?? id;
      const presentKeys = summarizePropertyKeys(entity);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `No body text available for id ${resolvedId} (schema: ${sch}). ` +
              `Entity properties present: ${presentKeys}. ` +
              `For Email, properties.bodyHtml must convert to non-empty Markdown. ` +
              `For Pages, provide non-empty properties.bodyText, indexText, or rawText — ` +
              `OpenAleph also stores per-page text on child Page entities, which this tool fetches ` +
              `via filter:schema=Page&filter:properties.document=${resolvedId}; that query returned ` +
              `no usable bodyText either.`,
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
      payload.bodyTextFromChildren = pagesOut.sourcedFromChildren;
      if (pagesOut.pageCount !== null) {
        payload.childPageCount = pagesOut.pageCount;
      }
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
