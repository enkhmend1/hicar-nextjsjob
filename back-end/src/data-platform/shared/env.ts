/**
 * Typed configuration for the HiCar Data Platform.
 *
 * Reuses the SAME env vars as the legacy JS backend (MONGO_URI, REDIS_URL)
 * so both processes connect to the same datastores — the data platform is a
 * bounded context, not a separate database.
 */

export const env = {
  /** Shared MongoDB connection string (same as legacy backend). */
  mongoUri: process.env.MONGO_URI ?? "",
  /** Shared Redis URL — required for BullMQ queues. */
  redisUrl: process.env.REDIS_URL ?? "",
  /** Port for the standalone data-platform HTTP API. */
  port: Number(process.env.DP_PORT) || 5100,
  nodeEnv: process.env.NODE_ENV ?? "development",
  /** Hard ceiling on rows accepted from a single import file. */
  maxImportRows: Number(process.env.DP_MAX_IMPORT_ROWS) || 100_000,
  /** Max upload size for import files, in bytes (default 25 MB). */
  maxUploadBytes: Number(process.env.DP_MAX_UPLOAD_BYTES) || 25 * 1024 * 1024,
  /** Per-worker concurrency. */
  importConcurrency: Number(process.env.DP_IMPORT_CONCURRENCY) || 2,
  normalizeConcurrency: Number(process.env.DP_NORMALIZE_CONCURRENCY) || 6,

  // AI enrichment (M4) — migrated to Anthropic Claude (Haiku by default).
  // Enrichment is OFF unless ANTHROPIC_API_KEY is present (and can be
  // force-disabled with DP_AI_ENRICH=false). Shares timeout/retry tuning
  // with the legacy backend via the AI_REQUEST_* vars.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  dpAiModel: process.env.DP_AI_MODEL || "claude-3-5-haiku-latest",
  aiTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS) || 30_000,
  aiMaxRetries: Number(process.env.AI_REQUEST_MAX_RETRIES) || 4,
  aiEnrichEnabled: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.DP_AI_ENRICH !== "false",

  // Typesense search (M5). Disabled unless an API key is set — the indexer and
  // search API both no-op gracefully without it.
  typesenseHost: process.env.TYPESENSE_HOST || "localhost",
  typesensePort: Number(process.env.TYPESENSE_PORT) || 8108,
  typesenseProtocol: process.env.TYPESENSE_PROTOCOL || "http",
  typesenseApiKey: process.env.TYPESENSE_API_KEY ?? "",
  typesenseCollection: process.env.TYPESENSE_COLLECTION || "hicar_listings",
  searchEnabled: Boolean(process.env.TYPESENSE_API_KEY) && process.env.DP_SEARCH !== "false",

  // Cloudinary image storage. Shared with legacy backend (same env vars).
  // Disabled gracefully when any credential is absent.
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  cloudinaryEnabled: Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
  ),
} as const;

export const isProd = env.nodeEnv === "production";
