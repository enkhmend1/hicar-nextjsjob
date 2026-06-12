# HiCar B2B Product Catalogue Standard

Design of record for the seller bulk-import sheet (TecDoc-style, 32 columns)
and how each column maps onto the `Product` model. The pipeline is
**import-first**: professional sellers ship price lists as Excel/CSV through
`/seller/products/import`; small sellers keep using the simple manual form —
every B2B field is optional with a harmless default.

Flow: `POST /api/seller/import/parse` (header mapping below) → AI enrich
(preview, correctable) → `POST /api/seller/import/commit` (dedupe + persist).

## Column → field mapping

### Required (1–18)

| # | Column | Product field | Notes |
|---|--------|---------------|-------|
| 1 | `SKU` | `sku` | Seller's unique article code. Unique **per seller** (partial index, `""` exempt). Beats OEM in import dedupe. |
| 2 | `Brand` | `brand` | Parts brand (BOSCH). **Not** the vehicle make. |
| 3 | `MPN` | `mpn` | Manufacturer part number — the aftermarket maker's own code. |
| 4 | `GTIN` | `gtin` | Digits only; GTIN-8/12/13/14 validated at the model. |
| 5 | `Category` | `category` | Lowercased; underscores become spaces (`Brake_Pad` → `brake pad`). |
| 6 | `Condition` | `condition` | `new` / `used` / `refurbished` (MN aliases: шинэ/хуучин/сэргээсэн). |
| 7 | `Make` | `fitments[0].make` | Vehicle make. |
| 8 | `Model` | `fitments[0].model` | Vehicle model. |
| 9 | `Generation` | `fitments[0].generation` | Body code (E210, W206…). |
| 10 | `Year_From` | `fitments[0].yearStart` | Integer. |
| 11 | `Year_To` | `fitments[0].yearEnd` | `9999` = "current" → stored as open-ended (no yearEnd). |
| 12 | `Engine_Code` | `fitments[0].engineCode` | Free text. |
| 13 | `Transmission` | `fitments[0].transmission` | CVT / Manual / Automatic… |
| 14 | `Drive_Type` | `fitments[0].driveType` | FWD / RWD / 4WD. |
| 15 | `Price_MNT` | `price` | Integer MNT (money is integer MNT platform-wide). |
| 16 | `Qty` | `stockQty` (+`inStock`) | ≥ 0. |
| 17 | `Image_URL` | `images[0]` | `https://` only — http/invalid URLs are dropped. |
| 18 | `Short_Title` | `name` | Max 200 chars. |

### Conditional (19–24)

| # | Column | Product field | Notes |
|---|--------|---------------|-------|
| 19 | `OE_Part_Number` | `oem` | The OE (vehicle-maker) number the part replaces. Existing field. |
| 20 | `Warranty_Months` | `warrantyMonths` | 0–120. Shown as a badge on the product page. |
| 21 | `Weight_KG` | `weightKg` | Decimal. |
| 22 | `Dimensions_CM` | `dimensionsCm` | Stored as `"LxWxH"` display string. |
| 23 | `Hazardous` | `hazardous` | TRUE/Yes/1/Тийм → `true`. |
| 24 | `Country_Of_Origin` | `countryOfOrigin` | Free text. |

### Optional B2B (25–32)

| # | Column | Product field | Notes |
|---|--------|---------------|-------|
| 25 | `MOQ` | `moq` | ≥ 1. Enforced server-side at order create; product page opens at the first valid quantity. |
| 25b | `Order_Multiple` | `orderMultiple` | Pack size (2 = sold in pairs, e.g. front shocks). Quantity must be a clean multiple — steppers move in whole packs, cart snaps, order create rejects violations. HiCar extension beyond the 32 columns. |
| 25c | `Price_Tiers` | `priceTiers[]` | `"minQty:price,minQty:price"` e.g. `10:110000,50:95000`. Max 5 tiers, minQty ≥ 2. Order create resolves the unit price server-side (highest tier with minQty ≤ qty); escrow split uses the resolved unit. HiCar extension. |
| 26 | `Lead_Time_Days` | `leadTimeDays` | 0–365. |
| 27 | `Gallery_URLs` | `images[1..]` | Comma-separated, max 10 total, `https://` only. |
| 28 | `Datasheet_URL` | `datasheetUrl` | Rendered as a PDF chip on the product page. |
| 29 | `Install_Guide_URL` | `installGuideUrl` | Same. |
| 30 | `Long_Description` | `description` | Wins over the AI-composed description when present. |
| 31 | `Tags` | `tags[]` | Comma-separated, lowercased, deduped with AI tags. |
| 32 | `Certifications` | `certifications[]` | Comma-separated, max 10; rendered as chips. |

## Header recognition

`sellerImport.controller.js → HEADER_MAP` matches headers
space/punctuation-insensitively and accepts Mongolian aliases (e.g.
`Баталгаа` → `Warranty_Months`, `Үнэ MNT` → `Price_MNT`). A partially
filled sheet imports fine — missing columns fall back to defaults.

**Breaking alias change:** `Make`/`марк` no longer maps to `brand`; per this
standard `Make` is the vehicle make (fitment). Old sheets that used "Make"
for the parts brand must rename that column to `Brand`.

## Dedupe & moderation

- Same-seller duplicate key: `sku` first, then `oem`. `onDuplicate=skip|update`.
- `update` refreshes price/stock/description/tags/compatible + all B2B fields,
  images and fitments; moderation `status` is left untouched.
- All imported products enter as `status=pending` (same as manual create).

## Architecture notes / next phases

- `fitments[]` (denormalised, seller-owned) now carries
  `engineCode`/`transmission`/`driveType`; the normalised
  `compatibility.*` block is still resolved by
  `compatibilityResolver.service.js` for the AI engine.
- MOQ + Order_Multiple are enforced at order create (`order.controller.js`,
  before totals/stock) and mirrored in the cart store (`snapQty`) and the
  product-page quantity stepper.
- Phase 2 candidates: GTIN check-digit validation, structured fitment editor
  in the manual form, data-platform (M2) normalization rules for the new
  fields, condition/warranty facets in shop filters, per-axle "quantity
  needed" hint (TecDoc usage quantity).
- The downloadable template lives in the import wizard
  (`app/seller/products/import` → "B2B загвар татах").
