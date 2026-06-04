/**
 * Image pipeline: download external seller image URLs and mirror them into
 * Cloudinary. Returns the Cloudinary public IDs (not full URLs) so callers
 * can generate delivery-optimised URLs on demand via getOptimizedUrl.
 *
 * Design contracts:
 *   • best-effort — individual image failures are logged and skipped; they
 *     never throw or halt the normalization worker,
 *   • bounded — at most MAX_IMAGES_PER_PRODUCT images are mirrored per call,
 *   • graceful — returns [] immediately when Cloudinary is not configured.
 */

import { fetch } from "undici";
import { uploadImageStream, cloudinaryServiceEnabled } from "./cloudinary.service.js";
import { logger } from "../shared/logger.js";

const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB hard cap per image
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Download up to MAX_IMAGES_PER_PRODUCT URLs and upload each to Cloudinary.
 * Returns the list of Cloudinary public IDs that were successfully stored.
 */
export async function mirrorImagesToCloudinary(
  urls: string[],
  folderType: "raw" | "canonical",
  identifier: string,
): Promise<string[]> {
  if (!cloudinaryServiceEnabled() || urls.length === 0) return [];

  const publicIds: string[] = [];
  const batch = urls.slice(0, MAX_IMAGES_PER_PRODUCT);

  for (let i = 0; i < batch.length; i++) {
    const url = batch[i]!;
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) {
        logger.warn("image.fetch_bad_status", { url, status: resp.status });
        continue;
      }
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        logger.warn("image.not_image_content_type", { url, contentType });
        continue;
      }
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        logger.warn("image.too_large", { url, bytes: buffer.byteLength });
        continue;
      }

      const { publicId } = await uploadImageStream(buffer, folderType, `${identifier}_${i}`);
      publicIds.push(publicId);
    } catch (err) {
      // Single image failure must not propagate — the pipeline continues.
      logger.warn("image.mirror_failed", { url, err: (err as Error).message });
    }
  }

  logger.info("image.mirror_done", {
    identifier,
    total: batch.length,
    mirrored: publicIds.length,
  });
  return publicIds;
}
