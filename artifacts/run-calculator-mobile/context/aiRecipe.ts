// Recipe & ingredient assistant — mobile platform glue.
//
// A thin client over POST /ai/recipe-assistant: send a plain-language recipe/
// ingredient question plus the current run's recipe rows, the known ingredient
// pool, and optional run context, and get back a grounded plain-language answer.
// Advisory only — never edits a recipe. Mirrors the web glue in
// artifacts/run-calculator/src/aiRecipe.ts (replit.md parity); the only
// difference is plumbing (mobile threads the session bearer token + client id
// through fetch, exactly like context/inventoryShared.ts).

import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError, photoErrorMessage } from "./inventoryShared";

export type RecipeAssistRow = { ingredient: string; lbs: number };

export type RecipeAssistRecipe = {
  id?: string;
  kind: string;
  name: string;
  rows: RecipeAssistRow[];
};

// The stable settings-field keys for the current run's recipes, in the order
// the builder sends them. These double as the suggestion `recipeId`, so the
// client can route an applied suggestion straight back to the right recipe.
// Identical on web + mobile (replit.md parity).
export const RECIPE_FIELD_IDS = [
  "doughRecipe",
  "frontlineRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
] as const;
export type RecipeFieldId = (typeof RECIPE_FIELD_IDS)[number];

// A structured, confirm-first edit returned by the assistant for a SCALE or
// SUBSTITUTE question — the complete resulting rows for one recipe. Advisory:
// nothing changes until the worker taps Apply.
export type RecipeAssistSuggestion = {
  kind: "scale" | "substitute";
  recipeId: string;
  recipeName?: string;
  summary?: string;
  rows: RecipeAssistRow[];
};

// A run the worker can target when applying a suggestion. The label mirrors the
// run pickers used elsewhere in the app. The suggestion itself is run-agnostic
// (it only names a recipe field via recipeId), so the chosen target run is passed
// separately at apply time. Identical on web + mobile (replit.md parity).
export type RecipeApplyTarget = { id: string; label: string };

export type RecipeAssistContext = {
  brand?: string;
  flavor?: string;
  casesNeeded?: number;
  pizzasPerCase?: number;
  doughballWeightOz?: number;
};

export type RecipeAssistInput = {
  question: string;
  recipes: RecipeAssistRecipe[];
  ingredientNames?: string[];
  context?: RecipeAssistContext;
};

export type RecipeAssistResult = {
  answer: string;
  generatedAt: number;
  note?: string;
  suggestion?: RecipeAssistSuggestion;
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

// The current run's recipe fields. Both platforms store these under the exact
// same keys (dough, four cheese applications, and the frontline = Sauce recipe),
// so this builder is shared verbatim across web and mobile (replit.md parity).
export type RecipeAssistSourceSettings = {
  doughRecipeName?: string;
  doughRecipe?: RecipeAssistRow[];
  app1CheeseRecipeName?: string;
  app1CheeseRecipe?: RecipeAssistRow[];
  app2CheeseRecipeName?: string;
  app2CheeseRecipe?: RecipeAssistRow[];
  app3CheeseRecipeName?: string;
  app3CheeseRecipe?: RecipeAssistRow[];
  app4CheeseRecipeName?: string;
  app4CheeseRecipe?: RecipeAssistRow[];
  frontlineRecipeName?: string;
  frontlineRecipe?: RecipeAssistRow[];
};

// Shape the current run's recipes, the known ingredient pool, and run context
// into the wire payload (minus the question). Only non-empty recipes and
// meaningful (>0 / non-blank) context fields are sent so the model is grounded
// strictly in real data. The "frontline" recipe is the UI's Sauce recipe, so it
// is tagged kind "sauce". Pure + identical on both platforms for parity/testing.
export function buildRecipeAssistContext(
  settings: RecipeAssistSourceSettings,
  ingredientNames: string[],
  context: RecipeAssistContext,
): Omit<RecipeAssistInput, "question"> {
  const recipes: RecipeAssistRecipe[] = [];
  const add = (
    id: RecipeFieldId,
    kind: string,
    name: string | undefined,
    rows: RecipeAssistRow[] | undefined,
  ) => {
    const clean = (rows ?? [])
      .filter((r) => (r.ingredient ?? "").trim())
      .map((r) => ({ ingredient: r.ingredient.trim(), lbs: Number(r.lbs) || 0 }));
    if (clean.length) recipes.push({ id, kind, name: (name ?? "").trim(), rows: clean });
  };
  add("doughRecipe", "dough", settings.doughRecipeName, settings.doughRecipe);
  add("frontlineRecipe", "sauce", settings.frontlineRecipeName, settings.frontlineRecipe);
  add("app1CheeseRecipe", "cheese", settings.app1CheeseRecipeName, settings.app1CheeseRecipe);
  add("app2CheeseRecipe", "cheese", settings.app2CheeseRecipeName, settings.app2CheeseRecipe);
  add("app3CheeseRecipe", "cheese", settings.app3CheeseRecipeName, settings.app3CheeseRecipe);
  add("app4CheeseRecipe", "cheese", settings.app4CheeseRecipeName, settings.app4CheeseRecipe);

  const names = Array.from(
    new Map(
      (ingredientNames ?? []).map((n) => [n.trim().toLowerCase(), n.trim()] as const),
    ).values(),
  ).filter(Boolean);

  const ctx: RecipeAssistContext = {};
  if (context.brand?.trim()) ctx.brand = context.brand.trim();
  if (context.flavor?.trim()) ctx.flavor = context.flavor.trim();
  if (Number.isFinite(context.casesNeeded) && (context.casesNeeded ?? 0) > 0)
    ctx.casesNeeded = context.casesNeeded;
  if (Number.isFinite(context.pizzasPerCase) && (context.pizzasPerCase ?? 0) > 0)
    ctx.pizzasPerCase = context.pizzasPerCase;
  if (Number.isFinite(context.doughballWeightOz) && (context.doughballWeightOz ?? 0) > 0)
    ctx.doughballWeightOz = context.doughballWeightOz;

  return {
    recipes,
    ...(names.length ? { ingredientNames: names } : {}),
    ...(Object.keys(ctx).length ? { context: ctx } : {}),
  };
}
