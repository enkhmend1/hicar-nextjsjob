/**
 * Seller bulk-import controller.
 *
 * Endpoints (all require an approved seller):
 *
 *   POST /api/seller/import/enrich        — single row enrich, sync
 *   POST /api/seller/import/enrich-bulk   — N rows enrich, sync (bounded concurrency)
 *   POST /api/seller/import/parse         — parse uploaded .csv/.xlsx file → rows
 *   POST /api/seller/import/commit        — persist enriched rows as Products
 *   POST /api/seller/import/ocr           — image URL → GPT-4V → extract → enrich
 *
 * Design:
 *   • Enrichment is a separate step from commit on purpose — the seller sees
 *     a preview and can correct AI mistakes before anything is written.
 *   • Bulk commit decrements nothing and creates products with status=pending,
 *     identical to the manual create flow.
 *   • Duplicate detection: products with the same (seller, cleaned_oem_code)
 *     skip-or-update based on the `onDuplicate` flag.
 */

import * as XLSX from "xlsx";
import Product from "../Model/product.model.js";
import { upload } from "../Middleware/upload.middleware.js";
import { enrichProduct, enrichBulk } from "../Service/productEnricher.service.js";
import { buildPreview } from "../Service/importPreview.service.js";
// ocrHandler does image OCR — it MUST go through the vision client.
// aiConfig.vision points at Gemini by default (OpenAI-compat endpoint)
// and falls back gracefully when GEMINI_API_KEY is unset.
import { aiConfig } from "../Config/openai.js";
import { rememberInputs } from "./seller.controller.js";

// ── Helpers ────────────────────────────────────────────────────────────
const num = (v, dflt = 0) => {
  if (v == null || v === "") return dflt;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : dflt;
};

const enrichedToProductDoc = (e, sellerId) => ({
  seller:      sellerId,
  status:      "pending",
  name:        e.display_name_mn || e.raw_name || "Unnamed",
  oem:         e.cleaned_oem_code || "",
  price:       num(e.price),
  category:    (e.standard_category || "other").toLowerCase(),
  brand:       e.brand || "",
  source:      "local",
  stockQty:    num(e.stock, 0),
  inStock:     num(e.stock, 0) > 0,
  description: [
    e.display_name_en ? `EN: ${e.display_name_en}` : null,
    e.condition_grade ? `Grade: ${e.condition_grade}` : null,
    e.location ? `Location: ${e.location}` : null,
  ].filter(Boolean).join("\n"),
  tags: [
    e.standard_category,
    e.condition_grade?.toLowerCase().replace(/\s+/g, "_"),
    ...(e.compatible_vehicles || []).slice(0, 5).map((v) =>
      [v.make, v.model, v.chassis].filter(Boolean).join(" ").toLowerCase()
    ),
  ].filter(Boolean),
  compatible: (e.compatible_vehicles || []).map((v) =>
    [v.make, v.model, v.chassis, v.engine, v.years].filter(Boolean).join(" ")
  ),
});

// ── 1. Single-row enrich ──────────────────────────────────────────────
export const enrichOne = async (req, res) => {
  try {
    const out = await enrichProduct(req.body);
    return res.json({ enriched: out });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── 2. Bulk enrich ────────────────────────────────────────────────────
export const enrichBulkHandler = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ message: "rows массив шаардлагатай" });
    if (rows.length > 500) return res.status(413).json({ message: "Нэг удаа 500-аас цөөн мөр" });

    const enriched = await enrichBulk(rows, { concurrency: 5 });
    return res.json({
      enriched,
      total: enriched.length,
      withWarnings: enriched.filter((e) => (e._meta?.warnings || []).length > 0).length,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── 3. CSV / XLSX upload — multer reads file into req.file ────────────
export const parseUploadedFile = [
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "file шаардлагатай" });
      // Read the file from disk (multer disk) or buffer (multer memory).
      // Our multer config writes to disk; XLSX.read handles both via 'file' arg.
      const wb = req.file.path
        ? XLSX.readFile(req.file.path)
        : XLSX.read(req.file.buffer, { type: "buffer" });

      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

      // Header heuristic — accept Mongolian or English headers
      const HEADER_MAP = {
        name:       ["raw_name", "name", "нэр", "barааны нэр", "барааны нэр", "product"],
        input_code: ["input_code", "oem", "код", "code", "part_number", "part no"],
        brand:      ["brand", "брэнд"],
        price:      ["price", "үнэ", "unit price"],
        stock:      ["stock", "qty", "ширхэг", "үлдэгдэл"],
        location:   ["location", "салбар", "branch", "warehouse"],
      };
      const headerKey = (raw) => {
        const k = String(raw || "").trim().toLowerCase();
        for (const [target, opts] of Object.entries(HEADER_MAP)) {
          if (opts.some((o) => o.toLowerCase() === k)) return target;
        }
        return null;
      };

      // The first row is already turned into keys by sheet_to_json — map them.
      const rows = json.map((row) => {
        const mapped = {};
        for (const [origKey, val] of Object.entries(row)) {
          const k = headerKey(origKey);
          if (k) mapped[k] = val;
        }
        return {
          raw_name:   mapped.name || "",
          input_code: mapped.input_code || "",
          brand:      mapped.brand || "",
          price:      num(mapped.price),
          stock:      num(mapped.stock, 0),
          location:   mapped.location || "",
        };
      }).filter((r) => r.raw_name || r.input_code);

      return res.json({
        rows,
        total: rows.length,
        detectedHeaders: Object.keys(json[0] || {}),
        sheetName,
      });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  },
];

// ── 4. Commit — turn enriched rows into Product docs ──────────────────
export const commitHandler = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows?.length) return res.status(400).json({ message: "rows шаардлагатай" });

    const onDuplicate = ["skip", "update"].includes(req.body?.onDuplicate)
      ? req.body.onDuplicate : "skip";

    let created = 0, updated = 0, skipped = 0, failed = 0;
    const failures = [];
    const createdIds = [];

    for (const r of rows) {
      try {
        const doc = enrichedToProductDoc(r, req.user._id);
        if (!doc.name?.trim() || doc.price < 0) {
          throw new Error("Нэр / үнэ буруу");
        }

        // Same-seller dedupe by OEM
        const existing = doc.oem
          ? await Product.findOne({ seller: req.user._id, oem: doc.oem })
          : null;

        if (existing) {
          if (onDuplicate === "skip") { skipped++; continue; }
          // update mode: refresh mutable fields, keep status as-is (don't re-trigger moderation)
          existing.price       = doc.price;
          existing.stockQty    = doc.stockQty;
          existing.inStock     = doc.inStock;
          existing.description = doc.description;
          existing.tags        = doc.tags;
          existing.compatible  = doc.compatible;
          await existing.save();
          updated++;
          continue;
        }

        const item = await Product.create(doc);
        createdIds.push(String(item._id));
        created++;
      } catch (e) {
        failed++;
        failures.push({ row: r.cleaned_oem_code || r.raw_name, error: e.message });
      }
    }

    // Persist this seller's free-text history (brand etc.) — best-effort
    try {
      const uniqueBrands  = [...new Set(rows.map((r) => r.brand).filter(Boolean))];
      for (const brand of uniqueBrands) {
        await rememberInputs(req.user._id, { brand });
      }
    } catch { /* swallow */ }

    return res.json({
      created, updated, skipped, failed,
      total: rows.length,
      createdIds,
      failures: failures.slice(0, 50),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── 5. OCR enrich — image URL → GPT-4V extracts code/name → enrich ────
export const ocrHandler = async (req, res) => {
  try {
    // OCR requires the vision provider specifically — Groq (text-only)
    // cannot service this even when it is configured for chat. We surface
    // a clear operator-facing message so the env fix is obvious.
    if (!aiConfig.vision.enabled) {
      return res.status(503).json({
        code: "VISION_PROVIDER_UNAVAILABLE",
        message: "OCR backend нь vision AI provider шаардана. GEMINI_API_KEY тохируулна уу.",
      });
    }
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ message: "imageUrl шаардлагатай" });

    // Step 1: vision extracts the visible part info via function calling
    const tool = {
      type: "function",
      function: {
        name: "extract_part_info",
        description: "Extract the visible part info from a product label/box/barcode image.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["raw_name", "input_code"],
          properties: {
            raw_name:    { type: "string", description: "Best-guess product name visible on the package (any language)" },
            input_code:  { type: "string", description: "OEM / part number visible (UPPER, spaces ok, will be cleaned later)" },
            brand:       { type: "string", description: "Manufacturer brand if visible" },
          },
        },
      },
    };
    const visionResp = await aiConfig.vision.client.chat.completions.create({
      model: aiConfig.vision.model,
      temperature: 0.0,
      tool_choice: { type: "function", function: { name: tool.function.name } },
      tools: [tool],
      messages: [
        { role: "system", content: "You read product packaging in any language. Return ONLY what you can clearly see — no guessing." },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this auto-parts label / barcode. Extract part name, OEM code, and brand if visible." },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    });

    const call = visionResp.choices[0]?.message?.tool_calls?.[0];
    if (!call) return res.status(422).json({ message: "OCR таних боломжгүй зураг" });
    const ocr = JSON.parse(call.function.arguments || "{}");

    // Step 2: feed into the regular enricher
    const enriched = await enrichProduct({
      raw_name:   ocr.raw_name,
      input_code: ocr.input_code,
      brand:      ocr.brand,
    });

    return res.json({ ocr, enriched });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── 6. Predictive Preview (Phase D) ───────────────────────────────────
// Runs the row pipeline that powers the wizard's Step-2 review screen:
// OCR fuzzy correction → LLM enrichment → conflict detection.
//
// Output rows carry: confidence score, ocrFix block, conflict block (or
// null), and a suggested per-row action ("create" | "merge_stock" |
// "overwrite_all" | "skip" | "review"). The frontend renders the
// confidence + conflict as colour-coded UI; the action is editable
// per-row and used by commit-v2 below.
export const previewHandler = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows)               return res.status(400).json({ message: "rows массив шаардлагатай" });
    if (rows.length > 500)   return res.status(413).json({ message: "Нэг удаа 500-аас цөөн мөр" });

    const concurrency = Math.max(1, Math.min(8, Number(req.body?.concurrency) || 5));
    const result = await buildPreview(req.user._id, rows, { concurrency });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── 7. Conflict-aware Commit (Phase D — commit-v2) ────────────────────
// Replaces the binary skip|update flag of the legacy commit endpoint
// with PER-ROW action verbs that mirror the spec's bulk-action UI:
//
//   "create"        → new Product (raises validation error on dup OEM)
//   "merge_stock"   → keep old price, add incoming qty to existing.stockQty
//   "overwrite_all" → replace price + qty + warehouseLocation + costPrice
//   "skip"          → do nothing for this row
//   "review"        → also do nothing, but flag it as needing seller attention
//                     (rows shouldn't reach commit with this verb — frontend
//                      forces a decision — but we accept it as no-op for safety)
//
// Returns per-row outcomes so the seller sees exactly what landed.
export const commitV2Handler = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows?.length) return res.status(400).json({ message: "rows шаардлагатай" });

    const outcomes = [];
    let created = 0, merged = 0, overwritten = 0, skipped = 0, failed = 0;

    for (const r of rows) {
      const action = String(r.action || "skip").toLowerCase();
      try {
        const doc = enrichedToProductDoc(r, req.user._id);
        if (!doc.name?.trim() || doc.price < 0) throw new Error("Нэр / үнэ буруу");

        // Look up the existing product the seller might be conflicting with.
        const existing = doc.oem
          ? await Product.findOne({ seller: req.user._id, oem: doc.oem })
          : null;

        if (action === "skip" || action === "review") {
          skipped++;
          outcomes.push({ oem: doc.oem, name: doc.name, action, result: "skipped" });
          continue;
        }

        if (action === "create") {
          if (existing) throw new Error("OEM аль хэдийн бүртгэлтэй — merge_stock эсвэл overwrite_all сонгоно уу");
          const item = await Product.create(doc);
          created++;
          outcomes.push({ oem: doc.oem, name: doc.name, action, result: "created", productId: String(item._id) });
          continue;
        }

        if (action === "merge_stock") {
          if (!existing) throw new Error("Нэгтгэх бараа DB-д алга — create-ыг сонгоно уу");
          existing.stockQty = (existing.stockQty || 0) + (doc.stockQty || 0);
          existing.inStock  = existing.stockQty > 0;
          // Re-record warehouse if newer row knows it.
          if (doc.warehouseLocation) existing.warehouseLocation = doc.warehouseLocation;
          await existing.save();
          merged++;
          outcomes.push({ oem: doc.oem, name: doc.name, action, result: "merged",
            newStockQty: existing.stockQty, keptPrice: existing.price });
          continue;
        }

        if (action === "overwrite_all") {
          if (!existing) throw new Error("Дарж бичих бараа DB-д алга");
          const prevPrice = existing.price;
          existing.price       = doc.price;
          existing.stockQty    = doc.stockQty;
          existing.inStock     = doc.inStock;
          existing.description = doc.description;
          existing.tags        = doc.tags;
          existing.compatible  = doc.compatible;
          if (doc.warehouseLocation) existing.warehouseLocation = doc.warehouseLocation;
          if (doc.costPrice !== undefined && doc.costPrice >= 0) existing.costPrice = doc.costPrice;
          await existing.save();
          overwritten++;
          outcomes.push({ oem: doc.oem, name: doc.name, action, result: "overwritten",
            prevPrice, newPrice: existing.price, newStockQty: existing.stockQty });
          continue;
        }

        throw new Error(`Үл мэдэгдэх action: ${action}`);
      } catch (e) {
        failed++;
        outcomes.push({ oem: r.cleaned_oem_code, name: r.display_name_mn || r.raw_name, action, result: "failed", error: e.message });
      }
    }

    return res.json({
      total: rows.length,
      created, merged, overwritten, skipped, failed,
      outcomes,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
