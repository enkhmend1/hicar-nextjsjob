/**
 * Export service — convert an analytics payload into XLSX / CSV / PDF.
 *
 * Each generator returns { buffer, filename, mime } so the route can
 * pipe it to res unchanged.
 */

import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";

const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);
const fmtCur = (n) => `₮${Number(n || 0).toLocaleString("mn-MN")}`;
const baseName = (shopName, range) =>
  `${(shopName || "hicar-seller").replace(/[^a-zA-Z0-9-_]/g, "_")}_${fmtDate(range.from)}_${fmtDate(range.to)}`;

// ── XLSX ──────────────────────────────────────────────────────────
export const buildXlsx = (analytics, { shopName = "" } = {}) => {
  const wb = XLSX.utils.book_new();

  // Summary
  const summary = [
    ["Дэлгүүр", shopName || "—"],
    ["Хугацаа", `${fmtDate(analytics.range.from)} – ${fmtDate(analytics.range.to)}`],
    ["Хураамж", `${analytics.platformFeePercent}%`],
    [],
    ["Захиалга", analytics.totals.orders],
    ["Ширхэг борлуулсан", analytics.totals.units],
    ["Орлого (₮)", analytics.totals.revenue],
    ["Хураамж (₮)", analytics.totals.commission],
    ["Цэвэр ашиг (₮)", analytics.totals.profit],
    ["Дундаж захиалгын дүн (₮)", analytics.totals.avgOrderValue],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Хураангуй");

  // Daily
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      analytics.daily.map((r) => ({
        Огноо: r.date,
        Захиалга: r.orderCount,
        Ширхэг: r.units,
        "Орлого (₮)": r.revenue,
      })),
    ),
    "Өдөр тутмын",
  );

  // Monthly
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      analytics.monthly.map((r) => ({
        Сар: r.month,
        Захиалга: r.orderCount,
        Ширхэг: r.units,
        "Орлого (₮)": r.revenue,
      })),
    ),
    "Сар бүрийн",
  );

  // Top products
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      analytics.topProducts.map((p, i) => ({
        "#": i + 1,
        Бараа: p.name,
        OEM: p.oem || "",
        "Ширхэг борлуулсан": p.units,
        "Орлого (₮)": p.revenue,
      })),
    ),
    "Шилдэг бараа",
  );

  // Status breakdown
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      Object.entries(analytics.statusBreakdown).map(([status, count]) => ({ Статус: status, Тоо: count })),
    ),
    "Статус",
  );

  // Inventory
  const inv = analytics.inventory;
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Нийт бараа", inv.totalProducts],
      ["Зөвшөөрөгдсөн", inv.approved],
      ["Хүлээгдэж буй", inv.pending],
      ["Татгалзсан", inv.rejected],
      ["Идэвхтэй (in stock)", inv.inStockCount],
      ["Дууссан", inv.outOfStockCount],
      ["Нийт ширхэг", inv.totalStock],
      ["Нөөцийн үнэлгээ (₮)", inv.stockValue],
    ]),
    "Бараа материал",
  );

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return {
    buffer,
    filename: `${baseName(shopName, analytics.range)}.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
};

// ── CSV ───────────────────────────────────────────────────────────
const csvEscape = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvEscape).join(",");

export const buildCsv = (analytics, { shopName = "" } = {}) => {
  const lines = [];
  lines.push(csvRow(["Дэлгүүр", shopName || "—"]));
  lines.push(csvRow(["Хугацаа", `${fmtDate(analytics.range.from)} – ${fmtDate(analytics.range.to)}`]));
  lines.push(csvRow(["Хураамж %", analytics.platformFeePercent]));
  lines.push("");

  lines.push(csvRow(["Үзүүлэлт", "Утга"]));
  lines.push(csvRow(["Захиалга", analytics.totals.orders]));
  lines.push(csvRow(["Ширхэг", analytics.totals.units]));
  lines.push(csvRow(["Орлого", analytics.totals.revenue]));
  lines.push(csvRow(["Хураамж", analytics.totals.commission]));
  lines.push(csvRow(["Цэвэр ашиг", analytics.totals.profit]));
  lines.push("");

  lines.push("# DAILY");
  lines.push(csvRow(["date", "orderCount", "units", "revenue"]));
  for (const r of analytics.daily) lines.push(csvRow([r.date, r.orderCount, r.units, r.revenue]));
  lines.push("");

  lines.push("# MONTHLY");
  lines.push(csvRow(["month", "orderCount", "units", "revenue"]));
  for (const r of analytics.monthly) lines.push(csvRow([r.month, r.orderCount, r.units, r.revenue]));
  lines.push("");

  lines.push("# TOP_PRODUCTS");
  lines.push(csvRow(["rank", "name", "oem", "units", "revenue"]));
  analytics.topProducts.forEach((p, i) => lines.push(csvRow([i + 1, p.name, p.oem || "", p.units, p.revenue])));
  lines.push("");

  lines.push("# INVENTORY");
  const inv = analytics.inventory;
  lines.push(csvRow(["totalProducts", inv.totalProducts]));
  lines.push(csvRow(["approved", inv.approved]));
  lines.push(csvRow(["pending", inv.pending]));
  lines.push(csvRow(["rejected", inv.rejected]));
  lines.push(csvRow(["outOfStock", inv.outOfStockCount]));
  lines.push(csvRow(["totalStock", inv.totalStock]));
  lines.push(csvRow(["stockValue", inv.stockValue]));

  // BOM so Excel detects UTF-8 for Cyrillic
  return {
    buffer: Buffer.from("﻿" + lines.join("\r\n"), "utf8"),
    filename: `${baseName(shopName, analytics.range)}.csv`,
    mime: "text/csv; charset=utf-8",
  };
};

// ── PDF ───────────────────────────────────────────────────────────
const drawTable = (doc, headers, rows, opts = {}) => {
  const startX = opts.startX ?? doc.x;
  const colWidth = opts.colWidth || (doc.page.width - startX - 40) / headers.length;
  const rowHeight = 18;

  doc.font("Helvetica-Bold").fontSize(9);
  headers.forEach((h, i) => doc.text(h, startX + i * colWidth, doc.y, { width: colWidth - 4 }));
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(9);

  for (const r of rows) {
    if (doc.y + rowHeight > doc.page.height - 50) doc.addPage();
    const top = doc.y;
    r.forEach((cell, i) => {
      doc.text(String(cell ?? ""), startX + i * colWidth, top, {
        width: colWidth - 4, height: rowHeight - 2, ellipsis: true,
      });
    });
    doc.y = top + rowHeight;
  }
  doc.moveDown(0.5);
};

export const buildPdf = (analytics, { shopName = "" } = {}) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve({
        buffer: Buffer.concat(chunks),
        filename: `${baseName(shopName, analytics.range)}.pdf`,
        mime: "application/pdf",
      }));
      doc.on("error", reject);

      // Header
      doc.font("Helvetica-Bold").fontSize(20).fillColor("#5b21b6").text("HiCar", { continued: true });
      doc.fillColor("#111").text(" — Seller Analytics Report");
      doc.fillColor("#555").font("Helvetica").fontSize(10)
        .text(shopName || "—")
        .text(`Period: ${fmtDate(analytics.range.from)}  →  ${fmtDate(analytics.range.to)}`)
        .text(`Generated: ${new Date().toLocaleString("mn-MN")}`);
      doc.moveDown(1);

      // KPI summary
      const t = analytics.totals;
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text("Хураангуй");
      doc.font("Helvetica").fontSize(10).fillColor("#333");
      drawTable(
        doc,
        ["Үзүүлэлт", "Утга"],
        [
          ["Захиалга", t.orders],
          ["Ширхэг борлуулсан", t.units],
          ["Орлого", fmtCur(t.revenue)],
          ["Хураамж (" + analytics.platformFeePercent + "%)", fmtCur(t.commission)],
          ["Цэвэр ашиг", fmtCur(t.profit)],
          ["Дундаж захиалгын дүн", fmtCur(t.avgOrderValue)],
        ],
      );

      // Top products
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text("Шилдэг 10 бараа");
      doc.font("Helvetica").fontSize(10).fillColor("#333");
      drawTable(
        doc,
        ["#", "Нэр", "OEM", "Ширхэг", "Орлого"],
        analytics.topProducts.length === 0
          ? [["—", "(өгөгдөл алга)", "", "", ""]]
          : analytics.topProducts.map((p, i) => [i + 1, p.name, p.oem || "", p.units, fmtCur(p.revenue)]),
      );

      // Monthly
      if (analytics.monthly.length) {
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text("Сар бүрийн борлуулалт");
        doc.font("Helvetica").fontSize(10).fillColor("#333");
        drawTable(
          doc,
          ["Сар", "Захиалга", "Ширхэг", "Орлого"],
          analytics.monthly.map((m) => [m.month, m.orderCount, m.units, fmtCur(m.revenue)]),
        );
      }

      // Inventory
      const inv = analytics.inventory;
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text("Бараа материалын төлөв");
      doc.font("Helvetica").fontSize(10).fillColor("#333");
      drawTable(
        doc,
        ["Үзүүлэлт", "Утга"],
        [
          ["Нийт бараа", inv.totalProducts],
          ["Зөвшөөрөгдсөн", inv.approved],
          ["Хүлээгдэж буй", inv.pending],
          ["Татгалзсан", inv.rejected],
          ["Идэвхтэй", inv.inStockCount],
          ["Дууссан", inv.outOfStockCount],
          ["Нийт ширхэг", inv.totalStock],
          ["Нөөцийн үнэлгээ", fmtCur(inv.stockValue)],
        ],
      );

      // Footer
      doc.fontSize(8).fillColor("#888")
        .text(`© ${new Date().getFullYear()} HiCar MN`, 40, doc.page.height - 30, { align: "center" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });

export const FORMATS = {
  xlsx: buildXlsx,
  csv: buildCsv,
  pdf: buildPdf,
};
