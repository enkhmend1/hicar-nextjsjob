/**
 * Data-platform HTTP API entrypoint (standalone process).
 *
 * Shares MongoDB + Redis with the legacy backend but runs as its own process
 * on DP_PORT — a bounded context. Run with `npm run dp:server`.
 */

import "dotenv/config";

import express from "express";
import helmet from "helmet";
import { env } from "./shared/env.js";
import { logger } from "./shared/logger.js";
import { connectMongo } from "./shared/mongo.js";
import { v1Router } from "./api/v1.router.js";
import { errorHandler } from "./api/errorHandler.js";

async function main(): Promise<void> {
  await connectMongo();

  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "hicar-data-platform", ts: new Date().toISOString() });
  });

  app.use("/api/v1", v1Router);
  app.use(errorHandler);

  app.listen(env.port, () => logger.info("dp.api.listening", { port: env.port }));
}

main().catch((err) => {
  logger.error("dp.api.boot_failed", { err: (err as Error).message });
  process.exit(1);
});
