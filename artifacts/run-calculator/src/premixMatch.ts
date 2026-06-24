// AI premix product-name matcher for Excel imports — web platform glue.
//
// The read-only POST /ai/match-premix endpoint takes the premix block names that
// did not resolve to a saved brand+flavor deterministically, plus the saved
// brands/flavors, and returns the model's best saved product match for each.
// The importer uses these only to disambiguate product names; all quantities are
// parsed deterministically in @workspace/premix-import. On any failure (AI
// unavailable, not a manager) the importer silently proceeds with whatever
// deterministic grounding it already has.
//
// This module NEVER writes anything. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/premixMatch.ts (replit.md parity).

import type { PremixMatch } from "@workspace/premix-import";
import { inventoryClientId } from "./inventoryShared";

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
  const res = await fetch("/api/ai/match-premix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Match-premix request failed (${res.status})`);
  }
  return (await res.json()) as MatchPremixResult;
}
