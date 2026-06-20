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
