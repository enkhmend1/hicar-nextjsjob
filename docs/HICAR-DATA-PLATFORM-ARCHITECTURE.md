# HiCar — Data Platform Architecture

> Scalable, self-improving data platform for Mongolia's automotive aftermarket.
> Designed for **dirty seller data as the normal case**, not the exception.

**Status:** Architecture of record. Reconciles the existing HiCar backend with a
TecDoc-class data spine.
**Audience:** Backend/AI engineers extending HiCar past the marketplace MVP.
**Author:** Architecture pass (senior review).

---

## 0. The one idea everything hangs on

> **Raw seller data and canonical truth are two different things and must live in
> two different places. AI is the bridge between them, and the bridge is never the
> truth.**

A seller types `"prius30 gerel usa"`. That string is *ground truth about what the
seller said* — we keep it forever, byte-for-byte. Our interpretation —
`{ Toyota Prius, XW30, Headlight, confidence: 0.82 }` — is a *derived opinion*. It
gets better over time, can be recomputed, and is wrong often enough that we must
always store **how sure we are** and **how we decided**.

Everything below is the machinery to make that separation real at the scale of
millions of listings.

---

## 1. The three-layer data spine

This is the backbone. Every other phase plugs into it.

```
            ┌─────────────────────────────────────────────────────────────┐
            │  LAYER 1 — RAW (immutable)                                    │
   seller → │  raw_products: exactly what the seller submitted.             │
   upload   │  Never mutated by the system. Append + soft-correct only.     │
            │  "Source of truth for SELLER INTENT."                         │
            └───────────────┬─────────────────────────────────────────────┘
                            │  normalization pipeline (idempotent, re-runnable)
                            ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  LAYER 2 — NORMALIZED (derived, versioned, scored)            │
            │  normalized_products: system's best interpretation.           │
            │  Per-field value + confidence + provenance. Links raw→canon.  │
            │  Fully regenerable from RAW. "Source of truth for AI OUTPUT." │
            └───────────────┬─────────────────────────────────────────────┘
                            │  links to (never writes) ──►
                            ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  LAYER 3 — CANONICAL (governed reference data)                │
            │  canonical_parts, vehicles, fitments, part_aliases, oem_*     │
            │  Slow-changing, human-governed (TecDoc-style).                │
            │  "Source of truth for AUTOMOTIVE REALITY."                    │
            └───────────────┬─────────────────────────────────────────────┘
                            │  projection / join
                            ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  READ MODEL — listings (CQRS) → Typesense index               │
            │  raw price/stock + normalized attrs + canonical names/fitment │
            │  This — and only this — is what buyers search and see.        │
            └─────────────────────────────────────────────────────────────┘
```

### Why three collections instead of one "smart" product document

| Concern | One-document approach | Three-layer spine |
|---|---|---|
| Re-run a better model | Original seller text already overwritten → **data loss** | Re-run over RAW any time; zero loss |
| Audit "why did we say Prius?" | No trail | Provenance per field |
| Human correction | Mutates the only copy; next import re-clobbers | Correction lives in canonical/alias; raw untouched; re-normalization respects it |
| Scale reads | Heavy doc, mixed write/read load | Thin read model in Typesense; writes isolated |
| Trust | AI guess and seller fact indistinguishable | Confidence + layer makes trust explicit |

**Rule:** RAW is immutable. NORMALIZED is disposable/regenerable. CANONICAL is
governed. The buyer-facing listing is a *projection*, never hand-edited.

---

## 2. Reconciliation with the existing HiCar backend

HiCar already implements a large share of this. The job is **formalizing the spine
and the search/feedback layers**, not rebuilding. Map of what exists → where it lands:

| Target capability | Already in repo | Action |
|---|---|---|
| Raw preservation (Layer 1) | ❌ `product.model` mixes raw + derived | **NEW** `raw_products` + backfill |
| Normalized layer w/ confidence (Layer 2) | ⚠️ partial: `productEnricher`, `ocrFuzzy` | **NEW** `normalized_products` + provenance |
| Canonical parts + taxonomy | ⚠️ `siteContent` (categories + attributesSchema) | **EXTEND** into `canonical_parts` + `part_aliases` |
| Vehicle dimension | ✅ `manufacturer/vehicleModel/engine/vehicle` models | **REUSE** as Layer-3 vehicle reference |
| OEM support | ✅ `oemMapping`, `oemCross`, `oem.service`, `oemCross.service` | **REUSE** as canonical OEM registry |
| Fitment / compatibility | ✅ `compatibility.service`, `product.fitments` | **FORMALIZE** into `fitments` bridge |
| Latin↔Cyrillic + slang | ✅ `latinMongolian.service` | **REUSE** in normalization stage 1 |
| OEM fuzzy correction | ✅ `ocrFuzzy.service` | **REUSE** in normalization stage 2 |
| Vehicle/chassis parsing | ✅ `vehicleNormalizer`, `vehicleKnowledge` | **REUSE** in normalization stage 4 |
| CSV/Excel import | ✅ `importPreview.service` + commit-v2 | **REWIRE** to write RAW, then enqueue |
| AI stack (Groq + fallback) | ✅ `openai.js`, `aiFallback`, `aiPrompts`, `aiResponse`, `aiRole`, `aiReflection`, `aiSecurity` | **REUSE** as normalization/enrichment AI |
| Translation | ✅ `aiTranslator.service` | **REUSE** for cross-lingual search |
| Search | ⚠️ `smartSearch.service` (Mongo) | **REPLACE/AUGMENT** with Typesense read model |
| Queues + workers | ✅ 6 BullMQ queues, `jobQueue`, `circuitBreaker` | **REUSE** infra; add ingestion/normalize/index queues |
| Redis + rate limit | ✅ `redis.js`, `rateLimit.middleware` | **REUSE** |
| Outbox pattern | ✅ `notificationOutbox.*` | **REUSE** pattern for search-index sync |
| Version history / audit | ✅ `financialAudit` (hash-chained) | **REUSE** pattern for `change_log` |
| Self-improving loop | ⚠️ `trustScore`, `searchLog`, `backgroundAgent` | **EXTEND** into correction→dictionary loop |

**Conclusion:** ~60% of the primitives exist. The missing keystones are: the
explicit **RAW** and **NORMALIZED** collections, the **canonical part/alias
registry**, **Typesense**, and the **correction→dictionary feedback loop**.

---

## 3. Folder structure (TypeScript, modular, clean architecture)

The data platform is a **bounded context**. Recommended: introduce it as a
TypeScript module set (new `data-platform/` service or `src/` tree) that shares
MongoDB + Redis + BullMQ with the existing JS backend. This avoids a risky big-bang
TS migration while letting new, schema-critical code be type-safe.

```
src/
├── modules/                      # one folder per bounded context
│   ├── ingestion/                # Phase 1 — raw intake
│   │   ├── ingestion.controller.ts
│   │   ├── ingestion.service.ts
│   │   ├── ingestion.routes.ts
│   │   ├── importParser.service.ts      # CSV/Excel streaming parser
│   │   ├── dto/ (zod schemas for upload payloads)
│   │   └── rawProduct.schema.ts         # Mongoose model: raw_products
│   │
│   ├── normalization/            # Phase 2 — the pipeline
│   │   ├── normalization.pipeline.ts    # orchestrator (stage runner)
│   │   ├── stages/
│   │   │   ├── 01_clean.ts              # unicode, lowercase, translit
│   │   │   ├── 02_oem.ts               # OEM regex + fuzzy (ocrFuzzy)
│   │   │   ├── 03_alias.ts             # deterministic dictionary lookup
│   │   │   ├── 04_vehicle.ts           # generation/engine parse
│   │   │   ├── 05_aiEnrich.ts          # Groq fill-the-gaps (last resort)
│   │   │   ├── 06_confidence.ts        # fusion + thresholding
│   │   │   └── 07_link.ts              # canonical + duplicate linking
│   │   ├── normalizedProduct.schema.ts  # normalized_products
│   │   └── normalization.worker.ts      # BullMQ processor
│   │
│   ├── catalog/                  # Phase 3 — canonical truth
│   │   ├── canonicalPart.schema.ts
│   │   ├── partAlias.schema.ts
│   │   ├── taxonomy.service.ts
│   │   └── catalog.controller.ts / .routes.ts
│   │
│   ├── vehicles/                 # Phase 5 dimension (reuse existing models)
│   ├── fitment/                  # Phase 5 bridge
│   │   ├── fitment.schema.ts
│   │   └── fitment.service.ts
│   │
│   ├── search/                   # Phase 4
│   │   ├── typesense.client.ts
│   │   ├── indexer.worker.ts            # listing → Typesense (outbox-driven)
│   │   ├── search.service.ts            # query builder
│   │   └── search.controller.ts / .routes.ts
│   │
│   ├── inventory/                # seller stock + price (Layer-1-adjacent)
│   ├── media/                    # image upload/processing/CDN
│   ├── feedback/                 # Phase 8
│   │   ├── correction.schema.ts
│   │   ├── reviewQueue.service.ts
│   │   ├── changeLog.schema.ts          # event-sourced version history
│   │   └── feedback.controller.ts / .routes.ts
│   │
│   └── ai/                       # Phase 6 (wrap existing Groq stack)
│       ├── providers/ (groq.ts, gemini.ts, embeddings.ts)
│       ├── prompts/ (normalization.prompt.ts, dedupe.prompt.ts)
│       ├── aiClient.ts                  # fallback chain + circuit breaker
│       └── confidence.ts
│
├── shared/
│   ├── config/        # env, typed config object
│   ├── db/            # mongo connection, indexes
│   ├── redis/         # client + cache helpers
│   ├── queue/         # BullMQ factory, DLQ, retry policy
│   ├── logger/        # pino structured logger + request id
│   ├── errors/        # AppError hierarchy + error middleware
│   ├── validation/    # zod helpers
│   ├── events/        # domain event bus / outbox
│   └── types/         # cross-module domain types
│
├── workers/           # worker entrypoint (separate process from API)
├── api/               # http bootstrap: app.ts, middleware wiring, v1 router
└── server.ts
```

**Clean-architecture rule:** `controller → service → repository`. Domain types in
`shared/types` never import Mongoose. Mongoose lives only in `*.schema.ts` +
repositories. Zod validates at the HTTP edge (DTO) **and** at AI-output boundaries.

---

## 4. MongoDB schemas

TypeScript interfaces shown; Mongoose models mirror them. Indexes are part of the
design, not an afterthought.

### 4.1 Layer 1 — `raw_products` (immutable)

```ts
interface RawProduct {
  _id: ObjectId;
  sellerId: ObjectId;
  source: "manual" | "csv" | "excel" | "api" | "scrape";
  importJobId?: ObjectId;          // batch provenance

  // EXACTLY as submitted — never normalized, never overwritten
  rawTitle: string;
  rawDescription?: string;
  rawBrand?: string;
  rawCategory?: string;
  rawPrice?: string;               // string: sellers type "120,000₮", "120k"
  rawOem?: string;
  rawAttributes?: Record<string, string>;  // any extra columns from CSV
  images: string[];                // CDN URLs after media pipeline

  // commercial facts the seller is authoritative on (kept raw-side)
  price?: number;                  // parsed money (cents/MNT int) — best-effort
  currency: "MNT";
  stockQty?: number;

  contentHash: string;             // sha256(seller + normalized payload) — dedupe
  status: "received" | "normalizing" | "normalized" | "failed";
  createdAt: Date;
  updatedAt: Date;                 // only status/media may change; payload frozen
}
```
Indexes: `{ sellerId, contentHash }` **unique** (idempotent re-import),
`{ status }`, `{ importJobId }`, `{ createdAt }`.

> Immutability is enforced in the repository layer: the only mutable fields are
> `status`, `images`, `updatedAt`. Any "edit" by a seller creates a **new** raw
> revision (or a correction in Layer 3) — the original is never destroyed.

### 4.2 Layer 2 — `normalized_products` (derived, scored, versioned)

```ts
interface FieldResolution<T> {
  value: T | null;
  confidence: number;              // 0..1
  source: "alias" | "regex" | "oem" | "vehicleParser" | "ai" | "human";
  evidence?: string;               // the token/rule/model that decided
}

interface NormalizedProduct {
  _id: ObjectId;
  rawProductId: ObjectId;          // 1:1 with current raw revision
  sellerId: ObjectId;
  version: number;                 // bumped each re-normalization
  pipelineVersion: string;        // which pipeline/model produced this

  canonicalPartId?: ObjectId | null;   // link to Layer 3 (null = unmatched)
  canonicalBrand: FieldResolution<string>;
  canonicalModel: FieldResolution<string>;
  generation: FieldResolution<string>;     // "XW30"
  partType: FieldResolution<string>;       // "Headlight"
  oem: FieldResolution<string>;
  attributes: Record<string, FieldResolution<string>>;

  overallConfidence: number;
  status: "auto_approved" | "needs_review" | "rejected" | "superseded";
  duplicateOf?: ObjectId | null;   // points at the surviving canonical listing
  createdAt: Date;
  updatedAt: Date;
}
```
Indexes: `{ rawProductId, version }`, `{ canonicalPartId }`, `{ status }`,
`{ overallConfidence }`, `{ oem.value }`, `{ sellerId }`.

### 4.3 Layer 3 — canonical reference data

```ts
interface CanonicalPart {
  _id: ObjectId;
  canonicalPartName: string;       // "Headlight"
  category: string;                // taxonomy node id
  partNumberFormats?: string[];    // regex hints for OEM extraction
  attributesSchema?: AttributeDef[]; // expected attrs (side, position…)
  createdBy: "system" | "admin";
  createdAt: Date; updatedAt: Date;
}

interface PartAlias {                // the heart of the self-improving loop
  _id: ObjectId;
  alias: string;                   // "gerel", "headlamp", "front light", "гэрэл"
  lang: "en" | "mn-cyrl" | "mn-latn" | "slang";
  canonicalPartId: ObjectId;
  weight: number;                  // precision prior (human=1.0, mined=0.7)
  addedBy: "system" | "admin" | "seller" | "mined";
  hitCount: number;                // usage telemetry
  createdAt: Date;
}

interface Fitment {                 // Phase 5 — TecDoc-style linkage bridge
  _id: ObjectId;
  canonicalPartId: ObjectId;
  brand: string; model: string;
  generation?: string;             // "XW30"
  engineCode?: string;             // "2ZR-FXE"
  yearFrom?: number; yearTo?: number;
  oem?: string;                    // OEM that proves this fitment
  confidence: number;              // deterministic(OEM)=1.0; parsed<1.0
  source: "oem" | "parsed" | "human";
}
```
Indexes: `part_aliases { alias, lang }` (lookup hot path) + `{ canonicalPartId }`;
`fitments { brand, model, generation }`, `{ canonicalPartId }`, `{ oem }`.

Vehicle dimension (`manufacturer`, `vehicleModel`, `engine`, `vehicle`) — **reuse
existing models** as the Layer-3 vehicle reference.

### 4.4 Operational collections

```ts
interface Correction {              // every human fix = a training signal
  _id: ObjectId;
  normalizedProductId: ObjectId;
  field: string;                   // "partType"
  oldValue: string | null; newValue: string;
  rawToken?: string;               // "gerel"  → feeds alias dictionary
  correctedBy: ObjectId; role: "admin" | "seller";
  appliedToDictionary: boolean;
  createdAt: Date;
}

interface ChangeLogEntry {          // event-sourced version history (Phase 8)
  _id: ObjectId;
  entity: "canonical_part" | "fitment" | "normalized_product" | "alias";
  entityId: ObjectId;
  op: "create" | "update" | "delete" | "merge";
  before?: unknown; after?: unknown;
  actor: ObjectId | "system";
  prevHash?: string; hash: string; // hash-chained (reuse financialAudit pattern)
  createdAt: Date;
}

interface ImportJob {
  _id: ObjectId; sellerId: ObjectId;
  filename: string; totalRows: number;
  processed: number; failed: number;
  status: "queued" | "parsing" | "ingesting" | "done" | "failed";
  errors: { row: number; reason: string }[];
  createdAt: Date; finishedAt?: Date;
}
```

---

## 5. Phase 1 — Raw ingestion API

REST, versioned `/api/v1`. Three intake paths, **all land in `raw_products` first**.

| Method | Endpoint | Purpose | Mode |
|---|---|---|---|
| POST | `/ingest/products` | Manual single product | sync insert → enqueue normalize |
| POST | `/ingest/import` | CSV/Excel upload | async → returns `jobId` |
| GET | `/ingest/import/:jobId` | Import progress | poll |
| GET | `/raw/:id` | Inspect raw | debug/admin |
| GET | `/normalized/:id` | Inspect interpretation + confidence | admin |
| POST | `/media/upload` | Image → CDN, returns URL | sync |

**Ingestion flow (single):**
```
POST /ingest/products
  → zod-validate DTO (lenient: most fields optional/string)
  → parse money best-effort (keep rawPrice string too)
  → compute contentHash; upsert raw_products (dedupe)
  → status="received"; enqueue normalize:{rawProductId}
  → 202 Accepted { rawProductId }
```

**Import flow (CSV/Excel):** stream rows (never load whole file), map columns
loosely, **batch-insert raw** (e.g. 500/insertMany), enqueue a normalize job per
row (or per batch), update `ImportJob` counters. Reuse `importPreview.service`'s
column-mapping/conflict logic but **point its output at `raw_products`** instead of
`products`. Backpressure: bounded queue concurrency + provider rate limits.

**Validation philosophy:** the ingestion DTO is *deliberately permissive*. Dirty
data is the use case — we accept almost anything and let the pipeline sort it out.
Hard rejects only for: missing sellerId, no title at all, hostile payload size.

**Error handling:** `AppError` hierarchy (`ValidationError 400`, `NotFound 404`,
`ConflictError 409`, `UpstreamError 502`). Central error middleware → sanitized
client message + structured log with `requestId`. Partial-batch imports never fail
the whole job; per-row errors collect in `ImportJob.errors`.

---

## 6. Phase 2 — Normalization pipeline

**Design principle: deterministic first, AI last.** Rules are cheap, explainable,
and high-precision. AI is expensive, opaque, and probabilistic — so it only touches
what rules couldn't resolve, and its output is always discounted.

```
RAW row
  │
  ▼  Stage 1  CLEAN          unicode NFC, lowercase, strip noise,
  │                          Latin↔Cyrillic  (reuse latinMongolian.service)
  ▼  Stage 2  OEM            extract OEM via regex + fuzzy correct
  │                          (reuse ocrFuzzy.service). OEM = highest signal.
  ▼  Stage 3  ALIAS          deterministic dictionary lookup against
  │                          part_aliases: "gerel"→Headlight, conf≈0.95
  ▼  Stage 4  VEHICLE        parse "prius30/xw30" → Toyota Prius XW30
  │                          (reuse vehicleNormalizer / vehicleKnowledge)
  ▼  Stage 5  AI ENRICH      ONLY unresolved fields → Groq JSON mode.
  │                          Returns {field, value, confidence}. (aiFallback)
  ▼  Stage 6  CONFIDENCE     fuse per-field; deterministic outranks AI;
  │                          overall = weighted min/avg → threshold
  ▼  Stage 7  LINK + DEDUPE  match canonical_part (OEM exact → fuzzy);
  │                          detect duplicate listing (OEM + fitment + name)
  ▼
  persist normalized_products (value+confidence+source per field) + status
```

### Confidence model

- **Per field** `FieldResolution.confidence`, plus an **overall** score.
- Source priors: `human 1.0 > oem 0.98 > alias 0.95 > regex 0.9 > vehicleParser 0.85 > ai 0.6×self_reported`.
- AI self-reported confidence is **multiplied by a discount** (it is systematically
  overconfident). Never let raw AI confidence exceed a deterministic match.
- **Routing thresholds:**
  - `overall ≥ 0.90` → `auto_approved` → publish.
  - `0.60 ≤ overall < 0.90` → publish **but** add to review queue (flagged).
  - `overall < 0.60` → `needs_review`, **held** from search until reviewed.
- Confidence is stored, never discarded — it drives the review queue priority and
  search ranking penalties.

### Duplicate detection (multi-signal, cheap→expensive)

1. **OEM exact** → same canonical part (deterministic).
2. **Trigram / token-set** similarity on normalized name within same fitment.
3. **Embedding cosine** (Gemini/Groq embeddings) for the residual hard cases.
   Two listings ≠ merged automatically — they're *linked* (`duplicateOf`) so each
   seller keeps their own price/stock; the catalog dedupes the *part*, not the
   *offer* (eBay Motors model: many offers, one part).

### Idempotency & re-runs

Normalization is a **pure function of (RAW, pipelineVersion, dictionaries)**.
Re-running with a better model/dictionary produces a new `version` and supersedes
the old normalized doc — raw is untouched, history is preserved in `change_log`.

---

## 7. Phase 3 — Canonical catalog

- **Taxonomy:** category tree → part types. Seeded from existing `siteContent`
  categories + `attributesSchema`. Each `CanonicalPart` belongs to a taxonomy node.
- **Alias system** (`part_aliases`): multilingual + slang, weighted by precision.
  This collection is the **single most valuable asset** in the platform — it is
  where human knowledge accumulates and where "learning" mostly happens (cheaply,
  without retraining). Loaded hot into Redis for stage-3 lookups.
- **OEM registry:** reuse `oemMapping` + `oemCross` (cross-references / supersessions).
  OEM is the deterministic key that ties part ↔ fitment ↔ offer together.
- **Governance:** only admins (and high-trust automated promotions) mutate canonical
  data; every mutation is `change_log`-recorded and reversible.

---

## 8. Phase 4 — Search architecture

**Decision: Typesense (not Elasticsearch) for now.** Rationale:

| Criterion | Typesense | Elasticsearch |
|---|---|---|
| Typo tolerance (critical for `"gerel"`/`"prius30"`) | Built-in, first-class | Configurable, fiddly |
| Ops burden | Single binary, low | JVM, cluster, heavy |
| Synonyms / multilingual | Native synonyms API | Powerful but complex |
| Vector / hybrid (semantic-ready) | Native hybrid (kw+vector) | Native, more knobs |
| Cost at MN scale | Low | High |
| When to switch | — | If we need advanced relevance tuning / >tens of millions docs / complex aggregations |

**What gets indexed:** the **read-model projection**, never raw. Each Typesense doc =
`{ listingId, canonicalPartName, brand, model, generation, oem, sellerId,
sellerScore, price, inStock, attrs…, name_mn_cyrl, name_mn_latn, embedding[] }`.

**Sync (CQRS):** Mongo is the write source of truth; Typesense is a derived read
store. On any change to a published listing → emit an **outbox event** (reuse the
existing `notificationOutbox` pattern) → `indexer.worker` upserts to Typesense.
This decouples search availability from write latency and survives Typesense
downtime (events replay).

**Query handling for `"prius30 gerel"`:**
1. Transliterate + expand query (Latin↔Cyrillic) at query time.
2. Apply alias synonyms (`gerel`↔`headlight`) loaded into Typesense synonyms.
3. Keyword search with typo tolerance + optional vector leg (hybrid) for semantics.
4. Rank by relevance × `sellerScore` × stock × confidence-penalty.
5. OEM-looking tokens → exact-match boost (deterministic intent).

**Multilingual:** index parallel fields for Cyrillic and Latin Mongolian, plus the
English canonical name; query hits any. `aiTranslator.service` backfills English for
cross-lingual recall.

---

## 9. Phase 5 — Fitment system

A **bridge collection** (`fitments`) — many parts ↔ many vehicles, TecDoc-style.

- **Deterministic path (best):** OEM → fitment via `oemMapping`/`oemCross`.
  `confidence = 1.0`.
- **Probabilistic path:** parsed `{brand, model, generation, engine, years}` from
  normalization → candidate fitment, `confidence < 1.0`, flagged for review.
- **Buyer "fits my car" filter:** `GET /fitment/vehicle/:vehicleId` → resolves the
  vehicle's generation/engine → returns compatible `canonicalPartId`s → search
  filters listings by that set. (Formalizes the existing `compatibility.service` +
  `/vehicle/compatible`.)
- Year ranges + generation + engine code are all first-class so "2010–2015 Prius
  XW30 2ZR-FXE" resolves precisely.

---

## 10. Phase 6 — AI layer

**Non-negotiable rule: AI writes to Layer 2 (normalized) with confidence +
provenance. AI never writes Layer 3 (canonical) directly.** Canonical promotion
requires either a high-confidence auto-approve policy or a human.

| Responsibility | Model / method | Notes |
|---|---|---|
| Normalization gap-fill | **Groq** (fast, JSON mode) | reuse `openai.js` + `aiFallback`; cheap, low-latency |
| Higher-accuracy enrich / vision (image→attrs) | **Gemini** | for hard cases + image understanding |
| Embeddings (dedupe, semantic search) | Gemini/Groq embeddings | stored on listing + normalized |
| Translation (cross-lingual search) | `aiTranslator.service` | mn↔en |
| Smart categorization | Groq classifier into taxonomy | confidence-scored |
| Recommendations | co-purchase + fitment + vector similarity | hybrid, not pure-LLM |

- **Provider fallback chain + circuit breaker:** reuse `aiFallback.service` +
  `circuitBreaker.service`. Groq primary → Gemini → deterministic-only degraded mode
  (pipeline still produces a result from rules alone if all AI is down).
- **Prompt safety:** reuse `aiSecurity.service` (injection/jailbreak) on any
  seller-text that reaches a prompt; reuse `aiReflection.service` for confidence.
- **LangGraph:** *optional.* The 7-stage pipeline is currently a linear state runner
  — that's simpler and sufficient. Adopt LangGraph **only if** branching/retry/human-
  in-the-loop edges multiply. Don't add the dependency prematurely (over-engineering
  guard — rule #1).

---

## 11. Phase 7 — Scalability

- **Queues (BullMQ, already in repo):** add `ingestion`, `normalization`,
  `indexing`, `embedding`, `media`, `dedupe`. Each: idempotent processor, retry with
  exponential backoff, **dead-letter queue** for poison messages, concurrency tuned
  per queue.
- **Workers:** run in a **separate process** from the API (`workers/` entrypoint) so
  CPU-heavy normalization never blocks request latency. Scale workers horizontally.
- **Redis (already in repo):** cache the alias dictionary (hot path), canonical
  lookups, search results; back rate limiters; back BullMQ.
- **Batch import:** stream + chunked `insertMany`; fan-out normalize jobs; provider
  **token-bucket rate limiting** so a 50k-row upload can't exhaust Groq quota.
- **Idempotency:** `contentHash` unique key on raw → re-imports are no-ops, not
  duplicates.
- **Monitoring/logging:** `pino` structured logs + `requestId`/`jobId` correlation;
  Bull Board for queue depth/throughput; per-stage metrics (confidence distribution,
  auto-approve rate, AI spend, dedupe rate); OpenTelemetry-ready spans.
- **Degraded modes:** AI down → rules-only normalization (lower confidence, more
  review-queue items). Typesense down → outbox buffers; reads fall back to Mongo.

---

## 12. Phase 8 — Self-improving data system

The flywheel. **Most "learning" is dictionary growth, not model retraining** — and
that's the cheapest, highest-ROI insight in the whole design.

```
 buyer/admin/seller spots wrong interpretation
        │
        ▼
 POST /feedback/corrections  (field, newValue, rawToken)
        │
        ├─►  immediate: write Correction + ChangeLogEntry (versioned, reversible)
        │
        ├─►  if rawToken present:  upsert part_aliases  (e.g. "gerel"→Headlight)
        │        └─ NEXT time this token appears, stage-3 resolves it
        │           deterministically at conf≈0.95 — NO AI needed.  ◄── the win
        │
        ├─►  re-normalize affected raw rows (enqueue) → confidence jumps
        │
        └─►  periodically: export corrections as labeled set
                 ├─ few-shot prompt augmentation (immediate, no training)
                 └─ optional fine-tune / eval against a golden test set
```

- **Confidence-based review queue:** surface lowest-confidence × highest-traffic
  first (impact-ranked, using `searchLog` demand signals). Reviewers fix the items
  that matter most.
- **Admin + seller correction tools:** sellers can correct their own listings'
  interpretation; admins govern canonical/alias data. Both produce `Correction`s.
- **Version history:** `change_log` is hash-chained (reuse `financialAudit` pattern)
  → full audit + rollback of any canonical/normalized change.
- **Measurement:** track normalization accuracy on a frozen golden set release-over-
  release; alert on regressions. A self-improving system you can't measure is just a
  hopeful one.

---

## 13. Engineering rules honored (traceability)

| Rule | How the design satisfies it |
|---|---|
| 1. Not a toy | Bounded contexts, CQRS read model, DLQs, governance, measurement |
| 2. Amazon/eBay Motors/TecDoc thinking | Offer≠Part split; fitment bridge; OEM as key; alias registry |
| 3. Data architecture > UI | Entire doc is data spine; UI unmentioned by design |
| 4. Data integrity > AI | AI is Layer-2-only, discounted, never source of truth |
| 5. Preserve raw permanently | Layer 1 immutable; corrections never touch raw |
| 6. Tolerate dirty data | Permissive ingestion DTO; rules+AI built to expect mess |
| 7. Millions of products | Queues, workers, Typesense, batch, idempotency, caching |
| 8. Enterprise best practices | Outbox, circuit breaker, DLQ, structured logs, hash-chain audit |
| 9. Clean architecture | controller→service→repo; domain types free of Mongoose |
| 10. Explain decisions | Rationale tables throughout (search, layers, AI, LangGraph) |

---

## 14. Build roadmap (incremental, ship-able slices)

Each milestone is independently valuable and leaves the system working.

1. **M1 — Raw spine.** `raw_products` + ingestion API + rewire CSV import to write
   raw. *Outcome:* nothing is ever lost again. (Foundation; do first.)
2. **M2 — Normalization v1 (rules only).** Stages 1–4 + 6–7, no AI yet. *Outcome:*
   deterministic interpretation + confidence + review queue.
3. **M3 — Canonical + alias registry + feedback loop.** `canonical_parts`,
   `part_aliases`, corrections → dictionary. *Outcome:* the flywheel turns.
4. **M4 — AI enrich (stage 5).** Plug Groq/Gemini into the residue. *Outcome:*
   coverage on the long tail.
5. **M5 — Typesense search.** Indexer worker + query service. *Outcome:* fast,
   typo-tolerant, multilingual search over the read model.
6. **M6 — Fitment formalization + embeddings/semantic + dashboards.**

---

## 15. Future expansion

- **Garages & services** as additional offer types over the same spine (a garage
  "service" is just a non-physical canonical item with its own taxonomy + fitment).
- **Warehouse/multi-location inventory** as a dimension on the offer (seller_inventory
  gains `locationId`, reservations).
- **Supplier/B2B feeds** as another ingestion `source` — same raw→normalized path.
- **Fine-tuned MN-automotive normalization model** once the correction corpus is
  large enough (the self-improving loop generates the training set for free).
- **Pricing intelligence** (fair-price bands per canonical part) from the offer
  graph.

---

### TL;DR

Build the **three-layer spine** (raw → normalized → canonical) with **confidence +
provenance on every derived field**, run **deterministic normalization before AI**,
search a **Typesense read model** synced via **outbox**, and close the loop by
turning **every human correction into an alias-dictionary entry**. ~60% of the
primitives already exist in HiCar; the new keystones are the raw/normalized
collections, the alias registry, Typesense, and the correction flywheel.
