/**
 * CSV/Excel parser for bulk import. Uses `xlsx` (already a backend dependency)
 * which handles both formats. Column headers are mapped LOOSELY against a set
 * of aliases (English + Mongolian Cyrillic + Latin), because seller files are
 * never standardized. Unrecognized columns are preserved verbatim in
 * `rawAttributes` so no seller data is lost.
 *
 * After parsing, call `applyColumnRemapping` with the AI-determined header map
 * to promote rawAttributes values into canonical fields without re-parsing.
 */

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import type { MappableField } from "./columnMapping.service.js";

export interface ParsedRow {
  rawTitle?: string;
  rawDescription?: string;
  rawBrand?: string;
  rawCategory?: string;
  rawPrice?: string;
  rawOem?: string;
  images?: string[];
  price?: number;
  stockQty?: number;
  rawAttributes: Record<string, string>;
}

/** Parse a messy money string into integer MNT. "120,000₮" / "120k" / "1.2m". */
export function parseMoney(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.round(input));
  if (typeof input !== "string") return undefined;
  let s = input.trim().toLowerCase().replace(/[₮¥$,\s]/g, "");
  if (!s) return undefined;
  let mult = 1;
  if (s.endsWith("k")) { mult = 1_000; s = s.slice(0, -1); }
  else if (s.endsWith("m")) { mult = 1_000_000; s = s.slice(0, -1); }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * mult)) : undefined;
}

/** Canonical field → header aliases (normalized: lowercased, no spaces). */
const COLUMN_ALIASES: Record<keyof Omit<ParsedRow, "rawAttributes" | "price">, string[]> = {
  rawTitle: ["title", "name", "product", "productname", "нэр", "ner", "бараа", "baraa"],
  rawDescription: ["description", "desc", "detail", "details", "тайлбар", "tailbar"],
  rawBrand: ["brand", "make", "manufacturer", "брэнд", "бренд", "brend"],
  rawCategory: ["category", "cat", "type", "ангилал", "angilal", "torol", "төрөл"],
  rawPrice: ["price", "cost", "amount", "үнэ", "une"],
  rawOem: ["oem", "oemnumber", "oem_number", "partnumber", "part_number", "partno", "код", "kod"],
  stockQty: ["qty", "quantity", "stock", "count", "тоо", "too", "ширхэг", "shirheg", "uldegdel", "үлдэгдэл"],
  images: ["image", "images", "imageurl", "imagelink", "photo", "photourl", "img", "зураг", "zurag"],
};

/** Fields that hold a plain string value (assigned directly from a cell). */
const STRING_FIELDS = ["rawTitle", "rawDescription", "rawBrand", "rawCategory", "rawOem"] as const;
type StringField = (typeof STRING_FIELDS)[number];

/** Exported so the AI column mapper can apply the same normalisation. */
export const normalizeHeader = (h: string): string => h.trim().toLowerCase().replace(/[\s_-]/g, "");

/** Build header-string → canonical-field map for one file's header row. */
function buildFieldMap(headers: string[]): Map<string, keyof ParsedRow> {
  const map = new Map<string, keyof ParsedRow>();
  for (const header of headers) {
    const norm = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.some((a) => normalizeHeader(a) === norm)) {
        map.set(header, field as keyof ParsedRow);
        break;
      }
    }
  }
  return map;
}

/** Parse one or more URLs from a cell value (comma- or newline-separated). */
function parseUrlCell(value: string): string[] {
  return value
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter((s) => {
      try { new URL(s); return true; } catch { return false; }
    });
}

/**
 * Parse a CSV/Excel file at `filePath` into structured rows. The first sheet's
 * header row drives column mapping. Returns one ParsedRow per data row.
 * Also returns the set of headers that were NOT matched to any canonical field
 * — pass these to `aiMapColumnHeaders` for AI-powered remapping.
 */
export function parseImportFile(filePath: string): {
  rows: ParsedRow[];
  unmappedHeaders: string[];
} {
  const wb = XLSX.read(readFileSync(filePath), { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], unmappedHeaders: [] };
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { rows: [], unmappedHeaders: [] };

  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (records.length === 0) return { rows: [], unmappedHeaders: [] };

  const headers = Object.keys(records[0] ?? {});
  const fieldMap = buildFieldMap(headers);
  const unmappedHeaders = headers.filter((h) => !fieldMap.has(h));

  const rows = records.map((record) => {
    const row: ParsedRow = { rawAttributes: {} };
    for (const [header, rawValue] of Object.entries(record)) {
      const value = rawValue == null ? "" : String(rawValue).trim();
      if (!value) continue;
      const field = fieldMap.get(header);
      if (!field) {
        row.rawAttributes[header] = value;
        continue;
      }
      if (field === "stockQty") {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) row.stockQty = Math.max(0, n);
      } else if (field === "rawPrice") {
        row.rawPrice = value;
        row.price = parseMoney(value);
      } else if (field === "images") {
        const urls = parseUrlCell(value);
        if (urls.length) row.images = [...(row.images ?? []), ...urls];
      } else if ((STRING_FIELDS as readonly string[]).includes(field)) {
        row[field as StringField] = value;
      }
    }
    return row;
  });

  return { rows, unmappedHeaders };
}

/**
 * Apply AI-determined header remapping to already-parsed rows.
 * Moves values from `rawAttributes[header]` into the canonical field and
 * removes the key from rawAttributes. Returns new row objects (non-mutating).
 */
export function applyColumnRemapping(
  rows: ParsedRow[],
  remapping: Map<string, MappableField>,
): ParsedRow[] {
  if (remapping.size === 0) return rows;

  return rows.map((row) => {
    const r: ParsedRow = { ...row, rawAttributes: { ...row.rawAttributes } };

    for (const [header, field] of remapping) {
      const value = r.rawAttributes[header];
      if (!value) continue;
      delete r.rawAttributes[header];

      if (field === "images") {
        const urls = parseUrlCell(value);
        if (urls.length) r.images = [...(r.images ?? []), ...urls];
      } else if (field === "stockQty") {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) r.stockQty = r.stockQty ?? Math.max(0, n);
      } else if (field === "rawPrice") {
        r.rawPrice = r.rawPrice ?? value;
        r.price = r.price ?? parseMoney(value);
      } else {
        // rawTitle / rawDescription / rawBrand / rawCategory / rawOem
        const sr = r as unknown as Record<string, unknown>;
        sr[field] = sr[field] ?? value;
      }
    }

    return r;
  });
}
