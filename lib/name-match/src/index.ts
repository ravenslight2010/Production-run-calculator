/**
 * @workspace/name-match — shared near-duplicate name matching for import flows.
 *
 * Every importer (spec sheets, premix/mixes, cheese workbooks, dough/sauce
 * pools) must answer the same question: "is this imported name really the same
 * thing as one the factory already keeps?" Each pool historically used only a
 * LOOSE normalization key (lowercase, punctuation folded, generic filler words
 * dropped), which misses three very common labeling drifts across workbooks:
 *
 *   1. word order         — "Pepperoni Craft" vs "Craft Pepperoni"
 *   2. a single typo      — "Peperoni" vs "Pepperoni"
 *   3. one extra word     — "Craft Pepperoni" vs "Pepperoni" (OPT-IN only:
 *      an extra word is often a MEANINGFUL qualifier — "Spicy Cheese Mix" is
 *      NOT "Cheese Mix" — so this layer is off by default and must only be
 *      enabled where a human reviews the proposed link before it applies)
 *
 * Those used to fork parallel entries instead of linking. This lib layers the
 * checks ON TOP of loose-key equality, most-confident first, with strict
 * safety guards so two genuinely different products never collide:
 *
 *   - AMBIGUITY GUARD: a layer only matches when exactly ONE existing name
 *     qualifies; if two different saved names both qualify the whole match is
 *     abandoned (no fall-through to weaker layers) so an import is never
 *     silently relabeled to an arbitrary candidate.
 *   - DIGIT GUARD: names whose digits differ never match ("Pepperoni 2" vs
 *     "Pepperoni 3" are different products; "12x12" vs "12x14" are different
 *     dies). The extra word in layer 2 must not contain a digit either.
 *   - LENGTH GUARD: the typo layer needs keys of >= 5 chars, and the shared
 *     part in the extra-word layer must be >= 4 chars, so short generic names
 *     ("Mix", "Red") can only match exactly.
 */

/**
 * Generic "default version" filler tokens shared by the import pools — this is
 * a pizza factory, so "pizza" is always a generic descriptor. Kept identical to
 * the historical per-lib constants it replaces.
 */
export const GENERIC_FILLER_TOKENS: ReadonlySet<string> = new Set([
  "standard",
  "regular",
  "pizza",
]);

/**
 * Loose normalization key: lowercase, apostrophes removed (so "Aldo's" and
 * "Aldos" collapse), all other punctuation folded to single spaces, generic
 * filler tokens dropped. A name that is ONLY filler keeps its tokens so it
 * still keys to something (and only matches another all-filler name).
 * Identical to the loose keys previously duplicated in spec-import and mixes.
 */
export function looseNameKey(name: string): string {
  const base = (name ?? "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!base) return "";
  const tokens = base.split(" ");
  const kept = tokens.filter((t) => !GENERIC_FILLER_TOKENS.has(t));
  return (kept.length ? kept : tokens).join(" ");
}

/** Digits of a key in order — differing digits means differing products. */
function digitsOf(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

function sortedKey(key: string): string {
  return key.split(" ").filter(Boolean).sort().join(" ");
}

/**
 * True when editing `a` into `b` takes exactly ONE single-character insert,
 * delete, or substitution. Bounded scan (no DP table) — both strings are
 * short normalized keys.
 */
export function isSingleEditApart(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Find first mismatch from the left.
  let i = 0;
  const min = Math.min(la, lb);
  while (i < min && a[i] === b[i]) i++;
  if (la === lb) {
    // substitution: the rest after the mismatch must be identical
    return a.slice(i + 1) === b.slice(i + 1);
  }
  // insertion/deletion: skip one char in the longer string
  const [shorter, longer] = la < lb ? [a, b] : [b, a];
  return shorter.slice(i) === longer.slice(i + 1);
}

/**
 * True when `a` and `b` (as token multisets) differ by exactly one extra
 * token on one side, the extra token has no digit, and the shared tokens
 * joined are >= 4 chars ("Craft Pepperoni" vs "Pepperoni" matches; "Craft
 * Mix" vs "Mix" does not — too generic).
 */
function isOneExtraTokenApart(aTokens: string[], bTokens: string[]): boolean {
  const [shorter, longer] =
    aTokens.length < bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  if (longer.length - shorter.length !== 1 || shorter.length === 0) {
    return false;
  }
  const remaining = [...longer];
  for (const t of shorter) {
    const idx = remaining.indexOf(t);
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  const extra = remaining[0] ?? "";
  if (!extra || /[0-9]/.test(extra)) return false;
  return shorter.join(" ").length >= 4;
}

const MIN_TYPO_KEY_LENGTH = 5;

interface Entry {
  name: string;
  key: string;
  sorted: string;
  tokens: string[];
  digits: string;
}

export interface NearDupMatcherOptions {
  /**
   * Override the normalization key (e.g. cheese-import's abbreviation-expanded
   * key). Defaults to `looseNameKey`.
   */
  keyOf?: (name: string) => string;
  /**
   * Enable the "one extra word" layer. OFF by default: an extra word is often
   * a meaningful qualifier ("Spicy Cheese Mix" is NOT "Cheese Mix"), so this
   * layer must only be turned on where a human reviews the proposed link
   * before it is applied (e.g. the cheese import review dialog).
   */
  allowExtraToken?: boolean;
}

export type NearDupNameMatcher = (name: string) => string | null;

/**
 * Build a matcher that maps an imported name to the EXACT existing name it
 * near-duplicates, or null when there is no single safe match. Layers, most
 * confident first — each with the ambiguity guard described in the header:
 *
 *   1. loose key equality (what the pools already did)
 *   2. word-order-insensitive key equality
 *   3. single-typo key (edit distance exactly 1, keys >= 5 chars, digits equal)
 *   4. OPT-IN (`allowExtraToken`): one extra non-digit token on either side
 *      (shared part >= 4 chars) — review-only, see NearDupMatcherOptions
 *
 * Pure; the returned function is pure too.
 */
export function buildNearDupNameMatcher(
  existingNames: ReadonlyArray<string>,
  options?: NearDupMatcherOptions,
): NearDupNameMatcher {
  const keyOf = options?.keyOf ?? looseNameKey;
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const raw of existingNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    // Duplicate saved entries of the SAME name (ci) are one candidate, never
    // a false ambiguity.
    const ci = name.toLowerCase();
    if (seen.has(ci)) continue;
    seen.add(ci);
    const key = keyOf(name);
    if (!key) continue;
    entries.push({
      name,
      key,
      sorted: sortedKey(key),
      tokens: key.split(" ").filter(Boolean),
      digits: digitsOf(key),
    });
  }

  return (rawName: string): string | null => {
    const name = (rawName ?? "").trim();
    if (!name) return null;
    const key = keyOf(name);
    if (!key) return null;
    const sorted = sortedKey(key);
    const tokens = key.split(" ").filter(Boolean);
    const digits = digitsOf(key);

    const layers: Array<(e: Entry) => boolean> = [
      (e) => e.key === key,
      (e) => e.sorted === sorted,
      (e) =>
        e.digits === digits &&
        key.length >= MIN_TYPO_KEY_LENGTH &&
        e.key.length >= MIN_TYPO_KEY_LENGTH &&
        isSingleEditApart(sorted, e.sorted),
    ];
    if (options?.allowExtraToken) {
      layers.push(
        (e) => e.digits === digits && isOneExtraTokenApart(tokens, e.tokens),
      );
    }
    for (const qualifies of layers) {
      const hits = entries.filter(qualifies);
      if (hits.length === 1) return hits[0].name;
      // Two DIFFERENT saved names both qualify: never guess, and never fall
      // through to a weaker layer that would hide the ambiguity.
      if (hits.length > 1) return null;
    }
    return null;
  };
}
