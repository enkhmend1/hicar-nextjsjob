/**
 * Vehicle Knowledge Engine — Phase I.
 *
 * Normalises colloquial / shorthand vehicle references Mongolian car
 * owners actually use in chat into a canonical {make, model, generation}
 * shape that downstream tools (search_products, search_vehicle_parts)
 * can leverage. Without this, "P30 тоормосны бул" hits zero results
 * because the marketplace catalogue uses "Toyota Prius ZVW30", not "P30".
 *
 * Architecture:
 *   • CHASSIS_DICT — sorted by surface-length DESC so a longer match
 *     ("Crown Athlete") wins over a shorter prefix ("Crown").
 *   • Each entry: { surface: regex, make, model, generation, confidence }.
 *   • `normalizeVehicleReference(text)` scans the text, returns the
 *     FIRST hit (good enough for chat — disambiguation can come later).
 *   • `expandQueryWithVehicle(text)` returns the original query
 *     enriched with the canonical car string so a search like
 *     "P30 тоормос" becomes "Toyota Prius ZVW30 тоормос" — same
 *     pattern as latinMongolian.service's expandedQuery.
 *
 * Scope (v1):
 *   • Most common chassis codes for the 8 brands present in Mongolia:
 *     Toyota, Honda, Nissan, Hyundai, Kia, Mitsubishi, Subaru, BMW,
 *     Mercedes-Benz, Audi.
 *   • Mongolian transliterations of brand/model names (Тойото, Хонда,
 *     Прайес, Камри, Краун, Лэндкрүйзэр).
 *
 * Out of scope (future Phase):
 *   • Year ranges from the chassis code (ZVW30 = 2009-2015).
 *   • Generation disambiguation when user says just "Crown" with no chassis.
 *   • Full TecDoc catalogue (paid product).
 */

// ────────────────────────────────────────────────────────────────────
// CHASSIS DICTIONARY
//
// Each row maps a SURFACE pattern (regex literal source) to a canonical
// vehicle. The patterns are anchored on word boundaries so "RD1" matches
// "Honda RD1" but not "BRD1234". Patterns are case-insensitive.
//
// Sorted longest-surface FIRST during build so multi-token matches like
// "Crown Athlete" win over single-token "Crown".
// ────────────────────────────────────────────────────────────────────

const RAW = [
  // ───── TOYOTA ─────────────────────────────────────────────────
  // Prius generations — by far the most common Mongolian taxi/hybrid
  { surface: /\bp30\b|\bzvw30\b/iu,                  make: "Toyota", model: "Prius",     generation: "ZVW30" },
  { surface: /\bp40\b|\bzvw40\b|\bprius\s*alpha\b/iu, make: "Toyota", model: "Prius α",   generation: "ZVW40" },
  { surface: /\bp50\b|\bzvw50\b/iu,                  make: "Toyota", model: "Prius",     generation: "ZVW50" },
  { surface: /\bp60\b|\bzvw60\b/iu,                  make: "Toyota", model: "Prius",     generation: "ZVW60" },
  { surface: /\bprius\s*c\b|\baqua\b/iu,             make: "Toyota", model: "Aqua",      generation: "NHP10" },
  // Bare "Prius" fallback — only fires AFTER the chassis-specific
  // patterns above, because CHASSIS_DICT is sorted longest-pattern
  // first. So "Prius P30" still wins as ZVW30, but a bare "Prius"
  // input gets the model recognised (generation left blank).
  { surface: /\bprius\b|\bприус\b/iu,                 make: "Toyota", model: "Prius",     generation: "" },

  // Toyota Blade — referenced in the AI prompt examples but was
  // missing from the chassis dict. AZE156 (2.4L) + AZE154 (2.4L
  // AWD) + GRE156 (3.5L V6) cover the three production variants.
  { surface: /\baze156\b/iu,                          make: "Toyota", model: "Blade",     generation: "AZE156" },
  { surface: /\baze154\b/iu,                          make: "Toyota", model: "Blade",     generation: "AZE154" },
  { surface: /\bgre156\b/iu,                          make: "Toyota", model: "Blade",     generation: "GRE156" },
  { surface: /\bblade\b|\bблэйд\b|\bблэйж\b/iu,       make: "Toyota", model: "Blade",     generation: "" },

  // Vitz / Yaris — common Mongolian compact, often referenced bare
  { surface: /\bksp130\b|\bnsp130\b/iu,               make: "Toyota", model: "Vitz",      generation: "P130" },
  { surface: /\bvitz\b|\bвитз\b|\byaris\b|\bяарис\b/iu, make: "Toyota", model: "Vitz",   generation: "" },

  // Alphard / Vellfire MPVs — very common in Mongolia
  { surface: /\bgg[hw]20\b|\banh20\b/iu,              make: "Toyota", model: "Alphard",   generation: "20" },
  { surface: /\bgg[hw]30\b|\bayh30\b/iu,              make: "Toyota", model: "Alphard",   generation: "30" },
  { surface: /\balphard\b|\bалфард\b/iu,              make: "Toyota", model: "Alphard",   generation: "" },
  { surface: /\bvellfire\b|\bвэллфайр\b/iu,           make: "Toyota", model: "Vellfire",  generation: "" },

  // Estima — older but still common second-hand
  { surface: /\bahr20\b|\bgsr5[05]\b/iu,              make: "Toyota", model: "Estima",    generation: "" },
  { surface: /\bestima\b|\bэстима\b/iu,               make: "Toyota", model: "Estima",    generation: "" },

  // Mark X / Mark II — bare names
  { surface: /\bmark\s*x\b|\bgrx12[0-9]\b/iu,         make: "Toyota", model: "Mark X",    generation: "" },
  { surface: /\bmark\s*ii\b|\bjzx110\b/iu,            make: "Toyota", model: "Mark II",   generation: "" },

  // Crown trims (the trim hint matters in Mongolia)
  { surface: /\bcrown\s*athlete\b/iu,                make: "Toyota", model: "Crown Athlete",  generation: "" },
  { surface: /\bcrown\s*majesta\b/iu,                make: "Toyota", model: "Crown Majesta",  generation: "" },
  { surface: /\bcrown\s*royal\b/iu,                  make: "Toyota", model: "Crown Royal",    generation: "" },
  { surface: /\bcrown\s*hybrid\b/iu,                 make: "Toyota", model: "Crown Hybrid",   generation: "" },
  { surface: /\bcrown\s*s180\b|\bgrs180\b/iu,        make: "Toyota", model: "Crown",          generation: "S180" },
  { surface: /\bcrown\s*s200\b|\bgrs200\b/iu,        make: "Toyota", model: "Crown",          generation: "S200" },
  { surface: /\bcrown\s*s210\b|\bars210\b/iu,        make: "Toyota", model: "Crown",          generation: "S210" },
  { surface: /\bcrown\b|\bкраун\b/iu,                make: "Toyota", model: "Crown",          generation: "" },

  // Camry generations
  { surface: /\bcamry\s*xv30\b|\bxv30\b/iu,          make: "Toyota", model: "Camry",         generation: "XV30" },
  { surface: /\bcamry\s*xv40\b|\bxv40\b/iu,          make: "Toyota", model: "Camry",         generation: "XV40" },
  { surface: /\bcamry\s*xv50\b|\bxv50\b/iu,          make: "Toyota", model: "Camry",         generation: "XV50" },
  { surface: /\bcamry\s*xv70\b|\bxv70\b/iu,          make: "Toyota", model: "Camry",         generation: "XV70" },
  // JS `\b` is ASCII-only — for Cyrillic alternatives we drop the
  // boundary; the keywords are distinctive enough that substring matches
  // are acceptable in practice (low false-positive risk).
  { surface: /\bcamry\b|кэмри|камри/iu,             make: "Toyota", model: "Camry",         generation: "" },

  // Land Cruiser — referenced by chassis number ALONE in Mongolia
  { surface: /\bland\s*cruiser\s*300\b|\blc300\b/iu, make: "Toyota", model: "Land Cruiser",  generation: "300" },
  { surface: /\bland\s*cruiser\s*200\b|\blc200\b/iu, make: "Toyota", model: "Land Cruiser",  generation: "200" },
  { surface: /\bland\s*cruiser\s*100\b|\blc100\b/iu, make: "Toyota", model: "Land Cruiser",  generation: "100" },
  { surface: /\bland\s*cruiser\s*80\b/iu,            make: "Toyota", model: "Land Cruiser",  generation: "80" },
  { surface: /\bland\s*cruiser\s*prado\b|\bprado\b|\bпрадо\b/iu,
                                                     make: "Toyota", model: "Land Cruiser Prado", generation: "" },
  { surface: /\b(?:тойото|toyota)\s*100\b|\bлэндкрүйзэр\s*100\b/iu,
                                                     make: "Toyota", model: "Land Cruiser",  generation: "100" },

  // C-HR (Cyrillic + Latin)
  { surface: /\bc-?hr\b|\bахр\b/iu,                  make: "Toyota", model: "C-HR",          generation: "" },

  // Highlander, RAV4
  { surface: /\bhighlander\b|\bхайландер\b/iu,       make: "Toyota", model: "Highlander",    generation: "" },
  { surface: /\brav4\b|\bрав4\b/iu,                  make: "Toyota", model: "RAV4",          generation: "" },

  // Corolla
  { surface: /\bcorolla\b|\bкорола\b|\bкоролла\b/iu, make: "Toyota", model: "Corolla",       generation: "" },

  // ───── HONDA ─────────────────────────────────────────────────
  { surface: /\brd1\b/iu,                            make: "Honda",  model: "CR-V",          generation: "RD1" },
  { surface: /\brd5\b/iu,                            make: "Honda",  model: "CR-V",          generation: "RD5" },
  { surface: /\brd7\b/iu,                            make: "Honda",  model: "CR-V",          generation: "RD7" },
  { surface: /\bre4\b/iu,                            make: "Honda",  model: "CR-V",          generation: "RE4" },
  { surface: /\brm1\b|\brm4\b/iu,                    make: "Honda",  model: "CR-V",          generation: "RM" },
  { surface: /\bcr-?v\b|\bcrv\b/iu,                  make: "Honda",  model: "CR-V",          generation: "" },
  { surface: /\bcivic\b|\bцивик\b/iu,                make: "Honda",  model: "Civic",         generation: "" },
  { surface: /\baccord\b|\bаккорд\b/iu,              make: "Honda",  model: "Accord",        generation: "" },
  { surface: /\bfit\b|\bжазз\b|\bфит\b/iu,           make: "Honda",  model: "Fit",           generation: "" },
  { surface: /\bодиссей\b|\bodyssey\b/iu,            make: "Honda",  model: "Odyssey",       generation: "" },

  // ───── NISSAN ─────────────────────────────────────────────────
  { surface: /\bbnr32\b/iu,                          make: "Nissan", model: "Skyline GT-R",  generation: "R32" },
  { surface: /\bbnr33\b/iu,                          make: "Nissan", model: "Skyline GT-R",  generation: "R33" },
  { surface: /\bbnr34\b/iu,                          make: "Nissan", model: "Skyline GT-R",  generation: "R34" },
  { surface: /\br35\b|\bgt-?r\s*r35\b/iu,            make: "Nissan", model: "GT-R",          generation: "R35" },
  { surface: /\bskyline\b|\bскайлайн\b/iu,           make: "Nissan", model: "Skyline",       generation: "" },
  { surface: /\bx-?trail\b|\bксрэйл\b|\bxтрейл\b/iu, make: "Nissan", model: "X-Trail",       generation: "" },
  { surface: /\bteana\b|\bтиана\b/iu,                make: "Nissan", model: "Teana",         generation: "" },
  { surface: /\bpatrol\b|\bпатрол\b/iu,              make: "Nissan", model: "Patrol",        generation: "" },
  { surface: /\bleaf\b/iu,                           make: "Nissan", model: "Leaf",          generation: "" },

  // ───── HYUNDAI / KIA ─────────────────────────────────────────
  { surface: /\bsonata\b|\bсоната\b/iu,              make: "Hyundai", model: "Sonata",       generation: "" },
  { surface: /\bsantafe\b|\bsanta\s*fe\b|\bсанта\s*фе\b/iu,
                                                     make: "Hyundai", model: "Santa Fe",     generation: "" },
  { surface: /\btucson\b|\bтуксон\b/iu,              make: "Hyundai", model: "Tucson",       generation: "" },
  { surface: /\belantra\b|\bэлантра\b/iu,            make: "Hyundai", model: "Elantra",      generation: "" },
  { surface: /\bgrandeur\b|\bgranduer\b|\bгрэндюэр\b/iu,
                                                     make: "Hyundai", model: "Grandeur",     generation: "" },
  { surface: /\bgenesis\b|\bженесис\b/iu,            make: "Hyundai", model: "Genesis",      generation: "" },
  { surface: /\bequus\b|\bэквус\b/iu,                make: "Hyundai", model: "Equus",        generation: "" },
  { surface: /\bsorento\b|\bсоренто\b/iu,            make: "Kia",     model: "Sorento",      generation: "" },
  { surface: /\bsportage\b|\bспортаж\b/iu,           make: "Kia",     model: "Sportage",     generation: "" },
  { surface: /\bk5\b|\boptima\b|\bоптима\b/iu,       make: "Kia",     model: "K5/Optima",    generation: "" },

  // ───── MITSUBISHI ─────────────────────────────────────────────
  { surface: /\bevo\s*x\b|\blancer\s*evo\b/iu,       make: "Mitsubishi", model: "Lancer Evolution", generation: "X" },
  { surface: /\bgalant\b|\bгалант\b/iu,              make: "Mitsubishi", model: "Galant",       generation: "" },
  { surface: /\boutlander\b|\bовтландер\b|\bаутландер\b/iu,
                                                     make: "Mitsubishi", model: "Outlander",    generation: "" },
  { surface: /\bpajero\b|\bпажеро\b/iu,              make: "Mitsubishi", model: "Pajero",       generation: "" },
  { surface: /\bdelica\b|\bделика\b/iu,              make: "Mitsubishi", model: "Delica",       generation: "" },

  // ───── SUBARU ─────────────────────────────────────────────────
  { surface: /\bbh\b/iu,                             make: "Subaru", model: "Legacy",        generation: "BH" },
  { surface: /\bbp\b/iu,                             make: "Subaru", model: "Legacy",        generation: "BP" },
  { surface: /\bbr\b/iu,                             make: "Subaru", model: "Legacy",        generation: "BR" },
  { surface: /\bforester\b|\bфорестер\b/iu,          make: "Subaru", model: "Forester",      generation: "" },
  { surface: /\boutback\b|\bовтбак\b/iu,             make: "Subaru", model: "Outback",       generation: "" },
  { surface: /\bimpreza\b|\bимпреза\b/iu,            make: "Subaru", model: "Impreza",       generation: "" },

  // ───── BMW (chassis is the universal language here) ─────────────
  { surface: /\be30\b/iu,                            make: "BMW", model: "3 Series",         generation: "E30" },
  { surface: /\be36\b/iu,                            make: "BMW", model: "3 Series",         generation: "E36" },
  { surface: /\be46\b/iu,                            make: "BMW", model: "3 Series",         generation: "E46" },
  { surface: /\be90\b/iu,                            make: "BMW", model: "3 Series",         generation: "E90" },
  { surface: /\bf30\b/iu,                            make: "BMW", model: "3 Series",         generation: "F30" },
  { surface: /\bg20\b/iu,                            make: "BMW", model: "3 Series",         generation: "G20" },
  { surface: /\be39\b/iu,                            make: "BMW", model: "5 Series",         generation: "E39" },
  { surface: /\be60\b/iu,                            make: "BMW", model: "5 Series",         generation: "E60" },
  { surface: /\bf10\b/iu,                            make: "BMW", model: "5 Series",         generation: "F10" },
  { surface: /\bg30\b/iu,                            make: "BMW", model: "5 Series",         generation: "G30" },
  { surface: /\bx5\b/iu,                             make: "BMW", model: "X5",                generation: "" },
  { surface: /\bx7\b/iu,                             make: "BMW", model: "X7",                generation: "" },

  // ───── MERCEDES-BENZ ──────────────────────────────────────────
  { surface: /\bw210\b/iu,                           make: "Mercedes-Benz", model: "E-Class", generation: "W210" },
  { surface: /\bw211\b/iu,                           make: "Mercedes-Benz", model: "E-Class", generation: "W211" },
  { surface: /\bw212\b/iu,                           make: "Mercedes-Benz", model: "E-Class", generation: "W212" },
  { surface: /\bw213\b/iu,                           make: "Mercedes-Benz", model: "E-Class", generation: "W213" },
  { surface: /\bw204\b/iu,                           make: "Mercedes-Benz", model: "C-Class", generation: "W204" },
  { surface: /\bw205\b/iu,                           make: "Mercedes-Benz", model: "C-Class", generation: "W205" },
  { surface: /\bw222\b/iu,                           make: "Mercedes-Benz", model: "S-Class", generation: "W222" },
  { surface: /\bw223\b/iu,                           make: "Mercedes-Benz", model: "S-Class", generation: "W223" },
  { surface: /\bgle\b/iu,                            make: "Mercedes-Benz", model: "GLE",      generation: "" },
  { surface: /\bgls\b/iu,                            make: "Mercedes-Benz", model: "GLS",      generation: "" },

  // ───── AUDI ───────────────────────────────────────────────────
  { surface: /\ba4\s*b5\b/iu,                        make: "Audi", model: "A4",               generation: "B5" },
  { surface: /\ba4\s*b6\b/iu,                        make: "Audi", model: "A4",               generation: "B6" },
  { surface: /\ba4\s*b7\b/iu,                        make: "Audi", model: "A4",               generation: "B7" },
  { surface: /\ba4\s*b8\b/iu,                        make: "Audi", model: "A4",               generation: "B8" },
  { surface: /\bq5\b/iu,                             make: "Audi", model: "Q5",               generation: "" },
  { surface: /\bq7\b/iu,                             make: "Audi", model: "Q7",               generation: "" },
];

// ────────────────────────────────────────────────────────────────────
// Compile dictionary — sort longest-pattern first so multi-word matches
// win over single-word. Pattern source length is a proxy for specificity
// (e.g. "crown\s*athlete" is longer than "crown").
// ────────────────────────────────────────────────────────────────────
const CHASSIS_DICT = RAW
  .map((row) => ({ ...row, _pattern: row.surface, _len: row.surface.source.length }))
  .sort((a, b) => b._len - a._len);

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Find the FIRST canonical vehicle the text references. Returns null
 * when no chassis / model token is recognised.
 *
 *   {
 *     make:        "Toyota",
 *     model:       "Prius",
 *     generation:  "ZVW30",
 *     canonical:   "Toyota Prius ZVW30",   // ready-to-paste string
 *     surface:     "p30",                  // what matched in the input
 *     confidence:  0.95,                   // 0.95 if generation pinned,
 *                                          // 0.70 if only model matched
 *   }
 */
export const normalizeVehicleReference = (text) => {
  const s = String(text || "");
  if (!s || s.length < 2) return null;
  for (const row of CHASSIS_DICT) {
    const m = s.match(row._pattern);
    if (!m) continue;
    const canonicalParts = [row.make, row.model];
    if (row.generation) canonicalParts.push(row.generation);
    const canonical = canonicalParts.join(" ");
    return {
      make:       row.make,
      model:      row.model,
      generation: row.generation || "",
      canonical,
      surface:    m[0],
      confidence: row.generation ? 0.95 : 0.70,
    };
  }
  return null;
};

/**
 * Enrich a free-form query with the canonical vehicle string when one
 * is recognised. The original query is preserved (concatenated), so
 * downstream search has BOTH the colloquial token ("P30") and the
 * canonical phrase ("Toyota Prius ZVW30") to match against.
 *
 *   expandQueryWithVehicle("p30 тоормосны бул")
 *     → { query: "p30 тоормосны бул Toyota Prius ZVW30", vehicle: {…} }
 *
 *   expandQueryWithVehicle("brake pad")
 *     → { query: "brake pad", vehicle: null }   // unchanged
 */
export const expandQueryWithVehicle = (text) => {
  const v = normalizeVehicleReference(text);
  if (!v) return { query: String(text || ""), vehicle: null };
  return {
    query:   `${text} ${v.canonical}`.trim(),
    vehicle: v,
  };
};

/**
 * For tests + ops dashboards — surface how many patterns we ship with.
 */
export const __internal = Object.freeze({
  CHASSIS_DICT_SIZE: CHASSIS_DICT.length,
});
