import {
  assignApplicatorSlots,
  specImportNameMatchKey,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import type { FormValues } from "./types";

export type SpecImportImpactRun = {
  brand: string;
  flavor: string;
  values: FormValues;
};

export type SpecImportImpactProjection =
  | { status: "ready"; values: FormValues; profileLabel: string }
  | { status: "unavailable"; reason: string };

type RecipeKind = "dough" | "sauce" | "cheese" | "mix";
type RecipeClassifier = (recipe: ParsedRecipe) => RecipeKind;

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = specImportNameMatchKey(a ?? "");
  return !!left && left === specImportNameMatchKey(b ?? "");
}

function sameProfile(
  a: { brand?: string; flavor?: string } | undefined,
  brand: string,
  flavor: string,
): boolean {
  return (
    !!a &&
    a.brand?.trim().toLowerCase() === brand.trim().toLowerCase() &&
    a.flavor?.trim().toLowerCase() === flavor.trim().toLowerCase()
  );
}

function profileFromRecipeName(
  recipes: readonly ParsedRecipe[],
  kind: ParsedRecipe["kind"],
  name: string,
): ParsedRecipe | undefined {
  return recipes.find((recipe) => recipe.kind === kind && sameName(recipe.name, name));
}

/**
 * Build the current selected run's post-import values without writing profiles,
 * recipes, inventory, or ledger rows. This mirrors the spec-import profile and
 * recipe links that can affect the selected run; it intentionally does not
 * invent case counts or project unrelated products in a multi-profile workbook.
 */
export function projectSpecImportForRun(
  run: SpecImportImpactRun | null,
  parsed: ParsedSpecImport,
  forceUpdateProfileKeys: ReadonlySet<string>,
  classifyRecipe: RecipeClassifier,
): SpecImportImpactProjection {
  if (!run?.brand.trim() || !run.flavor.trim()) {
    return { status: "unavailable", reason: "Select a run with a brand and flavor to preview its demand." };
  }

  const brand = run.brand.trim();
  const flavor = run.flavor.trim();
  const importedProfile = parsed.profiles.find((profile) => sameProfile(profile, brand, flavor));
  const forceKey = `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`;
  const forced = forceUpdateProfileKeys.has(forceKey);
  const before = run.values;
  const after: FormValues = { ...before };

  if (importedProfile) {
    applyProfilePreview(after, importedProfile, parsed.recipes, classifyRecipe, forced);
  }

  const hasMatchingRecipe = parsed.recipes.some((recipe) =>
    recipeCanAffectRun(recipe, before, after, importedProfile, brand, flavor, classifyRecipe),
  );
  if (!importedProfile && !hasMatchingRecipe) {
    return {
      status: "unavailable",
      reason: `This import has no reviewed changes linked to the selected run (${brand} — ${flavor}).`,
    };
  }

  for (const recipe of parsed.recipes) {
    if (
      recipe.referenceOnly ||
      !recipeCanAffectRun(recipe, before, after, importedProfile, brand, flavor, classifyRecipe)
    ) {
      continue;
    }
    applyRecipeRows(after, recipe, classifyRecipe);
  }

  if (!(Number(before.casesNeeded) > 0)) {
    return {
      status: "unavailable",
      reason: "Enter a positive case count on the selected run to calculate demand.",
    };
  }
  if (!(Number(before.pizzasPerCase) > 0) || !(Number(after.pizzasPerCase) > 0)) {
    return {
      status: "unavailable",
      reason: "A positive pizzas-per-case value is needed before and after the import to compare demand.",
    };
  }

  return { status: "ready", values: after, profileLabel: `${brand} — ${flavor}` };
}

function applyProfilePreview(
  values: FormValues,
  profile: ParsedProfile,
  recipes: readonly ParsedRecipe[],
  classifyRecipe: RecipeClassifier,
  forced: boolean,
): void {
  if (profile.sauceOzPerPizza != null) values.sauceOzPerPizza = profile.sauceOzPerPizza;
  if (profile.targetDoughballWeight != null && profile.targetDoughballWeight > 0) {
    values.targetDoughballWeight = profile.targetDoughballWeight;
  }
  if (profile.doughballsPerTray != null && profile.doughballsPerTray > 0) {
    values.doughballsPerTray = profile.doughballsPerTray;
  }
  if (profile.pizzasPerCase != null && profile.pizzasPerCase > 0) {
    values.pizzasPerCase = profile.pizzasPerCase;
  }
  if (profile.sauceBarrelLbs != null && profile.sauceBarrelLbs > 0) {
    values.sauceBarrelLbs = profile.sauceBarrelLbs;
  }

  const hasMixedSauce = values.frontlineRecipe.some((row) => Number(row.lbs) > 0);
  if (profile.sauceName?.trim() && (!hasMixedSauce || forced)) {
    values.frontlineRecipeName = profile.sauceName.trim();
  }
  const hasMixedDough = values.doughRecipe.some((row) => Number(row.lbs) > 0);
  if (profile.doughName?.trim() && (!hasMixedDough || forced)) {
    values.doughRecipeName = profile.doughName.trim();
  }

  assignApplicatorSlots(profile.applicators ?? []).forEach((app, index) => {
    const slot = index + 1;
    const parsedType = app.type.trim();
    if (!parsedType) return;
    const linkedName = app.recipeName?.trim() || parsedType;
    const linkedRecipe = profileFromRecipeName(recipes, "cheese", linkedName);
    const explicitKind = parsedType.toLowerCase();
    const type = explicitKind === "mix"
      ? "Mix"
      : explicitKind === "cheese"
        ? "cheese"
        : linkedRecipe
          ? classifyRecipe(linkedRecipe) === "mix" ? "Mix" : "cheese"
          : parsedType;
    (values as Record<string, unknown>)[`app${slot}Type`] = type;
    (values as Record<string, unknown>)[`app${slot}OzPerPizza`] = app.ozPerPizza;
    if (app.batchLbs != null && app.batchLbs > 0) {
      (values as Record<string, unknown>)[`app${slot}BatchLbs`] = app.batchLbs;
    }
    if (app.recipeName?.trim()) {
      (values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = app.recipeName.trim();
    } else if (linkedRecipe) {
      (values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = linkedRecipe.name;
    }
  });

  const namedPepperonis = (profile.pepperonis ?? []).slice(0, 2).filter((pep) => pep.type.trim());
  namedPepperonis.forEach((pep, index) => {
    const slot = index + 1;
    (values as Record<string, unknown>)[`pep${slot}Type`] = pep.type.trim();
    (values as Record<string, unknown>)[`pep${slot}Sticks`] = pep.sticks;
    (values as Record<string, unknown>)[`pep${slot}OzPerPizza`] = pep.ozPerPizza;
    if (pep.batchLbs != null && pep.batchLbs > 0) {
      (values as Record<string, unknown>)[`pep${slot}BatchLbs`] = pep.batchLbs;
    }
  });
  if (namedPepperonis.length > 0) values.pep1Combined = namedPepperonis.length >= 2 ? false : true;
}

function recipeCanAffectRun(
  recipe: ParsedRecipe,
  before: FormValues,
  after: FormValues,
  importedProfile: ParsedProfile | undefined,
  brand: string,
  flavor: string,
  classifyRecipe: RecipeClassifier,
): boolean {
  const sameSheetProfile = sameProfile(recipe, brand, flavor) && !!importedProfile;
  if (recipe.kind === "dough") {
    return sameSheetProfile ||
      sameName(recipe.name, before.doughRecipeName) ||
      sameName(recipe.name, after.doughRecipeName) ||
      sameName(recipe.name, importedProfile?.doughName);
  }
  if (recipe.kind === "sauce") {
    return sameSheetProfile ||
      sameName(recipe.name, before.frontlineRecipeName) ||
      sameName(recipe.name, after.frontlineRecipeName) ||
      sameName(recipe.name, importedProfile?.sauceName);
  }

  if (classifyRecipe(recipe) === "mix") {
    return [1, 2, 3, 4].some((slot) => {
      const type = String((after as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase();
      const name = String((after as Record<string, unknown>)[`app${slot}CheeseRecipeName`] ?? "");
      return type === "mix" && (!name || sameName(recipe.name, name));
    }) || sameSheetProfile && [1, 2, 3, 4].some((slot) =>
      String((after as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase() === "mix",
    );
  }
  return [1, 2, 3, 4].some((slot) => {
    const type = String((after as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase();
    const name = String((after as Record<string, unknown>)[`app${slot}CheeseRecipeName`] ?? "");
    return type === "cheese" && (!name || sameName(recipe.name, name));
  }) || sameSheetProfile && [1, 2, 3, 4].some((slot) =>
    String((after as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase() === "cheese",
  );
}

function applyRecipeRows(
  values: FormValues,
  recipe: ParsedRecipe,
  classifyRecipe: RecipeClassifier,
): void {
  const rows = recipe.rows.map((row) => ({ ingredient: row.ingredient, lbs: row.lbs }));
  if (recipe.kind === "dough") {
    values.doughRecipeName = recipe.name;
    values.doughRecipe = rows;
    if (recipe.doughballOz != null && recipe.doughballOz > 0) {
      values.targetDoughballWeight = recipe.doughballOz;
    }
    if (recipe.doughBatchYield != null && recipe.doughBatchYield > 0) {
      values.doughBatchYield = recipe.doughBatchYield;
    }
    return;
  }
  if (recipe.kind === "sauce") {
    values.frontlineRecipeName = recipe.name;
    values.frontlineRecipe = rows;
    return;
  }

  const kind = classifyRecipe(recipe);
  const genericType = kind === "mix" ? "mix" : "cheese";
  const matchingSlots = [1, 2, 3, 4].filter((slot) => {
    const type = String((values as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase();
    const name = String((values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] ?? "");
    return type === genericType && (!name || sameName(recipe.name, name));
  });
  const targetSlots = matchingSlots.length
    ? matchingSlots
    : recipe.app != null && recipe.app >= 1 && recipe.app <= 4
      ? [recipe.app]
      : [];
  for (const slot of targetSlots) {
    (values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = recipe.name;
    (values as Record<string, unknown>)[`app${slot}CheeseRecipe`] = rows;
  }
}
