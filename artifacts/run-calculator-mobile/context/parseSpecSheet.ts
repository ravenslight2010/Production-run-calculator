// AI spec-sheet parser for Excel imports — mobile platform glue.
//
// The read-only POST /ai/parse-spec-sheet endpoint takes the flattened workbook
// text plus the app's known canonical lists and learned aliases, and returns
// structured spec profiles + dough/sauce/cheese recipes (the model reuses a
// known name verbatim when the workbook clearly means it, so existing
// profiles/recipes are updated rather than duplicated). The server sanitizes the
// result; this client just forwards it. On any failure (AI unavailable, not a
// manager) the caller surfaces the error — there is no usable fallback for a
// free-form spreadsheet.
//
// This module NEVER writes anything. Mirrors the web glue in
// artifacts/run-calculator/src/parseSpecSheet.ts (replit.md parity). The one
// platform difference is plumbing: mobile threads the session bearer token +
// client id through fetch (no cookie jar), exactly like context/aiOptimize.ts.

import { getAuthToken } from "@workspace/api-client-react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
  SpecImportAlias,
} from "@workspace/spec-import";
import type { ReviewVerdict } from "@workspace/ai-review";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type SpecSheetKnown = {
  brands?: string[];
  flavorsByBrand?: Record<string, string[]>;
  appTypes?: string[];
  pepTypes?: string[];
  cheeseIngredients?: string[];
  doughIngredients?: string[];
  sauceIngredients?: string[];
  dieTypes?: string[];
  /** Existing recipe names per kind — grounds paraphrased recipe names so a
   * near-match snaps to (or is flagged against) the existing recipe instead of
   * importing as a silent near-duplicate. */
  doughRecipes?: string[];
  sauceRecipes?: string[];
  cheeseRecipes?: string[];
};

export type ParseSpecSheetInput = {
  workbookText: string;
  known?: SpecSheetKnown;
  aliases?: SpecImportAlias[];
};

export type ReviewedProfile = ParsedProfile & { review?: ReviewVerdict };
export type ReviewedRecipe = ParsedRecipe & { review?: ReviewVerdict };

export type ParseSpecSheetResult = Omit<ParsedSpecImport, "profiles" | "recipes"> & {
  profiles: ReviewedProfile[];
  recipes: ReviewedRecipe[];
  generatedAt: number;
};

export async function requestParseSpecSheet(
  input: ParseSpecSheetInput,
): Promise<ParseSpecSheetResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/parse-spec-sheet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {}
    throw new Error(detail || `Parse-spec-sheet request failed (${res.status})`);
  }
  return (await res.json()) as ParseSpecSheetResult;
}
