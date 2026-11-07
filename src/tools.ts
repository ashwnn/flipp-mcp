import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  getItem,
  getFlyerItems,
  getNearbyStores,
  listFlyers,
  listMerchants,
  searchItems,
} from "./lib/flipp.js";

const PostalCode = z
  .string()
  .trim()
  .regex(/^([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(-\d{4})?)$/i, 'Use CA "A1A1A1" or US ZIP "10001".');
const Locale = z.enum(["en", "fr"]).default("en");
const Limit = z.number().int().min(1).max(50).default(20);

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "search_items",
    {
      description: "Search flyer deals by keyword near a postal code (CA A1A1A1 or US ZIP).",
      inputSchema: z.object({ query: z.string().min(1), postal_code: PostalCode, locale: Locale, limit: Limit }),
    },
    async (a) => {
      try {
        return text(await searchItems(a));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_item",
    {
      description: "Get detail for one flyer item by id (from search_items).",
      inputSchema: z.object({ item_id: z.number().int().positive(), locale: Locale }),
    },
    async (a) => {
      try {
        return text(await getItem(a));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "list_flyers",
    {
      description: "List flyers near a postal code, optionally filtered by merchant.",
      inputSchema: z.object({
        postal_code: PostalCode,
        locale: Locale,
        merchant: z.string().trim().min(1).optional(),
        limit: Limit,
      }),
    },
    async (a) => {
      try {
        return text(await listFlyers(a));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_flyer_items",
    {
      description: "List items in one flyer, optionally filtered by keyword.",
      inputSchema: z.object({
        flyer_id: z.number().int().positive(),
        postal_code: PostalCode,
        locale: Locale,
        query: z.string().trim().min(1).optional(),
        limit: Limit,
      }),
    },
    async (a) => {
      try {
        return text(await getFlyerItems(a));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "list_merchants",
    {
      description: "List Flipp merchants/stores, optionally filtered by name.",
      inputSchema: z.object({ locale: Locale, query: z.string().trim().min(1).optional() }),
    },
    async (a) => {
      try {
        return text(await listMerchants(a.locale, a.query));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_nearby_stores",
    {
      description: "Stores near a postal code carrying a given flyer.",
      inputSchema: z.object({ flyer_id: z.number().int().positive(), postal_code: PostalCode, locale: Locale }),
    },
    async (a) => {
      try {
        return text(await getNearbyStores(a));
      } catch (e) {
        return err(e);
      }
    },
  );
}
