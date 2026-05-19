import fs from "fs";
import path from "path";
import { UPLOAD_DIR } from "../Middleware/upload.middleware.js";
import { cloudinary, cloudinaryEnabled, publicIdFromUrl } from "../Config/cloudinary.js";

const buildLocalUrl = (req, filename) =>
  `${req.protocol}://${req.get("host")}/uploads/${filename}`;

// When using CloudinaryStorage, multer puts the URL on `file.path` (or `file.secure_url`)
const fileToUrl = (req, file) => {
  if (cloudinaryEnabled) return file.path || file.secure_url || "";
  return buildLocalUrl(req, file.filename);
};

export const uploadImage = (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Зураг олдсонгүй" });
  return res.status(201).json({ url: fileToUrl(req, req.file) });
};

export const uploadMany = (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "Зураг олдсонгүй" });
  }
  const urls = req.files.map((f) => fileToUrl(req, f));
  return res.status(201).json({ urls });
};

export const deleteImage = async (req, res) => {
  try {
    // Accept either a Cloudinary URL (?url=...) or local filename (/:filename)
    const url = req.query.url || "";
    if (url && cloudinaryEnabled) {
      const pid = publicIdFromUrl(url);
      if (!pid) return res.status(400).json({ message: "Cloudinary URL буруу" });
      await cloudinary.uploader.destroy(pid);
      return res.json({ ok: true });
    }
    // Local fallback
    const filename = req.params.filename;
    if (!filename) return res.status(400).json({ message: "Файлын нэр шаардлагатай" });
    const safe = path.basename(filename);
    const full = path.join(UPLOAD_DIR, safe);
    if (!full.startsWith(UPLOAD_DIR)) {
      return res.status(400).json({ message: "Зам буруу" });
    }
    fs.unlink(full, (err) => {
      if (err && err.code !== "ENOENT") return res.status(500).json({ message: err.message });
      return res.json({ ok: true });
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
