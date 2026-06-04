/**
 * Search query layer. Handles the messy-query reality:
 *   • typo tolerance (num_typos) — "headlite" still finds Headlight,
 *   • multilingual recall — the query is searched as-is AND transliterated to
 *     Cyrillic, across both script-specific indexed fields,
 *   • alias recall — aliasText carries slang/translit forms of the part,
 *   • ranking — best text match first, then confidence (cleaner data wins ties).
 */

import { getTypesense, searchEnabled } from "./typesense.client.js";
import { env } from "../../shared/env.js";
import { normalizeText, transliterateLatinToCyrillic } from "../../shared/text.js";
import { UpstreamError } from "../../shared/errors.js";
import type { ListingDoc } from "./listing.projection.js";

export interface SearchParams {
  q: string;
  brand?: string;
  generation?: string;
  inStock?: boolean;
  priceMin?: number;
  priceMax?: number;
  page?: number;
  perPage?: number;
}

export interface SearchHit {
  document: ListingDoc;
  textMatch: number;
}

export interface SearchResult {
  found: number;
  page: number;
  hits: SearchHit[];
}

function escapeFilterValue(v: string): string {
  // Backtick-wrap so spaces / special chars in a facet value are literal.
  return "`" + v.replace(/`/g, "") + "`";
}

export async function search(params: SearchParams): Promise<SearchResult> {
  const client = getTypesense();
  if (!searchEnabled() || !client) {
    throw new UpstreamError("Хайлтын систем идэвхгүй байна (Typesense тохируулагдаагүй)");
  }

  const q = normalizeText(params.q || "");
  const translit = transliterateLatinToCyrillic(q);
  const queryStr = translit && translit !== q ? `${q} ${translit}` : q;

  const filters: string[] = [];
  if (params.brand) filters.push(`brand:=${escapeFilterValue(params.brand)}`);
  if (params.generation) filters.push(`generation:=${escapeFilterValue(params.generation)}`);
  if (params.inStock) filters.push("inStock:=true");
  if (typeof params.priceMin === "number") filters.push(`price:>=${Math.round(params.priceMin)}`);
  if (typeof params.priceMax === "number") filters.push(`price:<=${Math.round(params.priceMax)}`);

  const perPage = Math.min(Math.max(params.perPage ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);

  const res = await client
    .collections<ListingDoc>(env.typesenseCollection)
    .documents()
    .search({
      q: queryStr || "*",
      query_by: "title,canonicalPartName,aliasText,oem,brand,model,titleCyrillic,titleLatin",
      query_by_weights: "5,5,4,5,3,2,2,2",
      filter_by: filters.length ? filters.join(" && ") : undefined,
      sort_by: "_text_match:desc,confidence:desc",
      num_typos: 2,
      per_page: perPage,
      page,
    });

  const hits: SearchHit[] = (res.hits ?? []).map((h) => ({
    document: h.document as ListingDoc,
    textMatch: h.text_match ?? 0,
  }));

  return { found: res.found ?? 0, page, hits };
}
