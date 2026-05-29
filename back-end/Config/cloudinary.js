import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import chalk from "chalk";

const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER = "hicar",
} = process.env;

// Cloudinary's cloud_name format: lowercase letters, digits, and
// hyphens only, 3-30 chars. Anything else (uppercase, underscore,
// spaces) is rejected by the upload API with a confusing "Invalid
// cloud_name X" error AFTER the first upload attempt — by which time
// the dev has already wired the .env and assumes it works. We catch
// the malformed value here at boot so the message is clear and the
// app falls back to local /uploads instead of 500-ing per upload.
const CLOUDNAME_RX = /^[a-z0-9-]{3,30}$/;
const cloudNameLooksValid = CLOUDINARY_CLOUD_NAME
  ? CLOUDNAME_RX.test(CLOUDINARY_CLOUD_NAME)
  : false;

if (CLOUDINARY_CLOUD_NAME && !cloudNameLooksValid) {
  console.log(chalk.red.bold(
    `Cloudinary cloud_name "${CLOUDINARY_CLOUD_NAME}" looks invalid.`
  ));
  console.log(chalk.yellow(
    "  • Expected: 3-30 lowercase letters / digits / hyphens (e.g. 'dabc1234e').\n" +
    "  • You probably copied your project / repo name instead of the Cloudinary\n" +
    "    account 'Cloud name' shown at https://console.cloudinary.com/ (top-right).\n" +
    "  • Fix CLOUDINARY_CLOUD_NAME in .env, then restart the server.\n" +
    "  • Falling back to local /uploads for now so the app still boots."
  ));
}

export const cloudinaryEnabled = Boolean(
  cloudNameLooksValid && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET,
);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log(chalk.green.bold(`Cloudinary enabled (cloud=${CLOUDINARY_CLOUD_NAME}, folder=${CLOUDINARY_FOLDER})`));
} else if (!CLOUDINARY_CLOUD_NAME && !CLOUDINARY_API_KEY) {
  // Genuinely not configured — quiet log.
  console.log(chalk.yellow.bold("Cloudinary disabled — falling back to local /uploads"));
}

export const cloudinaryStorage = cloudinaryEnabled
  ? new CloudinaryStorage({
      cloudinary,
      params: async (_req, file) => ({
        folder: CLOUDINARY_FOLDER,
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
        transformation: [{ quality: "auto:good" }, { fetch_format: "auto" }],
        public_id: `${Date.now()}-${file.originalname.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40)}`,
      }),
    })
  : null;

/** Extract public_id from a Cloudinary URL for deletion. */
export const publicIdFromUrl = (url) => {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("cloudinary.com")) return null;
    const parts = u.pathname.split("/");
    const uploadIdx = parts.findIndex((p) => p === "upload");
    if (uploadIdx === -1) return null;
    // skip optional version segment like v1234567890
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
    const last = rest.join("/").replace(/\.[^/.]+$/, "");
    return last || null;
  } catch {
    return null;
  }
};

export { cloudinary };
