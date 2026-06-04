/**
 * STAGE 3 — ALIAS (deterministic). The cheap, high-precision core: look up the
 * cleaned tokens (and their transliteration) against the part_aliases
 * dictionary. Multi-word aliases ("front light", "тоормосны диск") are matched
 * via n-grams. The winning alias also yields the canonical link for free —
 * `part_aliases.canonicalPartId`.
 */

import { Types } from "mongoose";
import { getAliasMap, type AliasEntry } from "../../catalog/aliasCache.js";
import { ngrams } from "../../../shared/text.js";
import type { PipelineContext } from "../pipeline.types.js";

export async function stageAlias(ctx: PipelineContext): Promise<void> {
  const map = await getAliasMap();
  if (map.size === 0) return;

  const candidates = [...ngrams(ctx.tokens, 3), ...ngrams(ctx.cyrillicTokens, 3)];

  let best: { entry: AliasEntry; key: string } | null = null;
  for (const candidate of candidates) {
    const entry = map.get(candidate);
    if (entry && (!best || entry.weight > best.entry.weight)) {
      best = { entry, key: candidate };
    }
  }
  if (!best) return;

  // Alias confidence is capped at the alias-source prior (0.95).
  ctx.fields.partType = {
    value: best.entry.canonicalName,
    confidence: Math.min(0.95, best.entry.weight),
    source: "alias",
    evidence: best.key,
  };
  if (best.entry.canonicalPartId) {
    ctx.canonicalPartId = new Types.ObjectId(best.entry.canonicalPartId);
  }
}
