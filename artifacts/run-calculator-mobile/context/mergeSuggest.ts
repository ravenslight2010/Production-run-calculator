// AI-assisted ingredient merge suggestions — mobile platform glue.
//
// Mirror of the web glue in artifacts/run-calculator/src/mergeSuggest.ts
// (replit.md parity). Two cooperating pieces:
//   - The read-only POST /ai/suggest-merges endpoint clusters the app's
//     mergeable names into groups of duplicates with a recommended canonical
//     name to keep.
//   - Learned merge aliases (GET/POST /merge-aliases) remember every confirmed
//     merge so the same duplicates resurface — fed to the AI and used to seed
//     "previously merged" suggestions even without an AI call.
//
// All pure logic lives in @workspace/merge-suggest. The one platform difference
// is plumbing: mobile threads the session bearer token + client id through
// fetch (no cookie jar), exactly like context/specImportAliases.ts.

import { getAuthToken } from "@workspace/api-client-react";
import {
  mergeSuggestionLists,
  suggestionsFromAliases,
  collectDeniedPairs,
  filterDeniedSuggestions,
  type MergeAlias,
  type MergeSuggestion,
  type DeniedMerge,
} from "@workspace/merge-suggest";
import type { ReviewVerdict } from "@workspace/ai-review";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type { MergeAlias, MergeSuggestion, DeniedMerge };

/** A merge suggestion plus its (optional) reviewer-AI verdict. */
export type ReviewedMergeSuggestion = MergeSuggestion & { review?: ReviewVerdict };

export async function fetchMergeAliases(): Promise<MergeAlias[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/merge-aliases`, {
    headers: {
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`List merge aliases failed (${res.status})`);
  const data = (await res.json()) as { aliases: MergeAlias[] };
  return data.aliases ?? [];
}

export async function saveMergeAliases(aliases: MergeAlias[]): Promise<void> {
  if (aliases.length === 0) return;
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/merge-aliases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ aliases }),
  });
  if (!res.ok) throw new Error(`Save merge aliases failed (${res.status})`);
}

/** Fetch the factory-wide set of denied (ignored) merge pairs. */
export async function fetchDeniedMerges(): Promise<DeniedMerge[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/denied-merges`, {
    headers: {
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
export async function denyMerge(target: string, sources: string[]): Promise<void> {
  const pairs = collectDeniedPairs(target, sources);
  if (pairs.length === 0) return;
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/denied-merges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ pairs }),
  });
  if (!res.ok) throw new Error(`Save denied merges failed (${res.status})`);
}

/**
 * Fetch the durable, factory-wide set of merged-away names. This is the
 * authoritative tombstone that survives the per-day, last-write-wins sync blob:
 * a device that was offline during a merge fetches this on load, unions it into
 * its local tombstone, and strips the names from every master list so a merge
 * never resurfaces across a day boundary. Web parity.
 */
export async function fetchMergedAwayNames(): Promise<string[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/merged-away`, {
    headers: {
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/merged-away`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/merged-away`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ names: cleaned }),
  });
  if (!res.ok) throw new Error(`Delete merged-away failed (${res.status})`);
}

async function requestAiSuggestMerges(
  names: string[],
  aliases: MergeAlias[],
): Promise<ReviewedMergeSuggestion[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/suggest-merges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ names, aliases }),
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
export async function suggestMerges(names: string[]): Promise<MergeSuggestResult> {
  let aliases: MergeAlias[] = [];
  try {
    aliases = await fetchMergeAliases();
  } catch {
    aliases = [];
  }
  // Denied (ignored) pairs are dropped from whatever suggestions we end up
  // showing — AI or remembered-only — so an ignored pair never comes back.
  let denied: DeniedMerge[] = [];
  try {
    denied = await fetchDeniedMerges();
  } catch {
    denied = [];
  }
  const remembered = suggestionsFromAliases(names, aliases);
  try {
    const ai = await requestAiSuggestMerges(names, aliases);
    // mergeSuggestionLists rebuilds group objects (dropping the reviewer verdict),
    // so re-attach each AI group's verdict to the merged result by target name.
    const reviewByTarget = new Map<string, ReviewVerdict>();
    for (const s of ai) {
      if (s.review) reviewByTarget.set(s.target.trim().toLowerCase(), s.review);
    }
    const merged = mergeSuggestionLists(remembered, ai).map((s) => {
      const review = reviewByTarget.get(s.target.trim().toLowerCase());
      return review ? { ...s, review } : s;
    });
    return { suggestions: filterDeniedSuggestions(merged, denied), usedAi: true };
  } catch (e) {
    return {
      suggestions: filterDeniedSuggestions(remembered, denied),
      usedAi: false,
      error: e instanceof Error ? e.message : "AI suggestions unavailable",
    };
  }
}
