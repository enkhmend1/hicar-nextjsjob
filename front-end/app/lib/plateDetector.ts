/**
 * Mongolian license-plate utilities — frontend mirror of
 * back-end/Service/plateDetector.service.js.
 *
 * Keep the regex shape IDENTICAL on both sides. When ops add a new
 * plate format (e.g. trailer plates, government plates) they must
 * update both files; the smoke tests in scripts/test-ai-roles.js
 * cover the backend regex, and any frontend divergence here would
 * silently allow plates the server then rejects.
 *
 * Two functions:
 *   • normalizeMongolianPlate("1234 уба")  → "1234УБА" (canonical)
 *   • detectMongolianPlate("Энэ 1234УБА машинд") → "1234УБА" or null
 */

// Word-boundary guards on BOTH sides so partial matches inside longer
// alphanumeric runs ("WP1234УБАX") don't trigger.
const PLATE_RX = /(?<![A-Za-z0-9А-ЯӨҮЁа-яөүё])(\d{4})\s?([А-ЯӨҮЁа-яөүё]{3})(?![A-Za-z0-9А-ЯӨҮЁа-яөүё])/iu;

/**
 * Return the canonical form ("1234УБА") if `raw` parses as a Mongolian
 * plate (with optional internal whitespace and any case). Otherwise null.
 */
export const normalizeMongolianPlate = (raw: string): string | null => {
  const m = String(raw || "").match(PLATE_RX);
  return m ? (m[1] + m[2]).toUpperCase() : null;
};

/**
 * Find the first embedded plate in free-form text. Alias of
 * normalizeMongolianPlate because both surfaces should treat any
 * recognisable plate the same way — the location of the match is
 * not used in the UI today.
 */
export const detectMongolianPlate = normalizeMongolianPlate;

/** Strict check on already-canonical form. */
export const isCanonicalPlate = (plate: string): boolean =>
  /^\d{4}[А-ЯӨҮЁ]{3}$/.test(plate);
