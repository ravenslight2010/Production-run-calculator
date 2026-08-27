import type { CheeseRecipe, CheeseComponent } from "@workspace/cheese-recipes";
import { normalizeCheeseRecipe } from "@workspace/cheese-recipes";

export type CheeseRepairSource = "cheese";
export type CheeseRepairStatus = "new" | "drift" | "ambiguous";
export type CheeseRepairType =
  | "missing-recipe"
  | "missing-component"
  | "extra-component"
  | "amount-mismatch"
  | "assignment-mismatch"
  | "metadata-mismatch";

export type CheeseRepairDiscrepancy = {
  source: CheeseRepairSource;
  type: CheeseRepairType;
  recipeName: string;
  brand: string;
  ingredient?: string;
  sourceValue?: string | number;
  currentValue?: string | number;
  message: string;
};

export type CheeseRepairItem = {
  source: CheeseRepairSource;
  status: CheeseRepairStatus;
  recipeId: string;
  recipeName: string;
  brand: string;
  discrepancies: CheeseRepairDiscrepancy[];
  suggestedRecipe?: CheeseRecipe;
  /** Identity used to reject an apply after another manager edits the pool. */
  matchedRecipeId?: string;
  currentSignature?: string;
};

export type CheeseRepairOutput = {
  discrepancies: CheeseRepairDiscrepancy[];
  items: CheeseRepairItem[];
};

const DEFAULT_TOLERANCE = 0.0005;

const ci = (value: unknown) => String(value ?? "").trim().toLowerCase();
const listKey = (values: ReadonlyArray<string>) => values.map(ci).filter(Boolean).sort().join("\u0000");
const signature = (recipe: CheeseRecipe) => JSON.stringify({
  id: recipe.id,
  name: recipe.name,
  brand: recipe.brand,
  flavors: [...recipe.flavors].map(ci).sort(),
  shredderSetting: recipe.shredderSetting,
  cellulose: recipe.cellulose,
  notes: recipe.notes,
  components: recipe.components.map((c) => ({
    ingredient: ci(c.ingredient),
    lbs: c.lbs,
    ozPerPizza: c.ozPerPizza ?? 0,
    sharePct: c.sharePct ?? 0,
  })).sort((a, b) => a.ingredient.localeCompare(b.ingredient)),
  enabled: recipe.enabled,
});

function componentMap(components: ReadonlyArray<CheeseComponent>) {
  const out = new Map<string, CheeseComponent>();
  for (const component of components) out.set(ci(component.ingredient), component);
  return out;
}

function display(value: string | number | undefined): string {
  return typeof value === "number" ? String(value) : value || "blank";
}

function sourceRecipe(raw: unknown): CheeseRecipe | null {
  return normalizeCheeseRecipe(raw);
}

function sameIdentity(a: CheeseRecipe, b: CheeseRecipe): boolean {
  return ci(a.brand) === ci(b.brand) && ci(a.name) === ci(b.name);
}

/**
 * Compare a parsed Cheese Mix Recipe Specs source with the current cheese pool.
 * Matching is intentionally conservative: stable id first, then exact
 * case-insensitive brand + recipe name. Multiple exact-name candidates become
 * review-only rather than selecting an arbitrary row.
 *
 * Source-authored fields are components, assignments, shredder setting, and
 * cellulose. `enabled` and `notes` are operational manager fields and are
 * preserved in every suggested update. Current-only recipes are not emitted and
 * are never candidates for deletion.
 */
export function reconcileCheeseRecipes(input: {
  currentRecipes: ReadonlyArray<CheeseRecipe>;
  sourceRecipes: ReadonlyArray<unknown>;
  tolerance?: number;
}): CheeseRepairOutput {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const current = input.currentRecipes.map(sourceRecipe).filter((r): r is CheeseRecipe => r !== null);
  const byId = new Map(current.map((recipe) => [recipe.id, recipe]));
  const byIdentity = new Map<string, CheeseRecipe[]>();
  for (const recipe of current) {
    const key = `${ci(recipe.brand)}\u0000${ci(recipe.name)}`;
    const rows = byIdentity.get(key) ?? [];
    rows.push(recipe);
    byIdentity.set(key, rows);
  }

  const discrepancies: CheeseRepairDiscrepancy[] = [];
  const items: CheeseRepairItem[] = [];
  const seen = new Set<string>();

  for (const raw of input.sourceRecipes) {
    const source = sourceRecipe(raw);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    const identityMatches = byIdentity.get(`${ci(source.brand)}\u0000${ci(source.name)}`) ?? [];
    const matched = byId.get(source.id) ?? (identityMatches.length === 1 ? identityMatches[0] : undefined);

    if (!matched && identityMatches.length > 1) {
      const disc: CheeseRepairDiscrepancy = {
        source: "cheese",
        type: "metadata-mismatch",
        recipeName: source.name,
        brand: source.brand,
        message: `Several current cheese recipes match "${source.name}" for ${source.brand}; this source remains review-only.`,
      };
      discrepancies.push(disc);
      items.push({
        source: "cheese",
        status: "ambiguous",
        recipeId: source.id,
        recipeName: source.name,
        brand: source.brand,
        discrepancies: [disc],
      });
      continue;
    }

    if (!matched) {
      const disc: CheeseRepairDiscrepancy = {
        source: "cheese",
        type: "missing-recipe",
        recipeName: source.name,
        brand: source.brand,
        message: `No current cheese recipe exists for "${source.name}" (${source.brand}).`,
      };
      discrepancies.push(disc);
      items.push({
        source: "cheese",
        status: "new",
        recipeId: source.id,
        recipeName: source.name,
        brand: source.brand,
        discrepancies: [disc],
        suggestedRecipe: { ...source, notes: "", enabled: true },
      });
      continue;
    }

    const recipeDiscs: CheeseRepairDiscrepancy[] = [];
    const sourceComponents = componentMap(source.components);
    const currentComponents = componentMap(matched.components);
    for (const component of source.components) {
      const currentComponent = currentComponents.get(ci(component.ingredient));
      if (!currentComponent) {
        recipeDiscs.push({
          source: "cheese",
          type: "missing-component",
          recipeName: matched.name,
          brand: matched.brand,
          ingredient: component.ingredient,
          sourceValue: component.lbs,
          message: `"${matched.name}" is missing ${component.ingredient} (${display(component.lbs)} lb/batch) from the source.`,
        });
      } else if (Math.abs(currentComponent.lbs - component.lbs) > tolerance) {
        recipeDiscs.push({
          source: "cheese",
          type: "amount-mismatch",
          recipeName: matched.name,
          brand: matched.brand,
          ingredient: component.ingredient,
          sourceValue: component.lbs,
          currentValue: currentComponent.lbs,
          message: `${component.ingredient} in "${matched.name}" is ${display(currentComponent.lbs)} lb/batch; the source says ${display(component.lbs)}.`,
        });
      }
    }
    for (const component of matched.components) {
      if (!sourceComponents.has(ci(component.ingredient))) {
        recipeDiscs.push({
          source: "cheese",
          type: "extra-component",
          recipeName: matched.name,
          brand: matched.brand,
          ingredient: component.ingredient,
          currentValue: component.lbs,
          message: `"${matched.name}" has extra component ${component.ingredient} (${display(component.lbs)} lb/batch) not in the source.`,
        });
      }
    }
    if (listKey(source.flavors) !== listKey(matched.flavors)) {
      recipeDiscs.push({
        source: "cheese",
        type: "assignment-mismatch",
        recipeName: matched.name,
        brand: matched.brand,
        sourceValue: source.flavors.join(", ") || "All Varieties",
        currentValue: matched.flavors.join(", ") || "All Varieties",
        message: `"${matched.name}" assignments are ${matched.flavors.join(", ") || "All Varieties"} now; the source assigns ${source.flavors.join(", ") || "All Varieties"}.`,
      });
    }
    for (const [label, sourceValue, currentValue] of [
      ["shredder setting", source.shredderSetting, matched.shredderSetting],
      ["cellulose", source.cellulose, matched.cellulose],
    ] as const) {
      if (ci(sourceValue) !== ci(currentValue)) {
        recipeDiscs.push({
          source: "cheese",
          type: "metadata-mismatch",
          recipeName: matched.name,
          brand: matched.brand,
          sourceValue,
          currentValue,
          message: `"${matched.name}" ${label} is ${display(currentValue)} now; the source says ${display(sourceValue)}.`,
        });
      }
    }
    if (!recipeDiscs.length) continue;

    const mergedComponents = source.components.map((sourceComponent) => {
      const currentComponent = currentComponents.get(ci(sourceComponent.ingredient));
      return currentComponent
        ? {
            ...sourceComponent,
            ...(currentComponent.ozPerPizza != null ? { ozPerPizza: currentComponent.ozPerPizza } : {}),
            ...(currentComponent.sharePct != null ? { sharePct: currentComponent.sharePct } : {}),
          }
        : { ...sourceComponent };
    });
    discrepancies.push(...recipeDiscs);
    items.push({
      source: "cheese",
      status: "drift",
      recipeId: matched.id,
      recipeName: matched.name,
      brand: matched.brand,
      discrepancies: recipeDiscs,
      matchedRecipeId: matched.id,
      currentSignature: signature(matched),
      suggestedRecipe: {
        ...matched,
        flavors: [...source.flavors],
        shredderSetting: source.shredderSetting,
        cellulose: source.cellulose,
        components: mergedComponents,
      },
    });
  }
  return { discrepancies, items };
}

export function cheeseRecipeSignature(recipe: CheeseRecipe): string {
  return signature(recipe);
}

export function applyCheeseRepairItem(
  currentRecipes: ReadonlyArray<CheeseRecipe>,
  item: CheeseRepairItem,
): CheeseRecipe[] {
  if (!item.suggestedRecipe || item.status === "ambiguous") {
    throw new Error("This cheese repair requires review before it can be applied.");
  }
  const existing = [...currentRecipes];
  const index = item.matchedRecipeId
    ? existing.findIndex((recipe) => recipe.id === item.matchedRecipeId)
    : existing.findIndex((recipe) => sameIdentity(recipe, item.suggestedRecipe!));
  if (item.currentSignature) {
    if (index < 0 || cheeseRecipeSignature(existing[index]!) !== item.currentSignature) {
      throw new Error("The current cheese recipe changed while this repair was open. Refresh and review it again.");
    }
  } else if (index >= 0) {
    throw new Error("A matching cheese recipe was added while this repair was open. Refresh and review it again.");
  }
  if (index < 0) return [...existing, item.suggestedRecipe];
  existing[index] = {
    ...item.suggestedRecipe,
    // Keep operational state even if a caller supplied an incomplete source.
    enabled: existing[index]!.enabled,
    notes: existing[index]!.notes,
  };
  return existing;
}