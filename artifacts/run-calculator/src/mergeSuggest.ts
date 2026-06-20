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
  type MergeAlias,
  type MergeSuggestion,
} from "@workspace/merge-suggest";
import { inventoryClientId } from "./inventoryShared";

export type { MergeAlias, MergeSuggestion };

export async function fetchMergeAliases(): Promise<MergeAlias[]> {
  const res = await fetch("/api/merge-aliases", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List merge aliases failed (${res.status})`);
  const data = (await res.json()) as { aliases: MergeAlias[] };
  return data.aliases ?? [];
}

export async function saveMergeAliases(aliases: MergeAlias[]): Promise<void> {
  if (aliases.length === 0) return;
  const res = await fetch("/api/merge-aliases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ aliases }),
  });
  if (!res.ok) throw new Error(`Save merge aliases failed (${res.status})`);
}

async function requestAiSuggestMerges(
  names: string[],
  aliases: MergeAlias[],
): Promise<MergeSuggestion[]> {
  const res = await fetch("/api/ai/suggest-merges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
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
  const data = (await res.json()) as { suggestions?: MergeSuggestion[] };
  return data.suggestions ?? [];
}

export type MergeSuggestResult = {
  suggestions: MergeSuggestion[];
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
  const remembered = suggestionsFromAliases(names, aliases);
  try {
    const ai = await requestAiSuggestMerges(names, aliases);
    return { suggestions: mergeSuggestionLists(remembered, ai), usedAi: true };
  } catch (e) {
    return {
      suggestions: remembered,
      usedAi: false,
      error: e instanceof Error ? e.message : "AI suggestions unavailable",
    };
  }
}
