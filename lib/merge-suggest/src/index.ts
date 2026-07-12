// Pure, framework-free logic for AI-assisted ingredient merging.
//
// Two cooperating ideas, mirroring the spec-import AI + learned-memory pattern:
//   1. AI suggestions — the server asks a model to cluster the app's mergeable
//      ingredient names into groups of duplicates, each with a recommended
//      canonical name to keep. The model is untrusted, so `sanitizeMergeSuggestions`
//      coerces its JSON and only ever keeps names that already exist in the app.
//   2. Learned memory — every confirmed merge persists source -> canonical
//      aliases (`collectMergeAliases`); `suggestionsFromAliases` re-proposes those
//      consolidations purely from memory (with an existence guard), and
//      `mergeSuggestionLists` folds remembered + AI groups together by shared
//      target.
//
// This module owns ONLY pure data shaping. Network/storage/UI live in the web
// (`run-calculator/src/mergeSuggest.ts`) and mobile
// (`run-calculator-mobile/context/mergeSuggest.ts`) glue, kept at parity.
//
// A third, deterministic idea (no AI, no memory): `nearDupSuggestions` scans a
// name pool with @workspace/name-match's near-duplicate matcher (word-order +
// single-typo layers, extra-word layer intentionally OFF) so obvious look-alike
// duplicates surface even when the AI is unavailable or the caller lacks the
// AI capability. Human review still gates every merge.

import { buildNearDupNameMatcher } from "@workspace/name-match";

/**
 * Which merge tab a suggestion/alias/denial belongs to. Scoping by category
 * keeps each tab's name pool independent — a denial or learned alias from one
 * tab (e.g. a dough recipe name) never leaks into another tab's suggestions
 * (e.g. ingredients). "flavor" is additionally scoped to a single brand (see
 * callers) since the same flavor name can legitimately repeat across brands.
 * Defaults to "ingredient" everywhere for backward compatibility with rows
 * written before categories existed.
 */
export type MergeSuggestCategory =
  | "ingredient"
  | "mixes"
  | "dough"
  | "sauce"
  | "cheese"
  | "brand"
  | "flavor";

/** A learned mapping: a merged-away name -> the canonical name kept. */
export type MergeAlias = {
  externalName: string;
  canonicalName: string;
};

/** A proposed consolidation: fold `sources` into `target`. */
export type MergeSuggestion = {
  /** The canonical name to keep (always a real, currently-existing name). */
  target: string;
  /** Names to merge away — never includes `target`, de-duplicated. */
  sources: string[];
  /** Optional short human-readable rationale. */
  reason?: string;
};

const norm = (s: string): string => s.trim().toLowerCase();

/** Case-insensitive identity key for a learned alias's external (source) name. */
export function mergeAliasKey(externalName: string): string {
  return norm(externalName);
}

/**
 * Build the alias entries worth remembering from a single confirmed merge.
 * Each non-blank source that differs from the target becomes a source ->
 * target mapping; self-references and case-insensitive duplicate sources are
 * dropped (they carry no information). Returns [] when nothing meaningful
 * remains so callers can skip the save entirely.
 */
export function collectMergeAliases(sources: string[], target: string): MergeAlias[] {
  const t = (target ?? "").trim();
  if (!t) return [];
  const out: MergeAlias[] = [];
  const seen = new Set<string>();
  for (const raw of sources) {
    const s = (raw ?? "").trim();
    if (!s || norm(s) === norm(t)) continue;
    const k = norm(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ externalName: s, canonicalName: t });
  }
  return out;
}

/**
 * Re-derive "previously merged" suggestions purely from learned aliases and the
 * CURRENT set of names. A remembered source still present in `names` is proposed
 * for merge into its canonical target ONLY when that target also still exists
 * among `names` (existence guard — we never resurrect a deleted name, mirroring
 * the photo-alias stale-item guard). Groups sharing a target are combined.
 */
export function suggestionsFromAliases(
  names: string[],
  aliases: MergeAlias[],
): MergeSuggestion[] {
  const present = new Map<string, string>(); // norm -> actual current name
  for (const n of names) {
    const k = norm(n);
    if (k && !present.has(k)) present.set(k, n);
  }
  const groups = new Map<string, { target: string; sources: string[] }>();
  for (const a of aliases) {
    const extK = norm(a.externalName ?? "");
    const canK = norm(a.canonicalName ?? "");
    if (!extK || !canK || extK === canK) continue;
    const srcActual = present.get(extK);
    const tgtActual = present.get(canK);
    if (!srcActual || !tgtActual) continue; // both must currently exist
    let g = groups.get(canK);
    if (!g) {
      g = { target: tgtActual, sources: [] };
      groups.set(canK, g);
    }
    if (
      norm(srcActual) !== norm(g.target) &&
      !g.sources.some((s) => norm(s) === norm(srcActual))
    ) {
      g.sources.push(srcActual);
    }
  }
  const out: MergeSuggestion[] = [];
  for (const g of groups.values()) {
    if (g.sources.length > 0) {
      out.push({ target: g.target, sources: g.sources, reason: "Previously merged" });
    }
  }
  return out;
}

/**
 * Deterministic look-alike scan over an existing name pool. Finds groups of
 * names that near-duplicate each other (exact loose key, reordered words, or a
 * single typo — the safe default layers of @workspace/name-match; the opt-in
 * extra-word layer stays OFF because "Spicy Cheese Mix" is not "Cheese Mix").
 *
 * Pairs are clustered transitively (union-find) and each group keeps the
 * longest name as the suggested target (most specific spelling; ties broken
 * alphabetically) — the user reviews and can re-pick before applying. Pure and
 * offline: no AI call, no learned memory. The matcher's ambiguity guard means
 * a name that could match two different others contributes no pair itself,
 * but the group still forms if the others pair up directly.
 */
export function nearDupSuggestions(names: string[]): MergeSuggestion[] {
  const cleaned: string[] = [];
  const seenCi = new Set<string>();
  for (const raw of names) {
    const n = (raw ?? "").trim();
    if (!n) continue;
    const ci = norm(n);
    if (seenCi.has(ci)) continue;
    seenCi.add(ci);
    cleaned.push(n);
  }
  if (cleaned.length < 2) return [];

  const parent = cleaned.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // ONE matcher over the whole pool (excludeSelf keeps a name from matching
  // its own entry). Rebuilding the matcher per name — with that name filtered
  // out — was O(n²) index construction and froze the page on large pools.
  const match = buildNearDupNameMatcher(cleaned, { excludeSelf: true });
  const indexByName = new Map(cleaned.map((n, i) => [n, i] as const));
  for (let i = 0; i < cleaned.length; i++) {
    const hit = match(cleaned[i]);
    if (!hit) continue;
    const j = indexByName.get(hit) ?? -1;
    if (j >= 0 && j !== i) union(i, j);
  }

  const groups = new Map<number, string[]>();
  cleaned.forEach((n, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(n);
    else groups.set(root, [n]);
  });

  const out: MergeSuggestion[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const target = [...members].sort(
      (a, b) => b.length - a.length || a.localeCompare(b),
    )[0];
    out.push({
      target,
      sources: members.filter((m) => m !== target),
      reason: "Looks like the same item (spelling or word order)",
    });
  }
  return out.sort((a, b) => a.target.localeCompare(b.target));
}

// ── Conflicting descriptor guard ─────────────────────────────────────────────
// Some word pairs mark genuinely DIFFERENT products even when the rest of the
// name matches (e.g. "Pepperoni Cured" vs "Pepperoni Natural" are distinct
// items, not spellings of one item). Suggestions pairing such names are wrong
// by construction, so they are stripped before anything is shown — from the
// deterministic near-dup scan, remembered groups, and AI output alike.

const CONFLICTING_TERM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["cured", "natural"],
];

function nameTokens(name: string): Set<string> {
  return new Set(
    norm(name)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/**
 * True when two names carry opposing product descriptors (one says "cured",
 * the other says "natural") and therefore must never be merged. Token-based,
 * so "Uncured" is NOT treated as "cured". A name containing BOTH terms is
 * ambiguous and conflicts with neither.
 */
export function namesHaveConflictingTerms(a: string, b: string): boolean {
  const ta = nameTokens(a ?? "");
  const tb = nameTokens(b ?? "");
  for (const [x, y] of CONFLICTING_TERM_PAIRS) {
    const aOnlyX = ta.has(x) && !ta.has(y);
    const aOnlyY = ta.has(y) && !ta.has(x);
    const bOnlyX = tb.has(x) && !tb.has(y);
    const bOnlyY = tb.has(y) && !tb.has(x);
    if ((aOnlyX && bOnlyY) || (aOnlyY && bOnlyX)) return true;
  }
  return false;
}

/**
 * Strip conflicting-descriptor pairings out of suggestions. A source is dropped
 * when it conflicts with the group's target OR with any source kept before it
 * (so a neutral target can't quietly collapse a "cured" and a "natural" item
 * into one). Groups left with no sources are dropped. Pure; never throws.
 */
export function filterConflictingSuggestions<T extends MergeSuggestion>(
  suggestions: T[],
): T[] {
  const out: T[] = [];
  for (const s of suggestions) {
    const kept: string[] = [];
    for (const src of s.sources ?? []) {
      if (namesHaveConflictingTerms(s.target, src)) continue;
      if (kept.some((k) => namesHaveConflictingTerms(k, src))) continue;
      kept.push(src);
    }
    if (kept.length > 0) out.push({ ...s, sources: kept });
  }
  return out;
}

// ── Cross-brand guard ────────────────────────────────────────────────────────
// Recipe/mix names often embed the pizza brand they belong to ("Lowes 7in 5
// Cheese Mix", "Bashas Ultra Thin Crust Cheese"). Two names that clearly belong
// to DIFFERENT brands are never the same real-world thing no matter how many
// words they share, so suggestions pairing them are wrong by construction and
// are stripped before anything is shown — from the AI, remembered groups, and
// the deterministic near-dup scan alike. This is a deterministic safety net so
// the guarantee does not depend on the model obeying its prompt.

const genericBrandTokens = new Set(["pizza", "pizzas", "the", "co", "inc", "llc"]);

/** Distinguishing tokens of a known brand name (generic filler removed). */
function brandTokenList(brand: string): string[] {
  return norm(brand)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !genericBrandTokens.has(t));
}

/**
 * Build a matcher that returns the set of known brands a name MENTIONS: a
 * brand is mentioned when every one of its distinguishing tokens appears in
 * the name. Brands whose names are entirely generic filler never match.
 */
export function buildBrandMentionMatcher(
  knownBrands: ReadonlyArray<string>,
): (name: string) => Set<string> {
  const brands: { key: string; tokens: string[] }[] = [];
  const seen = new Set<string>();
  for (const raw of knownBrands ?? []) {
    const b = (raw ?? "").trim();
    if (!b) continue;
    const key = norm(b);
    if (seen.has(key)) continue;
    seen.add(key);
    const tokens = brandTokenList(b);
    if (tokens.length === 0) continue;
    brands.push({ key, tokens });
  }
  return (name: string): Set<string> => {
    const toks = nameTokens(name ?? "");
    const out = new Set<string>();
    for (const b of brands) {
      if (b.tokens.every((t) => toks.has(t))) out.add(b.key);
    }
    return out;
  };
}

/**
 * True when the two names mention non-overlapping, non-empty sets of known
 * brands ("Lowes …" vs "Bashas …"). A name mentioning no known brand conflicts
 * with nothing (we can't tell whose it is), and names sharing at least one
 * mentioned brand are compatible (e.g. both say "Bashas").
 */
export function namesMentionDifferentBrands(
  a: string,
  b: string,
  mentionsOf: (name: string) => Set<string>,
): boolean {
  const ma = mentionsOf(a);
  if (ma.size === 0) return false;
  const mb = mentionsOf(b);
  if (mb.size === 0) return false;
  for (const k of ma) if (mb.has(k)) return false;
  return true;
}

/**
 * Strip cross-brand pairings out of suggestions using the factory's known
 * brand list. A source is dropped when it and the group's target mention
 * different known brands, or when it brand-conflicts with a source kept before
 * it (so a brand-neutral target can't quietly collapse two brands' recipes
 * into one). Groups left with no sources are dropped. NOT for the "brand"
 * merge tab — there the names ARE brands and every legitimate typo-merge would
 * be blocked. Pure; never throws.
 */
export function filterCrossBrandSuggestions<T extends MergeSuggestion>(
  suggestions: T[],
  knownBrands: ReadonlyArray<string>,
): T[] {
  if (!knownBrands || knownBrands.length === 0) return suggestions;
  const mentionsOf = buildBrandMentionMatcher(knownBrands);
  const out: T[] = [];
  for (const s of suggestions) {
    const kept: string[] = [];
    for (const src of s.sources ?? []) {
      if (namesMentionDifferentBrands(s.target, src, mentionsOf)) continue;
      if (kept.some((k) => namesMentionDifferentBrands(k, src, mentionsOf))) continue;
      kept.push(src);
    }
    if (kept.length > 0) out.push({ ...s, sources: kept });
  }
  return out;
}

// ── Denied (ignored) merge pairs ─────────────────────────────────────────────
// When the user explicitly denies/ignores a merge suggestion, we remember the
// unordered name pairs so the AI/learned suggester never re-proposes merging
// those two names together (in either direction). Stored factory-wide, mirroring
// the learned-alias pool but with the opposite intent.

/** An unordered "never suggest merging these two together" pair. */
export type DeniedMerge = {
  nameA: string;
  nameB: string;
};

/**
 * Stable, order-independent, case-insensitive identity key for a denied pair.
 * `deniedPairKey("Mozz","Mozzarella") === deniedPairKey("Mozzarella","Mozz")`.
 */
export function deniedPairKey(a: string, b: string): string {
  const x = norm(a ?? "");
  const y = norm(b ?? "");
  return x <= y ? `${x}\u0000${y}` : `${y}\u0000${x}`;
}

/**
 * Build the denied pairs implied by ignoring one suggestion: each source paired
 * with the target. Self-references and case-insensitive duplicates are dropped.
 * Returns [] when nothing meaningful remains.
 */
export function collectDeniedPairs(target: string, sources: string[]): DeniedMerge[] {
  const t = (target ?? "").trim();
  if (!t) return [];
  const out: DeniedMerge[] = [];
  const seen = new Set<string>();
  for (const raw of sources ?? []) {
    const s = (raw ?? "").trim();
    if (!s || norm(s) === norm(t)) continue;
    const k = deniedPairKey(t, s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ nameA: t, nameB: s });
  }
  return out;
}

/**
 * Strip denied pairs out of suggestions. For each suggestion, any source whose
 * {target, source} pair is denied is removed; a suggestion left with no sources
 * is dropped entirely. Pure; never throws.
 */
export function filterDeniedSuggestions<T extends MergeSuggestion>(
  suggestions: T[],
  denied: DeniedMerge[],
): T[] {
  if (!denied || denied.length === 0) return suggestions;
  const deniedKeys = new Set<string>();
  for (const d of denied) {
    const a = (d?.nameA ?? "").trim();
    const b = (d?.nameB ?? "").trim();
    if (!a || !b) continue;
    deniedKeys.add(deniedPairKey(a, b));
  }
  if (deniedKeys.size === 0) return suggestions;
  const out: T[] = [];
  for (const s of suggestions) {
    const sources = (s.sources ?? []).filter(
      (src) => !deniedKeys.has(deniedPairKey(s.target, src)),
    );
    if (sources.length > 0) out.push({ ...s, sources });
  }
  return out;
}

/**
 * Coerce the model's raw JSON into safe suggestions. The model is untrusted:
 *   - both `target` and every `source` must resolve (case-insensitively) to a
 *     name that ALREADY exists in `knownNames` — we never merge invented names;
 *   - a group needs a valid target and at least one distinct source;
 *   - one group per target (case-insensitive), sources de-duplicated;
 *   - counts are bounded so a single response can't blow up the UI.
 * Returns the known-name spelling (not the model's) so downstream merges hit the
 * exact stored values. Never throws.
 */
export function sanitizeMergeSuggestions(
  raw: unknown,
  knownNames: string[],
  opts?: { maxGroups?: number; maxSourcesPerGroup?: number },
): MergeSuggestion[] {
  const maxGroups = opts?.maxGroups ?? 100;
  const maxSources = opts?.maxSourcesPerGroup ?? 50;

  const canon = new Map<string, string>(); // norm -> actual known name
  for (const n of knownNames) {
    const k = norm(n);
    if (k && !canon.has(k)) canon.set(k, n);
  }

  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arr: unknown[] = Array.isArray(obj.suggestions)
    ? (obj.suggestions as unknown[])
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];

  const out: MergeSuggestion[] = [];
  const usedTargets = new Set<string>();
  for (const item of arr) {
    if (out.length >= maxGroups) break;
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const targetRaw = typeof g.target === "string" ? g.target : "";
    const tgt = canon.get(norm(targetRaw));
    if (!tgt) continue; // target must be a real, existing name
    if (usedTargets.has(norm(tgt))) continue; // one group per target

    const srcRaw = Array.isArray(g.sources) ? (g.sources as unknown[]) : [];
    const sources: string[] = [];
    const seen = new Set<string>([norm(tgt)]);
    for (const s of srcRaw) {
      if (sources.length >= maxSources) break;
      if (typeof s !== "string") continue;
      const actual = canon.get(norm(s));
      if (!actual) continue; // source must be a real, existing name
      const k = norm(actual);
      if (seen.has(k)) continue;
      seen.add(k);
      sources.push(actual);
    }
    if (sources.length === 0) continue;

    const reason =
      typeof g.reason === "string" && g.reason.trim()
        ? g.reason.trim().slice(0, 300)
        : undefined;
    usedTargets.add(norm(tgt));
    out.push({ target: tgt, sources, ...(reason ? { reason } : {}) });
  }
  return out;
}

/**
 * Fold remembered (alias-derived) and AI suggestions into one list, combining
 * groups that share a target (case-insensitive). Remembered groups come first
 * and seed the target's display name/reason; AI sources are appended. Empty
 * groups are dropped.
 */
export function mergeSuggestionLists(
  remembered: MergeSuggestion[],
  ai: MergeSuggestion[],
): MergeSuggestion[] {
  const byTarget = new Map<string, MergeSuggestion>();
  const order: string[] = [];
  const add = (s: MergeSuggestion) => {
    const t = (s.target ?? "").trim();
    if (!t) return;
    const k = norm(t);
    let g = byTarget.get(k);
    if (!g) {
      g = { target: t, sources: [], ...(s.reason ? { reason: s.reason } : {}) };
      byTarget.set(k, g);
      order.push(k);
    }
    for (const src of s.sources) {
      const sv = (src ?? "").trim();
      if (!sv || norm(sv) === norm(g.target)) continue;
      if (!g.sources.some((x) => norm(x) === norm(sv))) g.sources.push(sv);
    }
  };
  for (const s of remembered) add(s);
  for (const s of ai) add(s);
  return order
    .map((k) => byTarget.get(k))
    .filter((g): g is MergeSuggestion => Boolean(g) && (g as MergeSuggestion).sources.length > 0);
}
