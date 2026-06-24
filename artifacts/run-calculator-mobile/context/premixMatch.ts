// AI premix product-name matcher for Excel imports — mobile platform glue.
//
// The read-only POST /ai/match-premix endpoint takes the premix block names that
// did not resolve to a saved brand+flavor deterministically, plus the saved
// brands/flavors, and returns the model's best saved product match for each.
// The importer uses these only to disambiguate product names; all quantities are
// parsed deterministically in @workspace/premix-import. On any failure (AI
// unavailable, not a manager, sync disabled) the importer silently proceeds with
// whatever deterministic grounding it already has.
//
// This module NEVER writes anything. Mirrors the web glue in
// artifacts/run-calculator/src/premixMatch.ts (replit.md parity).

import { getAuthToken } from "@workspace/api-client-react";
import type { PremixMatch } from "@workspace/premix-import";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type MatchPremixInput = {
  unmatchedNames: string[];
  brands: string[];
  brandFlavors: Record<string, string[]>;
};

export type MatchPremixResult = {
  matches: PremixMatch[];
  generatedAt: number;
  note?: string;
};

export async function requestMatchPremix(input: MatchPremixInput): Promise<MatchPremixResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/match-premix`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Match-premix request failed (${res.status})`);
  }
  return (await res.json()) as MatchPremixResult;
}
