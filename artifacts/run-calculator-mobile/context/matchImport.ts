// AI brand/flavor matcher for Excel imports — mobile platform glue.
//
// The read-only POST /ai/match-import endpoint takes the imported brand/flavor
// names that did not exactly match a saved one, plus the saved brands/flavors,
// and returns the best saved match for each (only when the model is confident).
// The import modal uses these as pre-selected suggestions; the user can always
// override. On any failure (e.g. AI unavailable, not a manager, sync disabled)
// the modal silently falls back to its existing Levenshtein fuzzy matching.
//
// This module NEVER writes anything. Mirrors the web glue in
// artifacts/run-calculator/src/matchImport.ts (replit.md parity).

import { getAuthToken } from "@workspace/api-client-react";
import type { ReviewVerdict } from "@workspace/ai-review";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type MatchImportInput = {
  brands: string[];
  brandFlavors: Record<string, string[]>;
  unmatchedBrands: string[];
  unmatchedFlavors: { brand: string; flavor: string }[];
  knownIngredients?: Record<"dough" | "sauce" | "cheese", string[]>;
  knownAppTypes?: string[];
  knownPepTypes?: string[];
  unmatchedIngredients?: { kind: "dough" | "sauce" | "cheese"; name: string }[];
  unmatchedAppTypes?: string[];
  unmatchedPepTypes?: string[];
};

export type BrandMatch = { candidate: string; match: string; review?: ReviewVerdict };
export type FlavorMatch = {
  brand: string;
  candidate: string;
  match: string;
  review?: ReviewVerdict;
};
export type IngredientMatch = {
  kind: "dough" | "sauce" | "cheese";
  candidate: string;
  match: string;
  review?: ReviewVerdict;
};
export type NameMatch = { candidate: string; match: string; review?: ReviewVerdict };

export type MatchImportResult = {
  brandMatches: BrandMatch[];
  flavorMatches: FlavorMatch[];
  ingredientMatches?: IngredientMatch[];
  appTypeMatches?: NameMatch[];
  pepTypeMatches?: NameMatch[];
  generatedAt: number;
  note?: string;
};

export async function requestMatchImport(input: MatchImportInput): Promise<MatchImportResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/match-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Match-import request failed (${res.status})`);
  }
  return (await res.json()) as MatchImportResult;
}
