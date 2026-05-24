/**
 * Mongolian license-plate detector.
 *
 * Format:
 *   • Modern personal:   4 digits + 3 Cyrillic letters  →  "1234УБА"
 *   • Spaced variant:    same with whitespace            →  "1234 УБА"
 *   • Lowercase user input is normalised to upper Cyrillic.
 *
 * Out of scope (v1):
 *   • Government plates ("МУ-XXXX")
 *   • Old 4-digit-only plates (pre-2000s)
 *   • Trailer-only plates
 *
 * Used by:
 *   • ai.controller: scans the latest user message for an embedded
 *     plate; if found AND no active vehicle context, prompts the
 *     agent to call lookup_vehicle_by_plate with a confirmation
 *     flow ("1234УБА байна — машин солих уу?").
 *   • Frontend AIChatWidget: highlights detected plates inline so
 *     the UI can offer a one-click switch chip.
 */

// Цагаан Cyrillic-уудын set. Уламжлалт Монгол plate-д Ө, Ү, Ё-г оруулдаг
// бөгөөд бид хатуу хязгаарлалт хийхгүй (regex generous-аар орхиод
// бодит тоо/үсгийн жагсаалттай шалгана).
const CYRILLIC = "А-ЯӨҮЁ";
const PLATE_REGEX = new RegExp(
  // word boundary on the leading digit; optional whitespace between
  // the 4 digits and 3 letters; trailing word boundary.
  `(?<![A-Z0-9${CYRILLIC}])(\\d{4})\\s?([${CYRILLIC}]{3})(?![A-Z0-9${CYRILLIC}])`,
  "iu",
);

const PLATE_REGEX_GLOBAL = new RegExp(PLATE_REGEX.source, "giu");

/**
 * Normalise a plate string to the canonical form: uppercase, no
 * whitespace, no decoration. "1234 уба" → "1234УБА".
 *
 * Returns null if the input doesn't conform to the Mongolian pattern.
 */
export const normalizePlate = (raw) => {
  const m = String(raw || "").match(PLATE_REGEX);
  if (!m) return null;
  return (m[1] + m[2]).toUpperCase();
};

/**
 * Find the FIRST Mongolian plate embedded in a free-form message.
 * Returns the normalised plate OR null. The first match wins — we
 * don't try to disambiguate multiple plates in one message; the AI
 * can ask a follow-up.
 *
 * Returns:
 *   {
 *     plate:     "1234УБА",         // canonical form
 *     surface:   "1234 уба",        // exact span found in text
 *     start: 12, end: 20,           // offsets in the source string
 *   }
 *   …or null when no plate is present.
 */
export const detectMongolianPlate = (text) => {
  const s = String(text || "");
  if (s.length < 7) return null;     // 4 digits + 3 letters minimum
  PLATE_REGEX_GLOBAL.lastIndex = 0;
  const m = PLATE_REGEX_GLOBAL.exec(s);
  if (!m) return null;
  return {
    plate:   (m[1] + m[2]).toUpperCase(),
    surface: m[0],
    start:   m.index,
    end:     m.index + m[0].length,
  };
};

/**
 * Find ALL Mongolian plates in a message. Useful for the frontend
 * "highlight the plate in the bubble" affordance. Bounded to 5 hits
 * to keep the loop trivially terminating.
 */
export const detectAllPlates = (text) => {
  const s = String(text || "");
  const out = [];
  PLATE_REGEX_GLOBAL.lastIndex = 0;
  let m;
  while ((m = PLATE_REGEX_GLOBAL.exec(s)) !== null && out.length < 5) {
    out.push({
      plate:   (m[1] + m[2]).toUpperCase(),
      surface: m[0],
      start:   m.index,
      end:     m.index + m[0].length,
    });
  }
  return out;
};

/**
 * Sanity check the canonical form. Mirrors what garage.service's own
 * isPlateValid does, but kept local so the detector can validate
 * without importing the garage provider chain.
 */
export const isCanonicalPlate = (plate) => {
  if (typeof plate !== "string") return false;
  return /^\d{4}[А-ЯӨҮЁ]{3}$/.test(plate);
};

// Internal hooks for tests.
export const __internal = Object.freeze({
  PLATE_REGEX, PLATE_REGEX_GLOBAL, CYRILLIC,
});
