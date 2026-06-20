// AI spec-sheet parser for Excel imports — web platform glue.
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
// This module NEVER writes anything. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/parseSpecSheet.ts (replit.md parity).

import type {
  ParsedSpecImport,
  ParsedProfile,
  ParsedRecipe,
  SpecImportAlias,
} from "@workspace/spec-import";
import type { ReviewVerdict } from "@workspace/ai-review";
import { inventoryClientId } from "./inventoryShared";

export type SpecSheetKnown = {
  brands?: string[];
  flavorsByBrand?: Record<string, string[]>;
  appTypes?: string[];
  pepTypes?: string[];
  cheeseIngredients?: string[];
  doughIngredients?: string[];
  sauceIngredients?: string[];
  dieTypes?: string[];
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
  const res = await fetch("/api/ai/parse-spec-sheet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
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
