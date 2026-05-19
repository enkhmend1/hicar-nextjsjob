import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import chalk from "chalk";

const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER = "hicar",
} = process.env;

export const cloudinaryEnabled = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET,
);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log(chalk.green.bold(`Cloudinary enabled (folder: ${CLOUDINARY_FOLDER})`));
} else {
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
