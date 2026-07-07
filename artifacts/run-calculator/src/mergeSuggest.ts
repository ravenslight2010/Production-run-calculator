// AI-assisted ingredient merge suggestions — web platform glue.
//
// Two cooperating pieces (mirroring the spec-import AI + learned-memory pattern):
//   - The read-only POST /ai/suggest-merges endpoint clusters the app's
//     mergeable names into groups of duplicates with a recommended canonical
//     name to keep.
//   - Learned merge aliases (GET/POST /merge-aliases) remember every confirmed
//     merge so the same duplicates resurface next time — fed to the AI and used
//     to seed "previously merged" suggestions even without an AI call.
//
// All pure logic lives in @workspace/merge-suggest; this module only sequences
// network calls. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/mergeSuggest.ts (replit.md parity).

import {
  mergeSuggestionLists,
  suggestionsFromAliases,
  nearDupSuggestions,
  collectDeniedPairs,
  filterDeniedSuggestions,
  filterConflictingSuggestions,
  type MergeAlias,
  type MergeSuggestion,
  type DeniedMerge,
  type MergeSuggestCategory,
} from "@workspace/merge-suggest";
import type { ReviewVerdict } from "@workspace/ai-review";
import { inventoryClientId } from "./inventoryShared";

export type { MergeAlias, MergeSuggestion, DeniedMerge, MergeSuggestCategory };

/** A merge suggestion plus its (optional) reviewer-AI verdict. */
export type ReviewedMergeSuggestion = MergeSuggestion & { review?: ReviewVerdict };

/**
 * Shared query-string helper: every category/brand-scoped endpoint takes an
 * optional `category` (defaults server-side to "ingredient") and, only for
 * "flavor", a `brand` that scopes the pool to one brand's flavors.
 */
function scopeParams(category?: MergeSuggestCategory, brand?: string): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (category === "flavor" && brand) params.set("brand", brand);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchMergeAliases(
  category?: MergeSuggestCategory,
  brand?: string,
): Promise<MergeAlias[]> {
  const res = await fetch(`/api/merge-aliases${scopeParams(category, brand)}`, {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List merge aliases failed (${res.status})`);
  const data = (await res.json()) as { aliases: MergeAlias[] };
  return data.aliases ?? [];
}

export async function saveMergeAliases(
  aliases: MergeAlias[],
  category?: MergeSuggestCategory,
  brand?: string,
): Promise<void> {
  if (aliases.length === 0) return;
  const res = await fetch("/api/merge-aliases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({
      aliases,
      ...(category ? { category } : {}),
      ...(category === "flavor" && brand ? { brand } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Save merge aliases failed (${res.status})`);
}

/**
 * Fetch the factory-wide set of denied (ignored) merge pairs. A denied pair is
 * an unordered {nameA, nameB} the user said should never be suggested together.
 * Server-persisted and shared like merge aliases.
 */
export async function fetchDeniedMerges(
  category?: MergeSuggestCategory,
  brand?: string,
): Promise<DeniedMerge[]> {
  const res = await fetch(`/api/denied-merges${scopeParams(category, brand)}`, {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List denied merges failed (${res.status})`);
  const data = (await res.json()) as { denied: DeniedMerge[] };
  return data.denied ?? [];
}

/**
 * Persist "never suggest merging these again" for a reviewed suggestion: build
 * the unordered pairs that pair the kept target with each source and POST them.
 * Idempotent server-side. No-op when the suggestion has no usable source.
 */
export async function denyMerge(
  target: string,
  sources: string[],
  category?: MergeSuggestCategory,
  brand?: string,
): Promise<void> {
  const pairs = collectDeniedPairs(target, sources);
  if (pairs.length === 0) return;
  const res = await fetch("/api/denied-merges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({
      pairs,
      ...(category ? { category } : {}),
      ...(category === "flavor" && brand ? { brand } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Save denied merges failed (${res.status})`);
}

/**
 * Fetch the durable, factory-wide set of merged-away names. This is the
 * authoritative tombstone that survives the per-day, last-write-wins sync blob:
 * a device that was offline during a merge fetches this on load, unions it into
 * its local tombstone, and strips the names from every master list so a merge
 * never resurfaces across a day boundary.
 */
export async function fetchMergedAwayNames(): Promise<string[]> {
  const res = await fetch("/api/merged-away", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List merged-away failed (${res.status})`);
  const data = (await res.json()) as { names: string[] };
  return data.names ?? [];
}

/**
 * Persist merged-away source names to the durable tombstone (best-effort caller
 * side). Normalized + deduped server-side; idempotent. No-op on empty input.
 */
export async function saveMergedAwayNames(names: string[]): Promise<void> {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (cleaned.length === 0) return;
  const res = await fetch("/api/merged-away", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ names: cleaned }),
  });
  if (!res.ok) throw new Error(`Save merged-away failed (${res.status})`);
}

/**
 * Remove names from the durable tombstone — called when the user explicitly
 * re-adds a previously merged-away name, preserving "re-add resurrects". No-op
 * on empty input.
 */
export async function deleteMergedAwayNames(names: string[]): Promise<void> {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (cleaned.length === 0) return;
  const res = await fetch("/api/merged-away", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ names: cleaned }),
  });
  if (!res.ok) throw new Error(`Delete merged-away failed (${res.status})`);
}

async function requestAiSuggestMerges(
  names: string[],
  aliases: MergeAlias[],
  category?: MergeSuggestCategory,
  brand?: string,
): Promise<ReviewedMergeSuggestion[]> {
  const res = await fetch("/api/ai/suggest-merges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({
      names,
      aliases,
      ...(category ? { category } : {}),
      ...(category === "flavor" && brand ? { brand } : {}),
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {}
    throw new Error(detail || `Suggest-merges request failed (${res.status})`);
  }
  const data = (await res.json()) as { suggestions?: ReviewedMergeSuggestion[] };
  return data.suggestions ?? [];
}

export type MergeSuggestResult = {
  suggestions: ReviewedMergeSuggestion[];
  /** True when the AI call succeeded; false when only remembered groups show. */
  usedAi: boolean;
  /** Set when the AI call failed (the remembered groups are still returned). */
  error?: string;
};

/**
 * Fetch learned aliases, ask the AI to cluster duplicates, and fold the AI
 * groups together with remembered (alias-derived) ones. If the AI call fails
 * (not a manager, rate-limited, offline) the remembered suggestions are still
 * returned so the feature degrades gracefully. Never throws.
 */
export async function suggestMerges(
  names: string[],
  category?: MergeSuggestCategory,
  brand?: string,
): Promise<MergeSuggestResult> {
  let aliases: MergeAlias[] = [];
  try {
    aliases = await fetchMergeAliases(category, brand);
  } catch {
    aliases = [];
  }
  // Denied (ignored) pairs are dropped from whatever suggestions we end up
  // showing — AI or remembered-only — so an ignored pair never comes back.
  let denied: DeniedMerge[] = [];
  try {
    denied = await fetchDeniedMerges(category, brand);
  } catch {
    denied = [];
  }
  // Deterministic look-alike scan (word-order + single-typo near-dups) runs
  // locally with no AI call, so obvious duplicates surface even offline or for
  // users without the AI capability. Folded under remembered groups by target.
  const baseline = mergeSuggestionLists(
    suggestionsFromAliases(names, aliases),
    nearDupSuggestions(names),
  );
  try {
    const ai = await requestAiSuggestMerges(names, aliases, category, brand);
    // mergeSuggestionLists rebuilds group objects (dropping the reviewer verdict),
    // so re-attach each AI group's verdict to the merged result by target name.
    const reviewByTarget = new Map<string, ReviewVerdict>();
    for (const s of ai) {
      if (s.review) reviewByTarget.set(s.target.trim().toLowerCase(), s.review);
    }
    const merged = mergeSuggestionLists(baseline, ai).map((s) => {
      const review = reviewByTarget.get(s.target.trim().toLowerCase());
      return review ? { ...s, review } : s;
    });
    // Conflicting-descriptor guard (e.g. "cured" vs "natural" are different
    // products): stripped from every shown suggestion, AI or baseline.
    return {
      suggestions: filterConflictingSuggestions(filterDeniedSuggestions(merged, denied)),
      usedAi: true,
    };
  } catch (e) {
    return {
      suggestions: filterConflictingSuggestions(filterDeniedSuggestions(baseline, denied)),
      usedAi: false,
      error: e instanceof Error ? e.message : "AI suggestions unavailable",
    };
  }
}
