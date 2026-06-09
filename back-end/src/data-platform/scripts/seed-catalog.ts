/**
 * Seed the starter canonical catalog + alias dictionary.
 * Run once before normalizing: `npm run dp:seed`.
 */

import "dotenv/config";

import { connectMongo, disconnectMongo } from "../shared/mongo.js";
import { seedCatalog } from "../modules/catalog/seed.js";
import { logger } from "../shared/logger.js";

async function main(): Promise<void> {
  await connectMongo();
  const result = await seedCatalog();
  logger.info("seed.catalog.done", result);
  await disconnectMongo();
}

main().catch((err) => {
  logger.error("seed.catalog.failed", { err: (err as Error).message });
  process.exit(1);
});
