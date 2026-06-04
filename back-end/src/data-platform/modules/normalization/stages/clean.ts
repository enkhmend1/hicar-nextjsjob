/**
 * STAGE 1 — CLEAN. Builds the normalized text + token lists the later stages
 * work on. Combines the highest-signal raw fields (title + brand + category).
 * Produces both the as-written tokens and a transliterated-to-Cyrillic set so
 * Latin input ("gerel") can still hit Cyrillic aliases ("гэрэл").
 */

import { normalizeText, tokenize, transliterateLatinToCyrillic } from "../../../shared/text.js";
import type { PipelineContext } from "../pipeline.types.js";

export function stageClean(ctx: PipelineContext): void {
  const raw = ctx.raw;
  const combined = [raw.rawTitle, raw.rawBrand, raw.rawCategory]
    .filter((v): v is string => Boolean(v))
    .join(" ");

  ctx.cleanedText = normalizeText(combined);
  ctx.tokens = tokenize(combined);
  ctx.cyrillicTokens = tokenize(transliterateLatinToCyrillic(combined));
}
