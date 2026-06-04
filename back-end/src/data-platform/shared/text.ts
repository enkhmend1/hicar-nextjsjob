/**
 * Text utilities for normalization. Pure functions, no I/O.
 *
 * Mongolian sellers mix Cyrillic, Latin transliteration and slang. The alias
 * dictionary stores all known forms, but transliteration widens recall for
 * forms we haven't catalogued yet ("gerel" → "гэрэл").
 */

/** NFC unicode + lowercase + trim + collapse internal whitespace. */
export function normalizeText(input: string): string {
  return input.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Split into word tokens on any non-letter/non-digit (unicode-aware). */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

// Ordered Latin→Cyrillic rules. Multi-character sequences MUST come first so
// "sh"/"ch"/"ya" are consumed before their single-letter components.
const TRANSLIT_RULES: ReadonlyArray<readonly [string, string]> = [
  ["shch", "щ"], ["sh", "ш"], ["ch", "ч"], ["ts", "ц"], ["kh", "х"],
  ["yo", "ё"], ["yu", "ю"], ["ya", "я"], ["ye", "е"], ["zh", "ж"],
  ["ai", "ай"], ["ei", "эй"], ["ii", "ий"], ["uu", "үү"], ["oo", "оо"],
  ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"], ["e", "э"],
  ["z", "з"], ["i", "и"], ["j", "ж"], ["k", "к"], ["l", "л"], ["m", "м"],
  ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"],
  ["u", "у"], ["f", "ф"], ["h", "х"], ["c", "к"], ["w", "в"], ["x", "кс"],
  ["y", "й"], ["q", "к"],
];

/**
 * Best-effort Latin→Cyrillic transliteration. Only Latin letters are touched;
 * digits and existing Cyrillic pass through. Approximate by design — it widens
 * search recall, it is not a linguistic transliterator.
 */
export function transliterateLatinToCyrillic(input: string): string {
  const s = normalizeText(input);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (!/[a-z]/.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    let matched = false;
    for (const [lat, cyr] of TRANSLIT_RULES) {
      if (s.startsWith(lat, i)) {
        out += cyr;
        i += lat.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * Contiguous n-grams (1..maxN) of a token list, joined by single spaces.
 * Used to match multi-word aliases like "front light" / "тоормосны диск".
 */
export function ngrams(tokens: string[], maxN = 3): string[] {
  const out: string[] = [];
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      out.push(tokens.slice(i, i + n).join(" "));
    }
  }
  return out;
}
