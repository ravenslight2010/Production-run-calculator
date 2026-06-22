// Recipe & ingredient assistant — mobile platform glue.
//
// A thin client over POST /ai/recipe-assistant: send a plain-language recipe/
// ingredient question plus the current run's recipe rows, the known ingredient
// pool, and optional run context, and get back a grounded plain-language answer.
// Advisory only — never edits a recipe. Mirrors the web glue in
// artifacts/run-calculator/src/aiRecipe.ts (replit.md parity); the only
// difference is plumbing (mobile threads the session bearer token + client id
// through fetch, exactly like context/inventoryShared.ts).
//
// The recipe field ids, the assist-context builder, and the shared row/recipe/
// context types all live in @workspace/recipe-apply so they can never drift
// between web and mobile. This file re-exports them and keeps only the mobile
// fetch glue.

import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError, photoErrorMessage } from "./inventoryShared";
import {
  buildRecipeAssistContext,
  RECIPE_FIELD_IDS,
  type RecipeFieldId,
  type RecipeAssistRow,
  type RecipeAssistRecipe,
  type RecipeAssistSuggestion,
  type RecipeApplyTarget,
  type RecipeAssistContext,
  type RecipeAssistInput,
  type RecipeAssistResult,
  type RecipeAssistSourceSettings,
} from "@workspace/recipe-apply";

export {
  buildRecipeAssistContext,
  RECIPE_FIELD_IDS,
  type RecipeFieldId,
  type RecipeAssistRow,
  type RecipeAssistRecipe,
  type RecipeAssistSuggestion,
  type RecipeApplyTarget,
  type RecipeAssistContext,
  type RecipeAssistInput,
  type RecipeAssistResult,
  type RecipeAssistSourceSettings,
};

export async function requestRecipeAssist(input: RecipeAssistInput): Promise<RecipeAssistResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/recipe-assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Recipe assistant request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as RecipeAssistResult;
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const recipeAssistErrorMessage = photoErrorMessage;
