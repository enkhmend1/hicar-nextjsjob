import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { cloudinaryStorage, cloudinaryEnabled } from "../Config/cloudinary.js";

const UPLOAD_DIR = path.resolve("uploads");
if (!cloudinaryEnabled && !fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Local fallback storage (only used if Cloudinary disabled)
const localStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 6) || "";
    const safeExt = /^\.(jpg|jpeg|png|webp|gif)$/.test(ext) ? ext : ".jpg";
    const id = crypto.randomBytes(8).toString("hex");
    cb(null, `${Date.now()}-${id}${safeExt}`);
  },
});

const storage = cloudinaryEnabled ? cloudinaryStorage : localStorage;

const fileFilter = (_req, file, cb) => {
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("Зөвхөн зураг файл оруулна уу"));
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Spreadsheet (CSV / Excel) uploads for bulk import. Memory storage so the
// handler reads `req.file.buffer` directly — never written to disk or pushed
// to Cloudinary. Filter by extension: CSV mimetypes are inconsistent across
// browsers/OS (text/csv, application/vnd.ms-excel, octet-stream, text/plain).
const SPREADSHEET_EXT = /\.(csv|xlsx|xls)$/i;
const spreadsheetFilter = (_req, file, cb) => {
  if (!SPREADSHEET_EXT.test(file.originalname || "")) {
    return cb(new Error("Зөвхөн .csv / .xlsx / .xls файл оруулна уу"));
  }
  cb(null, true);
};

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: spreadsheetFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

export { UPLOAD_DIR };
