/**
 * Cloudinary image service for the HiCar Data Platform.
 *
 * Organizes uploads under a structured folder hierarchy:
 *   hicar-platform/raw-products/     — seller-submitted raw images
 *   hicar-platform/canonical-parts/  — curated catalog images
 *
 * Lazy-initializes on first use; degrades gracefully when credentials are
 * absent so the normalization pipeline continues without image support.
 */

import { v2 as cloudinary } from "cloudinary";
import { env } from "../shared/env.js";
import { logger } from "../shared/logger.js";
import { UpstreamError } from "../shared/errors.js";

// ── Folder map ──────────────────────────────────────────────────────────────

const FOLDERS = {
  raw: "hicar-platform/raw-products",
  canonical: "hicar-platform/canonical-parts",
} as const;

const MAX_DIMENSION = 1200;

// ── Lazy init ────────────────────────────────────────────────────────────────

let _initialized = false;
let _enabled = false;

function init(): void {
  if (_initialized) return;
  _initialized = true;

  if (!env.cloudinaryEnabled) {
    logger.info("cloudinary.disabled", { reason: "credentials not set" });
    return;
  }

  try {
    cloudinary.config({
      cloud_name: env.cloudinaryCloudName,
      api_key: env.cloudinaryApiKey,
      api_secret: env.cloudinaryApiSecret,
      secure: true,
    });
    _enabled = true;
    logger.info("cloudinary.enabled", { cloud: env.cloudinaryCloudName });
  } catch (err) {
    logger.error("cloudinary.init_failed", { err: (err as Error).message });
  }
}

// ── Public interfaces ────────────────────────────────────────────────────────

export interface UploadResult {
  imageUrl: string;
  publicId: string;
}

export interface OptimizedUrlOptions {
  width?: number;
  height?: number;
}

// ── Internal result shape (subset of Cloudinary UploadApiResponse) ───────────

interface CloudUploadResult {
  secure_url: string;
  public_id: string;
  bytes: number;
  format: string;
}

interface CloudUploadError {
  message: string;
  http_code: number;
}

// ── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a raw image buffer to Cloudinary.
 *
 * Applies a `limit` crop at 1200×1200 on ingestion so oversized seller photos
 * never inflate storage. Throws `UpstreamError` on any failure so the worker
 * can catch, log, and continue the pipeline without crashing.
 */
export async function uploadImageStream(
  fileBuffer: Buffer,
  folderType: "raw" | "canonical",
  identifier: string,
): Promise<UploadResult> {
  init();

  if (!_enabled) {
    throw new UpstreamError("Cloudinary тохиргоогүй байна", {
      folderType,
      identifier,
    });
  }

  // Clean the identifier: keep alphanum / hyphens, truncate to 60 chars.
  const slug = identifier.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
  // Unix epoch seconds gives a short, collision-resistant suffix.
  const publicId = `${FOLDERS[folderType]}/${slug}_${Math.floor(Date.now() / 1000)}`;

  try {
    const result = await new Promise<CloudUploadResult>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: "image",
          overwrite: false,
          transformation: [
            { width: MAX_DIMENSION, height: MAX_DIMENSION, crop: "limit" },
          ],
        },
        (err: CloudUploadError | undefined, res: CloudUploadResult | undefined) => {
          if (err) {
            reject(new Error(err.message ?? "Cloudinary upload error"));
          } else if (res) {
            resolve(res);
          } else {
            reject(new Error("No response from Cloudinary uploader"));
          }
        },
      );
      stream.end(fileBuffer);
    });

    logger.info("cloudinary.upload_ok", {
      publicId: result.public_id,
      bytes: result.bytes,
      format: result.format,
    });

    return { imageUrl: result.secure_url, publicId: result.public_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("cloudinary.upload_failed", { publicId, err: msg });
    throw new UpstreamError(`Зураг байршуулж чадсангүй: ${msg}`, { publicId });
  }
}

// ── URL generation ───────────────────────────────────────────────────────────

/**
 * Build a delivery URL with automatic format + quality selection.
 *
 * When optional dimensions are supplied they are applied as a `limit` crop
 * (shrinks only, preserves aspect ratio). Returns `""` when Cloudinary is
 * not configured so callers can substitute a placeholder without throwing.
 */
export function getOptimizedUrl(
  publicId: string,
  options: OptimizedUrlOptions = {},
): string {
  init();

  if (!_enabled) {
    logger.warn("cloudinary.url_skipped", { publicId, reason: "disabled" });
    return "";
  }

  // Base: auto-format + auto-quality for CDN-optimal delivery.
  const transformation: Array<Record<string, string | number>> = [
    { fetch_format: "auto", quality: "auto" },
  ];

  // Optional resize layer: limit preserves aspect ratio, never upscales.
  if (options.width !== undefined || options.height !== undefined) {
    const resize: Record<string, string | number> = { crop: "limit" };
    if (options.width !== undefined) resize.width = options.width;
    if (options.height !== undefined) resize.height = options.height;
    transformation.push(resize);
  }

  // Cast through unknown: cloudinary's url() second param is a union type and
  // TypeScript cannot narrow it to the ConfigAndUrlOptions member statically.
  return cloudinary.url(
    publicId,
    { transformation, secure: true } as unknown as Parameters<typeof cloudinary.url>[1],
  );
}

/** Whether the Cloudinary service is currently active (credentials present + valid). */
export function cloudinaryServiceEnabled(): boolean {
  init();
  return _enabled;
}
