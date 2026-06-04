# HiCar — Project guide for Claude Code

HiCar is a **Mongolian automotive aftermarket multi-vendor marketplace**
(buyers · sellers · admin): AI-powered search/assistant, QPay + escrow + dispute
protection, and a self-improving **data platform** that tames messy seller data.

> **UI language = Mongolian (Cyrillic).** Every user-facing string must be
> natural Mongolian. Code, comments, identifiers, commit messages = English.

---

## How to work here (read first)

1. **Explore before editing.** Find the real file with Grep/Glob; match the
   existing pattern in that folder. Don't invent new structure.
2. **Plan big changes.** For anything touching money, auth, escrow, or >3 files,
   outline the approach first; prefer small, reviewable diffs.
3. **Edit surgically.** Keep changes minimal and local. Mirror nearby code
   style (see Conventions).
4. **Verify before "done"** — see _Definition of done_. Never claim completion
   on a red `tsc`.
5. **Ask when scope is ambiguous**, but pick the obvious default for reversible
   choices and state it.
6. **Commit/push only when asked.** Then stage explicit paths — never `git add -A`.

---

## Repository layout

| Path | Stack | Notes |
|---|---|---|
| `front-end/` | Next.js 16 (App Router) · React 19 · TS · Tailwind 4 · Zustand | Buyer / seller / admin UI |
| `back-end/` | Express 5 · Mongoose 9 · **JavaScript ESM** (`"type":"module"`) | Legacy marketplace API — the main app |
| `back-end/src/data-platform/` | **TypeScript** (NodeNext) · bounded context | Data platform M1–M5. Separate process; shares Mongo + Redis |
| `docs/HICAR-DATA-PLATFORM-ARCHITECTURE.md` | — | Data-platform design of record |

**Two runtimes on the backend:** the legacy app is `.js` ESM; the data platform
is `.ts`. **Never add TypeScript under `back-end/` root**, and never mix the two
patterns. TS lives *only* under `src/data-platform/`.

---

## Where things live

**Front-end** (alias `@/` = `front-end/`, `@/app` = `front-end/app`)
- Pages: `app/<route>/page.tsx` · layouts `app/<area>/layout.tsx`
- Shared UI: `app/components/` · helpers: `app/lib/` (e.g. `delivery.ts`, `dpApi.ts`)
- HTTP client: **`lib/api.ts`** → `api.get/post/patch/delete`, JWT auto-attached
- State: `store/` (Zustand + persist) · types: `app/types/index.ts`
- i18n: `messages/mn.json` / `en.json` · demo data + `DELIVERY_PRICE`: `lib/data.ts`

**Back-end legacy** (`back-end/`)
- `Controller/*.controller.js` · `Model/*.model.js` · `Routes/*.route.js`
- `Service/*.service.js` · `Middleware/` · `Config/` (`connectDB`, `redis`, `openai`, `cloudinary`)
- `Queue/` (BullMQ) · `index.js` (boot + route mounting) · `scripts/` (smoke/migrations)

**Data platform** (`back-end/src/data-platform/`)
- `shared/` (env, logger, errors, mongo, queues, text) · `api/` (`v1.router`, `errorHandler`)
- `modules/{ingestion,normalization,catalog,feedback,search,stats}/`
- `server.ts` (HTTP) · `workers.ts` (queue consumers) · `scripts/` (`seed-catalog`, `reindex`)

---

## Commands

```bash
# Front-end (cd front-end)
npm run dev            # Next dev server
npx tsc --noEmit       # TYPE-CHECK — required green before "done"
npm run build

# Back-end legacy JS (cd back-end)
npm run dev            # nodemon index.js
node --check <file>    # syntax-check an edited .js file

# Data platform (cd back-end) — TypeScript
npm run dp:typecheck   # tsc --noEmit  (covers ALL of src/) — required green
npm run dp:seed        # seed canonical parts + alias dictionary (run once)
npm run dp:server      # HTTP API on DP_PORT (default 5100), /api/v1
npm run dp:worker      # import + normalize + index workers (separate process)
npm run dp:reindex     # rebuild Typesense index from Mongo
```

### Definition of done
- Front-end touched → `cd front-end && npx tsc --noEmit` is **EXIT 0**.
- Data-platform TS touched → `cd back-end && npx tsc --noEmit` is **EXIT 0**.
- Legacy `.js` touched → `node --check` each edited file passes.
- Reviewed the diff for scope creep + the Hard rules below.
- A multi-step refactor is "correct" only when tsc is green **at the end** —
  intermediate states showing errors is expected, not a failure.

> **No formal test runner.** Verification = `tsc` + `node --check` + the smoke
> scripts under `back-end/scripts/`. Don't invent a test framework.

---

## Hard rules

1. **Never commit** `back-end/.env` or `node_modules/` — both are tracked
   upstream by mistake. Stage explicit source paths; never `git add -A`.
2. **Financial integrity:** order totals + escrow are computed **server-side
   authoritatively** in `back-end/Controller/order.controller.js`. Never trust a
   client-supplied price. Escrow split = item `price × qty` only — **delivery
   fee is NOT escrowed**. Money is **integer MNT** (no decimals).
3. **Mongoose 9:** use `returnDocument: "after"` (not deprecated `new: true`).
4. **Data-platform principle:** raw seller data is **immutable**; AI writes the
   **normalized layer only** (never canonical), always with confidence +
   provenance; **humans + deterministic rules outrank AI**.
5. **Graceful degradation:** AI (Groq/Gemini) and Typesense must no-op cleanly
   when keys/servers are absent — the app must boot and run without them.
6. **Don't run two Claude sessions on the same files** — they race and corrupt.

---

## Environment variables

All optional integrations degrade gracefully if unset.

- **Core:** `MONGO_URI`, `REDIS_URL` (+ `CACHE_TTL_SECONDS`), JWT/token secrets, `PORT`
- **AI:** `GROQ_API_KEY` `GROQ_BASE_URL` `GROQ_MODEL` · `GEMINI_API_KEY` `GEMINI_BASE_URL` `GEMINI_MODEL` · `AI_REQUEST_TIMEOUT_MS` `AI_REQUEST_MAX_RETRIES`
- **Payments:** `QPAY_*` incl. `QPAY_CALLBACK_SECRET` (callback is rejected in prod without it)
- **Media:** `CLOUDINARY_*`
- **Data platform:** `DP_PORT` (5100), `TYPESENSE_HOST/PORT/PROTOCOL/API_KEY/COLLECTION`, `DP_AI_ENRICH`, `DP_SEARCH`
- **Front-end → DP proxy:** `DP_API_URL` (server-side; default `http://localhost:5100/api/v1`)

---

## Key architecture

- **Marketplace flow:** product → cart → checkout → QPay → escrow
  (`pending→paid→processing→shipped→delivered`) → dispute/refund or release.
  Escrow split frozen on the QPay callback; hash-chained financial audit log.
- **Delivery:** per-seller `sellerProfile.deliveryOptions` (duration `hour|day` +
  price MNT, per tier `fast|normal|cheap`). Server resolves the fee
  authoritatively at order time. Shared helper: `front-end/app/lib/delivery.ts`.
- **AI stack:** Groq (fast text) + Gemini (vision) via the OpenAI SDK
  (`back-end/Config/openai.js`); wrapped by security / fallback / reflection
  services.
- **Infra:** BullMQ queues + Redis; outbox pattern for notifications & search
  indexing; rate limiting + helmet on sensitive routes.

### Data platform (raw → normalized → canonical → search)
- **M1 raw spine:** `raw_products` (immutable), CSV/Excel import, content-hash dedupe.
- **M2 normalization:** deterministic-first pipeline (clean → OEM → alias →
  vehicle → confidence → link) → `normalized_products`, each field
  `{value, confidence, source, evidence}`, versioned.
- **M3 self-improving loop:** corrections → `part_aliases` growth + review queue
  + hash-chained `change_log`. Human edits **carry forward** on re-normalization.
- **M4 AI enrich:** Groq fills **only unresolved** fields, confidence capped 0.6,
  partType constrained to the catalog. Fully optional.
- **M5 search:** Typesense read model (CQRS), synced via the `dp:index` queue
  (outbox). Typo-tolerant + multilingual + alias recall.
- **Admin UI:** `/admin/normalization` (review queue + overview), `/admin/import`
  (import wizard). The browser reaches the DP **only** through the same-origin
  proxy `app/api/dp/[...path]` + `app/lib/dpApi.ts` — never the DP port directly.

---

## Conventions & gotchas

- **Theme:** blue + amber accents (no violet/fuchsia). White cards,
  `border-gray-200`, `rounded-2xl`, small text (`text-[13px]`/`[11px]`), inline
  feedback banners.
- **Hydration:** persisted Zustand stores gate UI on `_hasHydrated` to avoid SSR
  mismatch. React 19: avoid sync `setState` in effect bodies — use
  `queueMicrotask` or the existing `// eslint-disable-next-line react-hooks/set-state-in-effect` pattern.
- **Data-platform TS:** NodeNext ESM → **relative imports MUST end with `.js`**;
  ioredis uses the **named** import `import { Redis } from "ioredis"`.
- **Never trust client money/auth.** Re-derive server-side.
- **Mongolian-not-English** for any UI copy, toasts, errors shown to users.
