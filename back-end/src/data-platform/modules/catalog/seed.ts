/**
 * Starter canonical catalog + alias dictionary.
 *
 * Idempotent: safe to run repeatedly (upserts by name / alias pair). This is
 * the cold-start seed; in M3 the dictionary GROWS from human corrections.
 * Aliases deliberately include English + Mongolian Cyrillic + Latin + slang,
 * mirroring how real sellers write ("gerel", "гэрэл", "far").
 */

import { CanonicalPartModel } from "./canonicalPart.model.js";
import { PartAliasModel, type AliasLang } from "./partAlias.model.js";
import { invalidateAliasCache } from "./aliasCache.js";

interface SeedAlias {
  text: string;
  lang: AliasLang;
  weight?: number;
}
interface SeedPart {
  name: string;
  category: string;
  aliases: SeedAlias[];
}

const SEED: SeedPart[] = [
  {
    name: "Headlight",
    category: "lighting",
    aliases: [
      { text: "headlight", lang: "en" }, { text: "headlamp", lang: "en" },
      { text: "front light", lang: "en" }, { text: "гэрэл", lang: "mn-cyrl" },
      { text: "урд гэрэл", lang: "mn-cyrl" }, { text: "фар", lang: "mn-cyrl" },
      { text: "gerel", lang: "mn-latn" }, { text: "urd gerel", lang: "mn-latn" },
      { text: "far", lang: "slang", weight: 0.8 },
    ],
  },
  {
    name: "Tail Light",
    category: "lighting",
    aliases: [
      { text: "tail light", lang: "en" }, { text: "taillight", lang: "en" }, { text: "rear light", lang: "en" },
      { text: "хойд гэрэл", lang: "mn-cyrl" }, { text: "stop gerel", lang: "mn-latn" }, { text: "стоп", lang: "slang", weight: 0.8 },
    ],
  },
  {
    name: "Brake Disc",
    category: "brake",
    aliases: [
      { text: "brake disc", lang: "en" }, { text: "brake rotor", lang: "en" }, { text: "disc", lang: "en", weight: 0.7 },
      { text: "тоормосны диск", lang: "mn-cyrl" }, { text: "диск", lang: "mn-cyrl", weight: 0.7 },
      { text: "toormosny disk", lang: "mn-latn" }, { text: "tormoz disk", lang: "mn-latn" },
    ],
  },
  {
    name: "Brake Pad",
    category: "brake",
    aliases: [
      { text: "brake pad", lang: "en" }, { text: "pads", lang: "en", weight: 0.7 },
      { text: "тоормосны колодк", lang: "mn-cyrl" }, { text: "колодк", lang: "mn-cyrl", weight: 0.7 },
      { text: "toormosny kolodk", lang: "mn-latn" },
    ],
  },
  {
    name: "Oil Filter",
    category: "engine",
    aliases: [
      { text: "oil filter", lang: "en" }, { text: "тосны шүүр", lang: "mn-cyrl" }, { text: "тос шүүр", lang: "mn-cyrl" },
      { text: "tosny shuur", lang: "mn-latn" }, { text: "tos shuur", lang: "mn-latn" }, { text: "shuur", lang: "slang", weight: 0.7 },
    ],
  },
  {
    name: "Air Filter",
    category: "engine",
    aliases: [
      { text: "air filter", lang: "en" }, { text: "агаарын шүүр", lang: "mn-cyrl" },
      { text: "agaaryn shuur", lang: "mn-latn" },
    ],
  },
  {
    name: "Front Bumper",
    category: "body",
    aliases: [
      { text: "front bumper", lang: "en" }, { text: "bumper", lang: "en", weight: 0.7 },
      { text: "урд бампер", lang: "mn-cyrl" }, { text: "бампер", lang: "mn-cyrl", weight: 0.7 },
      { text: "urd bamper", lang: "mn-latn" }, { text: "bamper", lang: "mn-latn", weight: 0.7 },
    ],
  },
  {
    name: "Shock Absorber",
    category: "suspension",
    aliases: [
      { text: "shock absorber", lang: "en" }, { text: "shock", lang: "en", weight: 0.7 }, { text: "strut", lang: "en" },
      { text: "амортизатор", lang: "mn-cyrl" }, { text: "amortizator", lang: "mn-latn" }, { text: "amort", lang: "slang", weight: 0.75 },
    ],
  },
  {
    name: "Side Mirror",
    category: "body",
    aliases: [
      { text: "side mirror", lang: "en" }, { text: "wing mirror", lang: "en" }, { text: "mirror", lang: "en", weight: 0.7 },
      { text: "толь", lang: "mn-cyrl" }, { text: "хажуугийн толь", lang: "mn-cyrl" }, { text: "tol", lang: "mn-latn" },
    ],
  },
  {
    name: "Spark Plug",
    category: "engine",
    aliases: [
      { text: "spark plug", lang: "en" }, { text: "лаа", lang: "mn-cyrl" }, { text: "асаалтын лаа", lang: "mn-cyrl" },
      { text: "laa", lang: "mn-latn" }, { text: "svecha", lang: "slang", weight: 0.75 },
    ],
  },
];

export async function seedCatalog(): Promise<{ parts: number; aliases: number }> {
  let parts = 0;
  let aliases = 0;

  for (const p of SEED) {
    const part = await CanonicalPartModel.findOneAndUpdate(
      { canonicalPartName: p.name },
      { $setOnInsert: { canonicalPartName: p.name, category: p.category, createdBy: "system" } },
      { upsert: true, returnDocument: "after" },
    );
    if (!part) continue;
    parts++;

    for (const a of p.aliases) {
      const res = await PartAliasModel.updateOne(
        { alias: a.text.toLowerCase(), canonicalPartId: part._id },
        {
          $setOnInsert: {
            alias: a.text.toLowerCase(),
            lang: a.lang,
            canonicalPartId: part._id,
            weight: a.weight ?? 0.9,
            addedBy: "system",
            hitCount: 0,
          },
        },
        { upsert: true },
      );
      if (res.upsertedCount > 0) aliases++;
    }
  }

  invalidateAliasCache();
  return { parts, aliases };
}
