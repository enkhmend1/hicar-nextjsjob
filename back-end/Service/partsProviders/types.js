/**
 * PartsProvider — external parts catalogue (PartsSouq / Amayama / TecDoc / …).
 *
 * Mirrors the vehicleProviders contract: every implementation is a plain
 * object exposing the same 4 members. To switch providers in production,
 * set PARTS_PROVIDER=<name> and restart — no other file changes.
 *
 *
 *  ──────────────────────────────────────────────────────────────────
 *  CONTRACT
 *  ──────────────────────────────────────────────────────────────────
 *
 *  @typedef {object} PartsProvider
 *
 *  @property {string} name                      Stable id: "partsouq" | "amayama" | "tecdoc" | "mock".
 *  @property {string} displayName               Admin UI label.
 *  @property {boolean} configured               True iff env credentials are present.
 *
 *  @property {(args:{
 *     vehicle: NormalizedVehicle,
 *     englishName: string,         // from AI Translator (api_english_name)
 *     oemSeeds?: string[],         // additional OEM codes to nudge the search
 *  }) => {url:string, method?:"GET"|"POST", headers?:object, body?:string}} buildRequest
 *
 *  @property {(json:unknown, ctx:{ status:number }) => PartsSearchResult} parseResponse
 *
 *
 *  @typedef {object} NormalizedVehicle
 *  @property {string}  manuname
 *  @property {string}  modelname
 *  @property {string=} generation
 *  @property {string=} motorcode
 *  @property {string=} motortype
 *  @property {string=} carname
 *  @property {number|string|null=} externalId
 *
 *  @typedef {object} PartsSearchResult
 *  @property {string[]} oems            Pre-cleaned OEM codes (UPPER, no spaces).
 *  @property {PartsItem[]=} items       Optional rich product previews.
 *  @property {string=}  cursor          For pagination if provider supports it.
 *  @property {object=}  raw             For forensics (small subset only — don't leak).
 *
 *  @typedef {object} PartsItem
 *  @property {string} oem
 *  @property {string} name
 *  @property {string=} brand
 *  @property {string=} price
 *  @property {string=} thumbnail
 *  @property {string=} sourceUrl
 *
 *
 *  ──────────────────────────────────────────────────────────────────
 *  ADDING A NEW PROVIDER
 *  ──────────────────────────────────────────────────────────────────
 *    1. Create  Service/partsProviders/<name>.adapter.js  implementing the 4 members
 *    2. Register it in  Service/partsProviders/registry.js
 *    3. Set PARTS_PROVIDER=<name> in .env (+ provider-specific creds)
 *    4. Done. Cache + retry + circuit-breaker + proxy all stay intact.
 */

export {};
