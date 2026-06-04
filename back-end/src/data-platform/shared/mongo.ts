/**
 * MongoDB connection for the data-platform process. Connects to the SAME
 * database as the legacy backend (shared MONGO_URI) — the new collections
 * (raw_products, normalized_products, …) live alongside the existing ones.
 */

import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

export async function connectMongo(): Promise<typeof mongoose> {
  if (!env.mongoUri) {
    throw new Error("MONGO_URI is not set — data platform cannot start");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  logger.info("mongo.connected", { host: mongoose.connection.host });
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info("mongo.disconnected");
}
