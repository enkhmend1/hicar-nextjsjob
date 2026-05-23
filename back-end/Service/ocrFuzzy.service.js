/**
 * OEM fuzzy corrector — fixes OCR-degraded part numbers.
 *
 * The problem this exists to solve:
 *   When sellers OCR a part-label photo (or scan a packing sticker with
 *   a cheap reader), characters get mistaken: O↔0, I↔1, S↔5, B↔8, Z↔2,
 *   G↔6, Q↔0. A code that reads "43512-1261O" should really be
 *   "43512-12610" — Toyota OEMs never end in a letter.
 *
 * Approach:
 *   • Each major manufacturer has a deterministic OEM pattern (Toyota
 *     is 5-digit + dash + 5-digit; Honda is 5-3-3; Bosch starts with 0
 *     followed by 9 digits, etc.). The OEM_PATTERNS table lists them.
 *   • For an input that DOESN'T match any pattern, we walk a character
 *     substitution table and try every variant within a bounded edit
 *     distance. Each variant is scored against the patterns; the best
 *     scorer wins. If multiple candidates tie, the lowest-edit-cost one
 *     ranks first.
 *   • Confidence = pattern-match strength × (1 - edits/length). Pure
 *     regex matches return 100%; one-substitution fixes return ~85%;
 *     multi-substitution fixes drop into the 60-70% range and should
 *     be reviewed by a human (the wizard highlights them yellow).
 *
 * Returns a structured object so callers can decide whether to use the
 * correction, log a warning, or surface it for manual review.
 */

// ────────────────────────────────────────────────────────────────────
// Brand-specific OEM patterns. Each row:
//   brand      — short brand label (for ops + logs)
//   pattern    — RegExp the cleaned code MUST satisfy to be a "match"
//   strength   — base confidence multiplier (1.0 = strongest)
//
// Patterns are anchored. They match the CLEANED form (uppercased, dashes
// preserved, internal whitespace stripped). Add new manufacturers here.
// ────────────────────────────────────────────────────────────────────
const OEM_PATTERNS = [
  // Toyota / Lexus / Daihatsu — 5 digits, dash, 5 digits (e.g. 04465-02220)
  { brand: "Toyota",   pattern: /^[0-9]{5}-[0-9]{5}$/,             strength: 1.00 },
  // Honda / Acura — 5-3-3 segmented (e.g. 06430-S5A-J50)
  { brand: "Honda",    pattern: /^[0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{3}$/, strength: 1.00 },
  // Nissan / Infiniti — most common: 5-digit prefix + 5 alphanumerics
  // Common forms: 41060-EG085, 11920-AL500
  // Strength is intentionally LOW (0.80) because the lenient
  // alphanumeric tail accepts many strings that other manufacturers'
  // stricter patterns would reject after one OCR substitution. The
  // scorer therefore correctly prefers a 1-edit Toyota fix over a
  // 0-edit Nissan "match" when the prefix matches a Toyota family.
  { brand: "Nissan",   pattern: /^[0-9]{5}-[A-Z0-9]{5}$/,           strength: 0.80 },
  // Hyundai / Kia — usually 5 digits + dash + 5 digits, often starts with 0
  { brand: "Hyundai",  pattern: /^[0-9]{7}[A-Z][0-9]{2}$|^[0-9]{5}-[0-9]{5}$/, strength: 0.90 },
  // Bosch — starts with 0 and is exactly 10 digits (e.g. 0986478853)
  { brand: "Bosch",    pattern: /^0[0-9]{9}$/,                      strength: 1.00 },
  // Denso — 12-digit run (e.g. 094000-0500). Pattern variants exist; this is the most common.
  { brand: "Denso",    pattern: /^[0-9]{6}-[0-9]{4}$/,              strength: 0.90 },
  // Mitsubishi / Mazda — alphanumeric varied (M5xxx-xxxx, MR123456)
  { brand: "Mitsubishi", pattern: /^MR?[0-9]{6,8}$/,                strength: 0.85 },
  // Subaru / GM — 8-13 alphanumeric, lenient
  { brand: "Generic",  pattern: /^[A-Z0-9]{8,13}$/,                 strength: 0.70 },
];

// Char substitution table — both directions are tried per character
// because the OCR could equally read "0" as "O" or "O" as "0".
const SUBSTITUTIONS = Object.freeze({
  "O": ["0"], "0": ["O"],
  "I": ["1"], "1": ["I", "l"],
  "l": ["1", "I"],
  "S": ["5"], "5": ["S"],
  "B": ["8"], "8": ["B"],
  "Z": ["2"], "2": ["Z"],
  "G": ["6"], "6": ["G"],
  "Q": ["0", "O"],
});

const MAX_EDITS = 3;          // hard cap so the search space stays bounded
const MAX_VARIANTS = 256;     // safety valve against pathological inputs

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Normalize OCR output for matching: uppercase, strip whitespace
 * (internal + leading/trailing), keep only [A-Z0-9-].
 */
export const normalizeForMatch = (raw) =>
  String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9\-]/g, "");

/**
 * Score one candidate string against every known pattern. Returns the
 * single best pattern hit + its strength (or null if no pattern matched).
 */
const matchPatterns = (candidate) => {
  let best = null;
  for (const { brand, pattern, strength } of OEM_PATTERNS) {
    if (pattern.test(candidate) && (!best || strength > best.strength)) {
      best = { brand, strength, pattern: pattern.source };
    }
  }
  return best;
};

/**
 * Generate substitution variants up to `maxEdits`. BFS, deduplicated by
 * Set so we never recompute the same string. Bounded by MAX_VARIANTS so
 * a 20-char garbage input can't explode the search space.
 */
const generateVariants = (input, maxEdits) => {
  const seen = new Set([input]);
  let frontier = [{ str: input, edits: 0 }];
  const all = [{ str: input, edits: 0 }];

  while (frontier.length && all.length < MAX_VARIANTS) {
    const next = [];
    for (const { str, edits } of frontier) {
      if (edits >= maxEdits) continue;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const subs = SUBSTITUTIONS[ch];
        if (!subs) continue;
        for (const sub of subs) {
          const variant = str.slice(0, i) + sub + str.slice(i + 1);
          if (!seen.has(variant)) {
            seen.add(variant);
            const entry = { str: variant, edits: edits + 1 };
            next.push(entry);
            all.push(entry);
            if (all.length >= MAX_VARIANTS) break;
          }
        }
        if (all.length >= MAX_VARIANTS) break;
      }
      if (all.length >= MAX_VARIANTS) break;
    }
    frontier = next;
  }
  return all;
};

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Attempt to correct an OEM code that may have OCR errors.
 *
 *   raw:       the unclean string from OCR / user paste
 *   maxEdits:  cap on substitutions (default 3 — covers most real OCR noise)
 *
 * Returns:
 *   {
 *     original:        normalised input (what you'd see on the label)
 *     corrected:       best-fitting OEM string (== original if no edit helped)
 *     confidence:      0.0–1.0 — pattern-strength × (1 - edits/length)
 *     brand:           best-fitting brand if a pattern matched (else null)
 *     edits:           number of character substitutions applied
 *     requiresReview:  true when confidence < 0.70
 *     rule:            short tag describing what happened
 *                       "exact"        — raw already matched a pattern
 *                       "substituted"  — raw didn't match; we found a fix
 *                       "unmatched"    — nothing matched, returned raw as-is
 *   }
 */
export const correctOemCode = (raw, { maxEdits = MAX_EDITS } = {}) => {
  const original = normalizeForMatch(raw);
  if (!original || original.length < 4) {
    return {
      original, corrected: original, confidence: 0.0,
      brand: null, edits: 0, requiresReview: true, rule: "unmatched",
    };
  }

  // Generate all variants UP TO maxEdits substitutions (includes the
  // original at edits=0). Score every one that matches a known pattern;
  // the highest-confidence wins.
  //
  // KEY INSIGHT: even when the original input exact-matches a LENIENT
  // pattern (e.g. Nissan's letter-allowing 5-A0-9{5}), a single
  // substitution may push it into a STRICTER pattern (e.g. Toyota's
  // digit-only 5-5). The penalty for the 1 edit is usually smaller
  // than the strength bonus the stricter pattern grants — so the
  // strict candidate wins. This is why we don't short-circuit on
  // edits=0 here.
  const variants = generateVariants(original, maxEdits);
  let best = null;
  for (const v of variants) {
    const m = matchPatterns(v.str);
    if (!m) continue;
    const penalty = v.edits / Math.max(original.length, 1);
    const confidence = m.strength * (1 - penalty);
    if (!best || confidence > best.confidence) {
      best = { ...v, ...m, confidence };
    }
  }

  if (!best) {
    return {
      original, corrected: original, confidence: 0.30,
      brand: null, edits: 0, requiresReview: true, rule: "unmatched",
    };
  }

  const rule = best.edits === 0 ? "exact" : "substituted";
  return {
    original,
    corrected: best.str,
    confidence: +best.confidence.toFixed(2),
    brand: best.brand,
    edits: best.edits,
    requiresReview: best.confidence < 0.70,
    rule,
  };
};

/** Bulk wrapper — runs correctOemCode over an array. */
export const correctOemCodes = (rawList, opts) =>
  (Array.isArray(rawList) ? rawList : []).map((r) => correctOemCode(r, opts));

// Internal hooks for tests.
export const __internal = Object.freeze({
  OEM_PATTERNS, SUBSTITUTIONS, MAX_EDITS, MAX_VARIANTS,
  normalizeForMatch, matchPatterns, generateVariants,
});
