/**
 * Typesense client + collection lifecycle.
 *
 * Search is a CQRS READ model: MongoDB is the write source of truth, Typesense
 * is derived and disposable (rebuildable via `dp:reindex`). Like the AI layer,
 * everything here degrades gracefully — no API key ⇒ client is null and every
 * caller no-ops, so the platform runs fine without search.
 */

import { Client } from "typesense";
import { env } from "../../shared/env.js";
import { logger } from "../../shared/logger.js";

let client: Client | null = null;
let initialized = false;

export function getTypesense(): Client | null {
  if (initialized) return client;
  initialized = true;
  if (!env.searchEnabled) {
    logger.info("search.disabled", { reason: "TYPESENSE_API_KEY not set" });
    return null;
  }
  try {
    client = new Client({
      nodes: [{ host: env.typesenseHost, port: env.typesensePort, protocol: env.typesenseProtocol }],
      apiKey: env.typesenseApiKey,
      connectionTimeoutSeconds: 5,
    });
    logger.info("search.enabled", { host: env.typesenseHost, collection: env.typesenseCollection });
  } catch (err) {
    logger.error("search.init_failed", { err: (err as Error).message });
    client = null;
  }
  return client;
}

export function searchEnabled(): boolean {
  return env.searchEnabled && getTypesense() !== null;
}

/**
 * Idempotently ensure the listings collection exists. Safe to call on every
 * worker boot; a 409/existing collection is treated as success.
 */
export async function ensureCollection(): Promise<void> {
  const c = getTypesense();
  if (!c) return;
  try {
    await c.collections(env.typesenseCollection).retrieve();
    return; // already exists
  } catch {
    // not found → create below
  }
  try {
    await c.collections().create({
      name: env.typesenseCollection,
      fields: [
        { name: "rawProductId", type: "string" },
        { name: "normalizedProductId", type: "string" },
        { name: "sellerId", type: "string", facet: true },
        { name: "title", type: "string" },
        { name: "titleCyrillic", type: "string", optional: true },
        { name: "titleLatin", type: "string", optional: true },
        { name: "canonicalPartName", type: "string", facet: true, optional: true },
        { name: "aliasText", type: "string", optional: true },
        { name: "brand", type: "string", facet: true, optional: true },
        { name: "model", type: "string", facet: true, optional: true },
        { name: "generation", type: "string", facet: true, optional: true },
        { name: "oem", type: "string", optional: true },
        { name: "price", type: "int32", optional: true },
        { name: "inStock", type: "bool", optional: true },
        { name: "thumbnailUrl", type: "string", optional: true },
        { name: "confidence", type: "float" },
        { name: "status", type: "string", facet: true },
        { name: "createdAt", type: "int64" },
      ],
      default_sorting_field: "createdAt",
    });
    logger.info("search.collection.created", { collection: env.typesenseCollection });
  } catch (err) {
    logger.error("search.collection.create_failed", { err: (err as Error).message });
  }
}
