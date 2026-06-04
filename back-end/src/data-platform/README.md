# HiCar Data Platform — M1–M5

TypeScript bounded-context module. **M1** = immutable raw ingestion; **M2** =
rules-based normalization (confidence + provenance); **M3** = the
human-in-the-loop feedback loop that turns corrections into dictionary growth;
**M4** = optional AI enrichment that gap-fills what the rules can't; **M5** =
Typesense search read model (typo-tolerant, multilingual). See the full design in
[`docs/HICAR-DATA-PLATFORM-ARCHITECTURE.md`](../../../docs/HICAR-DATA-PLATFORM-ARCHITECTURE.md).

It runs as **two standalone processes** (API + workers) that share the same
MongoDB + Redis as the legacy JS backend (`MONGO_URI`, `REDIS_URL`).

## What M1 delivers

- `raw_products` — **immutable** Layer-1 store (what the seller said, kept forever).
- `import_jobs` — bulk-upload progress tracking.
- `normalized_products` — Layer-2, **populated by the M2 pipeline** with per-field confidence + provenance.
- `canonical_parts` + `part_aliases` — Layer-3 governed reference data (seeded; grows via corrections in M3).
- Ingestion API (manual + CSV/Excel) → writes RAW → enqueues normalization.
- Idempotent re-imports via a unique `{sellerId, contentHash}` index.
- BullMQ `dp:import` + `dp:normalize` queues with retry/backoff/DLQ defaults.
- Rules-based normalization worker (see **Normalization (M2)** below).

## Run

```bash
# from back-end/
npm run dp:typecheck     # tsc --noEmit  (CI gate)
npm run dp:seed          # seed canonical parts + alias dictionary (run once)
npm run dp:server        # API on DP_PORT (default 5100)
npm run dp:worker        # import + normalize + index workers (separate process)
npm run dp:reindex       # rebuild the Typesense index from Mongo (M5)
npm run dp:build         # compile to dist/ for production (node dist/data-platform/server.js)
```

Search (M5) needs a Typesense server + `TYPESENSE_API_KEY` (+ `TYPESENSE_HOST`).
Without it, indexing and `/search` no-op gracefully — the rest of the platform
is unaffected.

> Run `dp:seed` before `dp:worker` — the normalization pipeline's alias stage
> reads the dictionary it seeds. Without it, products fall to `needs_review`.

Requires `MONGO_URI` and `REDIS_URL` in `back-end/.env` (already used by the
legacy backend).

## API (`/api/v1`)

| Method | Path | Body / Params | Purpose |
|---|---|---|---|
| POST | `/ingest/products` | JSON (see below) | Manual single product → 202 `{rawProductId, duplicate}` |
| POST | `/ingest/import` | multipart: `file` + `sellerId` | CSV/Excel → 202 `{jobId}` |
| GET | `/ingest/import/:id` | — | Import job progress |
| GET | `/raw/:id` | — | Inspect a raw product |
| GET | `/normalized/:rawId` | — | Latest interpretation + confidence |
| GET | `/review/queue` | `?status=&limit=&skip=` | Confidence-ranked items to review (M3) |
| POST | `/feedback/corrections` | JSON (see below) | Apply a correction → grows dictionary (M3) |
| GET | `/feedback/corrections/:normalizedId` | — | Correction audit trail (M3) |
| GET | `/changelog/:entity/:entityId` | — | Hash-chained version history (M3) |
| GET | `/search` | `?q=&brand=&inStock=&priceMin=&priceMax=&page=` | Typo-tolerant multilingual search (M5) |
| GET | `/health` | — | Liveness |

### Correction example (the flywheel)

```bash
curl -X POST http://localhost:5100/api/v1/feedback/corrections \
  -H 'Content-Type: application/json' \
  -d '{
    "normalizedProductId": "…",
    "field": "partType",
    "newValue": "Headlight",
    "rawToken": "gerel",
    "correctedBy": "5f1d7e2b9c4a3b1a2c3d4e5f",
    "role": "admin"
  }'
```

This sets partType=Headlight (human, confidence 1.0), upserts `gerel → Headlight`
into `part_aliases`, and **re-normalizes every other listing containing
"gerel"** — which now resolve deterministically. Returns `{ aliasLearned,
reprocessQueued }`.

### Manual ingest example

```bash
curl -X POST http://localhost:5100/api/v1/ingest/products \
  -H 'Content-Type: application/json' \
  -d '{
    "sellerId": "5f1d7e2b9c4a3b1a2c3d4e5f",
    "rawTitle": "prius30 gerel usa",
    "rawPrice": "120,000₮",
    "stockQty": 3
  }'
```

The dirty title `prius30 gerel usa` is stored verbatim in `raw_products`.
M2 will interpret it (→ Toyota Prius XW30 Headlight) with a confidence score —
without ever mutating this raw row.

### Bulk import example

```bash
curl -X POST http://localhost:5100/api/v1/ingest/import \
  -F 'sellerId=5f1d7e2b9c4a3b1a2c3d4e5f' \
  -F 'file=@products.xlsx'
# → { "ok": true, "jobId": "..." }   then poll GET /ingest/import/:jobId
```

Column headers are matched loosely (English + Mongolian Cyrillic/Latin);
unrecognized columns are preserved in `rawAttributes`.

## Layout

```
src/data-platform/
├── shared/        env, logger, errors, mongo, queues (BullMQ + ioredis)
├── modules/
│   ├── ingestion/      rawProduct + importJob models, dto, parser, service,
│   │                   controller, routes, import.queue
│   └── normalization/  normalizedProduct model, normalize.queue, worker (stub)
├── api/           v1.router, errorHandler
├── server.ts      HTTP API process
└── workers.ts     queue-consumer process
```

## Production notes

- `sellerId` is accepted in the request for standalone M1; wire it to the
  legacy JWT auth before exposing publicly.
- The API and worker are separate processes by design — scale workers
  horizontally; the API stays latency-light.
- `dist/` is git-ignored; build in CI/CD before `node dist/...`.

## Normalization (M2)

Rules-only pipeline (`modules/normalization/`). Deterministic-first ordering —
cheap, explainable signals before anything else:

| Stage | What | Source / confidence |
|---|---|---|
| 1 clean | NFC + lowercase + tokenize + Latin→Cyrillic translit | — |
| 2 oem | OEM from `rawOem` field, else regex from title | `oem` 0.98 / `regex` 0.9 |
| 3 alias | n-gram lookup vs `part_aliases` (cached) → partType + canonical link | `alias` ≤0.95 |
| 4 vehicle | brand / model / generation from chassis codes (`prius30`→Prius XW30) | `vehicleParser` 0.75–0.85 |
| 5 aiEnrich | **(M4, optional)** Groq fills ONLY unresolved fields; partType constrained to catalog | `ai` ≤0.6 (discounted) |
| 6 confidence | fuse (partType anchor + bonuses) → overall + status | — |
| 7 link | resolve `canonicalPartId`; bump alias hitCount | — |

Output: a **versioned** `normalized_products` doc with **per-field
`{value, confidence, source, evidence}`** provenance. Re-running supersedes the
prior version; raw is never touched.

**Confidence routing:** `overall ≥ 0.90` → `auto_approved`; `0 < x < 0.90` →
`needs_review`; nothing resolved → `rejected`.

**AI enrichment (M4):** stage 5 calls Groq (shared `GROQ_*` env) to fill ONLY
fields the rules + human carry-over left blank. It is **fully optional** — with
no `GROQ_API_KEY` (or `DP_AI_ENRICH=false`) the stage is a no-op and the pipeline
runs rules-only. AI output is zod-validated, partType is constrained to the
governed catalog (the model can't invent part types), and confidence is **capped
at 0.6** — strictly below every deterministic prior. Net effect: an AI-only
interpretation can never auto-approve; it always lands in the review queue, where
a human confirm turns it into a permanent alias. AI proposes; humans + rules dispose.

## Self-improving loop (M3)

The flywheel that makes the platform get better with use:

```
 reviewer opens /review/queue   (lowest-confidence items first, with raw context)
        │
        ▼  POST /feedback/corrections { field, newValue, rawToken }
        │
        ├─ set field = human value (confidence 1.0) → re-score → save
        ├─ record Correction + hash-chained change_log entry
        ├─ if partType + rawToken: UPSERT part_aliases  ("gerel" → Headlight)  ◄── the win
        │      └─ next occurrence resolves deterministically, no AI
        └─ re-normalize OTHER raws containing the token → they improve now
```

**Human is authoritative.** A corrected field is stored with `source: "human"`,
and the pipeline **carries human fields forward on every re-normalization** — so
the flywheel's reprocessing can never clobber a correction.

**`change_log`** is hash-chained (each entry hashes the previous), giving
tamper-evident, auditable, reversible history of every governance action — the
same pattern as the legacy financialAudit log.

**Endpoints:** `GET /review/queue`, `POST /feedback/corrections`,
`GET /feedback/corrections/:id`, `GET /changelog/:entity/:id`.

## Search (M5)

Typesense is the **read model** (CQRS): MongoDB is the write source of truth;
Typesense is derived and disposable (rebuild any time with `dp:reindex`).

- **Sync via queue-as-outbox.** The pipeline (and corrections) enqueue `dp:index`
  after writing a normalized listing; the indexer worker upserts the projection.
  BullMQ gives durable, retried, decoupled delivery — search survives Typesense
  downtime (jobs replay).
- **Indexed = the projection, never raw.** Each doc joins normalized fields +
  raw price/stock/seller + the part's **alias surface forms** (`aliasText`), and
  is keyed by `rawProductId` so re-normalization REPLACES rather than duplicates.
  Only publishable statuses (`auto_approved` / `needs_review`) are indexed;
  `rejected` / `superseded` are deleted.
- **Messy-query handling.** Typo tolerance (`num_typos: 2`), the query searched
  as-is AND transliterated to Cyrillic across script-specific fields, alias
  recall (so "gerel" finds Headlight), ranking by text-match then confidence.

**Why Typesense over Elasticsearch:** first-class typo tolerance (essential for
this data), single-binary ops, native hybrid vector for later semantic search,
low cost at MN scale. ES is revisited only at far larger scale / complex
relevance needs.

**Endpoint:** `GET /search?q=prius30 gerel&inStock=true&page=1`.

## Next: M6

- **M6** — cross-listing dedupe (embeddings) + fitment formalization + ops
  dashboards (queue depth, confidence distribution, auto-approve rate).
- Hardening: change_log CAS lock (concurrency), demand-weighted review queue
  (legacy searchLog signal), seller-score ranking (User.trustScore → index),
  vehicle/OEM alias tables, Gemini vision for image→attribute enrichment.
