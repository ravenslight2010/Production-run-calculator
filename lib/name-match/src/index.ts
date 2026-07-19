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

/**
 * Prefix a recipe/mix name with its brand ("Lucia's" + "Taco Mix" →
 * "Lucia's Taco Mix") to disambiguate a cross-brand name collision on import.
 * IDEMPOTENT: when the name already starts with the brand's tokens (compared
 * through the same loose normalization, so "Lucias Taco Mix" vs "Lucia's"
 * still counts), the name is returned unchanged — a re-import of the same
 * workbook converges on the same prefixed name instead of stacking prefixes.
 * A blank brand (or a brand that normalizes to nothing) never changes the
 * name. Pure.
 */
export function brandPrefixedName(brand: string, name: string): string {
  const b = (brand ?? "").trim();
  const n = (name ?? "").trim();
  if (!b || !n) return n;
  const bKey = looseNameKey(b);
  if (!bKey) return n;
  const nKey = looseNameKey(n);
  if (nKey === bKey || nKey.startsWith(bKey + " ")) return n;
  return `${b} ${n}`;
}

/**
 * Picker "brand tag" labels for pool names that collide across brands.
 *
 * Two rows collide when their names share the same brand-stripped CORE key —
 * so "Taco Mix" (Marco's) and "Lucia's Taco Mix" (Lucia's) collide (the second
 * strips its own brand prefix down to the same "taco mix" core), and so do two
 * rows literally named "Taco Mix" under different brands. Every colliding name
 * that belongs to exactly one non-blank brand gets a `"Name (Brand)"` label
 * unless the name already carries that brand's tokens (a prefixed name like
 * "Lucia's Taco Mix" needs no extra tag); a colliding name shared by several
 * brands gets all of them (`"Taco Mix (Marco's / Lucia's)"`) so staff can see
 * the row is genuinely ambiguous. Non-colliding names get no entry — display
 * code falls back to the bare name. Pure.
 */
export function brandTagLabels(
  rows: ReadonlyArray<{ name: string; brand: string }>,
): Map<string, string> {
  // name (exact trim) → brands seen, plus core-key → distinct name keys.
  const coreOf = (name: string, brand: string): string => {
    const nKey = looseNameKey(name);
    const bKey = looseNameKey(brand);
    if (bKey && nKey.startsWith(bKey + " ")) return nKey.slice(bKey.length + 1);
    return nKey;
  };
  const byName = new Map<string, { name: string; brands: string[]; cores: Set<string> }>();
  const namesByCore = new Map<string, Set<string>>();
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const nKey = looseNameKey(name);
    if (!nKey) continue;
    const brand = (r.brand ?? "").trim();
    const core = coreOf(name, brand);
    let e = byName.get(nKey);
    if (!e) byName.set(nKey, (e = { name, brands: [], cores: new Set() }));
    const bKey = looseNameKey(brand);
    if (brand && !e.brands.some((b) => looseNameKey(b) === bKey)) e.brands.push(brand);
    e.cores.add(core);
    let names = namesByCore.get(core);
    if (!names) namesByCore.set(core, (names = new Set()));
    names.add(nKey);
  }
  // A name collides when: its core is shared by another NAME, or the name
  // itself is held by 2+ brands.
  const out = new Map<string, string>();
  for (const [nKey, e] of byName) {
    const coreShared = [...e.cores].some((c) => (namesByCore.get(c)?.size ?? 0) > 1);
    const multiBrand = e.brands.length > 1;
    if (!coreShared && !multiBrand) continue;
    // A brand-prefixed name already tells staff whose it is.
    const alreadyTagged =
      e.brands.length === 1 &&
      (nKey === looseNameKey(e.brands[0]) || nKey.startsWith(looseNameKey(e.brands[0]) + " "));
    if (alreadyTagged || e.brands.length === 0) continue;
    out.set(e.name, `${e.name} (${e.brands.join(" / ")})`);
  }
  return out;
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
  /**
   * When true, a queried name never matches its own saved entry (compared
   * case-insensitively on the trimmed name). This lets an in-pool duplicate
   * scan build ONE matcher over the whole pool and query each member against
   * it, instead of rebuilding an (expensive) matcher per member with that
   * member excluded — same semantics, O(n) index builds instead of O(n²).
   */
  excludeSelf?: boolean;
}

export type NearDupNameMatcher = (name: string) => string | null;

/**
 * Which matcher layer produced a hit:
 *   1 = loose key equality (exact after normalization)
 *   2 = word-order-insensitive key equality
 *   3 = single-typo key
 *   4 = one extra token (opt-in)
 * Callers use this to split "safe to apply silently" (layer 1) from
 * "needs human review" (layers 2+).
 */
export type NearDupMatchLayer = 1 | 2 | 3 | 4;

export type NearDupNameMatcherDetailed = (
  name: string,
) => { name: string; layer: NearDupMatchLayer } | null;

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
  const detailed = buildNearDupNameMatcherDetailed(existingNames, options);
  return (name) => detailed(name)?.name ?? null;
}

/**
 * Same as buildNearDupNameMatcher but the result carries WHICH layer matched,
 * so a caller can auto-apply only exact (layer 1) hits and surface everything
 * beyond exact as a declinable review suggestion. Pure.
 */
export function buildNearDupNameMatcherDetailed(
  existingNames: ReadonlyArray<string>,
  options?: NearDupMatcherOptions,
): NearDupNameMatcherDetailed {
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

  return (rawName: string): { name: string; layer: NearDupMatchLayer } | null => {
    const name = (rawName ?? "").trim();
    if (!name) return null;
    const key = keyOf(name);
    if (!key) return null;
    const selfCi = options?.excludeSelf ? name.toLowerCase() : null;
    const pool =
      selfCi === null
        ? entries
        : entries.filter((e) => e.name.toLowerCase() !== selfCi);
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
    for (let i = 0; i < layers.length; i++) {
      const hits = pool.filter(layers[i]);
      if (hits.length === 1) {
        return { name: hits[0].name, layer: (i + 1) as NearDupMatchLayer };
      }
      // Two DIFFERENT saved names both qualify: never guess, and never fall
      // through to a weaker layer that would hide the ambiguity.
      if (hits.length > 1) return null;
    }
    return null;
  };
}
