// Recipe & ingredient assistant — web platform glue.
//
// A thin client over POST /ai/recipe-assistant: send a plain-language recipe/
// ingredient question plus the current run's recipe rows, the known ingredient
// pool, and optional run context, and get back a grounded plain-language answer.
// Advisory only — never edits a recipe. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/aiRecipe.ts (replit.md parity); the
// only difference is plumbing (cookie session vs. bearer token).
//
// The recipe field ids, the assist-context builder, and the shared row/recipe/
// context types all live in @workspace/recipe-apply so they can never drift
// between web and mobile. This file re-exports them and keeps only the web fetch
// glue.

import {
  InventoryApiError,
  inventoryClientId,
  photoErrorMessage,
  postEventStream,
} from "./inventoryShared";
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
  const res = await fetch("/api/ai/recipe-assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
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

// Streaming variant: stream the answer text live via onDelta, then resolve with
// the same RecipeAssistResult (incl. any apply-able suggestion) the non-stream
// endpoint returns. Throws InventoryApiError on any failure so the caller can
// fall back to requestRecipeAssist. Mirrors mobile.
export async function requestRecipeAssistStream(
  input: RecipeAssistInput,
  onDelta: (text: string) => void,
): Promise<RecipeAssistResult> {
  return await postEventStream<RecipeAssistResult>(
    "/ai/recipe-assistant",
    input,
    onDelta,
    "Recipe assistant request failed",
  );
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const recipeAssistErrorMessage = photoErrorMessage;
