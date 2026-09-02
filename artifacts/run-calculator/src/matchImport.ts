// AI brand/flavor matcher for Excel imports — web platform glue.
//
// The read-only POST /ai/match-import endpoint takes the imported brand/flavor
// names that did not exactly match a saved one, plus the saved brands/flavors,
// and returns the best saved match for each (only when the model is confident).
// The import dialog uses these as pre-selected suggestions; the user can always
// override. On any failure (e.g. AI unavailable, not a manager) the dialog
// silently falls back to its existing Levenshtein fuzzy matching.
//
// This module NEVER writes anything. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/matchImport.ts (replit.md parity).

import type { ReviewVerdict } from "@workspace/ai-review";
import type { AiStatus } from "./aiStatus";
import { inventoryClientId } from "./inventoryShared";
import { fetchWithTimeout } from "./fetchWithTimeout";

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
  aiStatus?: AiStatus;
};

export async function requestMatchImport(input: MatchImportInput): Promise<MatchImportResult> {
  // Bounded wait so a cold-starting deployment can't hang the import's loading
  // dialog forever; callers fall back to fuzzy matching on any failure.
  const res = await fetchWithTimeout(
    "/api/ai/match-import",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": inventoryClientId(),
      },
      body: JSON.stringify(input),
    },
    120_000,
  );
  if (!res.ok) {
    throw new Error(`Match-import request failed (${res.status})`);
  }
  return (await res.json()) as MatchImportResult;
}
