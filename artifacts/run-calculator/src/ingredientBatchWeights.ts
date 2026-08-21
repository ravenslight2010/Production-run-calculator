// Learned per-ingredient batch weights — web platform glue + pure helpers.
//
// Mixes and cheese recipes carry their own batch weight (the sum of their
// recipe rows), but plain ingredients (applicator toppings, non-default pep
// types, ready-made sauce barrels) only have a manually typed "Batch Weight
// (lbs)" field. Once a user enters one, it is remembered server-side (factory
// wide, keyed case-insensitively by ingredient name) and auto-filled the next
// time that ingredient is picked — "the weight follows the ingredient".
//
// Same shape as the other learned-memory stores (fill-missing values, photo
// aliases): requireAuth-only endpoints, app-level ci-upsert, best-effort glue
// (a network failure never blocks the user's entry).

import { inventoryClientId } from "./inventoryShared";

export type IngredientBatchWeightRow = { name: string; lbs: number };

export async function fetchIngredientBatchWeights(): Promise<IngredientBatchWeightRow[]> {
  const res = await fetch("/api/ingredient-batch-weights", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List ingredient batch weights failed (${res.status})`);
  const data = (await res.json()) as { weights: IngredientBatchWeightRow[] };
  return data.weights ?? [];
}

export async function saveIngredientBatchWeights(
  weights: IngredientBatchWeightRow[],
): Promise<void> {
  if (weights.length === 0) return;
  const res = await fetch("/api/ingredient-batch-weights", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ weights }),
  });
  if (!res.ok) throw new Error(`Save ingredient batch weights failed (${res.status})`);
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function buildBatchWeightMap(
  rows: IngredientBatchWeightRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = (r.name ?? "").trim().toLowerCase();
    const lbs = Number(r.lbs);
    if (!key || !Number.isFinite(lbs) || lbs <= 0) continue;
    map.set(key, lbs);
  }
  return map;
}

export function lookupBatchWeight(
  map: Map<string, number>,
  name: string,
): number | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  return map.get(key) ?? null;
}

// One (ingredient name, entered lbs) pair as currently visible on the run form.
// Only pairs whose Batch Weight field is actually shown in the UI are eligible:
// a mix / recipe-backed slot hides the manual field, so its stale form value
// must never be learned.
export type BatchWeightCandidate = { name: string; lbs: number };

type RecipeRowLike = { lbs?: number | string | null };

function hasRecipeRows(rows: unknown): boolean {
  return Array.isArray(rows) &&
    rows.some((row) => Number((row as RecipeRowLike | null)?.lbs) > 0);
}

export type BatchWeightFormSlice = {
  // Applicators 1-4 (ingredientTypes pickers)
  apps: Array<{
    type: string | null | undefined;
    batchLbs: number | null | undefined;
    cheeseRecipe: RecipeRowLike[] | null | undefined;
  }>;
  // Pep applicator slots (A + B), already filtered to the slots the UI shows
  peps: Array<{
    type: string | null | undefined;
    batchLbs: number | null | undefined;
  }>;
  defaultPepTypes: string[];
  sauce: {
    recipeName: string | null | undefined;
    barrelLbs: number | null | undefined;
    recipe: RecipeRowLike[] | null | undefined;
  };
};

export type BatchWeightProfileLike = Record<string, unknown>;

export type BatchWeightPropagationProfile = {
  brand: string;
  flavor: string;
  profile: BatchWeightProfileLike;
};

export type BatchWeightProfileUpdate = {
  brand: string;
  flavor: string;
  updates: Partial<Record<string, number>>;
};

export type BatchWeightPropagationPlan = {
  profileUpdates: BatchWeightProfileUpdate[];
  openFormUpdates: Partial<Record<string, number>>;
};

export type BatchWeightPropagationToast = {
  title: string;
  description: string;
};

export function batchWeightPropagationToast(
  savedProfileCount: number,
): BatchWeightPropagationToast | null {
  if (savedProfileCount <= 0) return null;
  return {
    title: "Batch weight saved",
    description: `${savedProfileCount} profile${savedProfileCount === 1 ? "" : "s"} updated`,
  };
}

export type BatchWeightPropagationExecution = {
  profiles: BatchWeightPropagationProfile[];
  openForm: BatchWeightProfileLike;
  entries: BatchWeightCandidate[];
  defaultPepTypes: string[];
  saveProfile: (
    brand: string,
    flavor: string,
    updates: Partial<Record<string, number>>,
  ) => boolean | Promise<boolean>;
  propagateToPendingRuns: (brand: string, flavor: string) => Promise<void> | void;
  setOpenFormValue: (field: string, lbs: number) => void;
  notify: (toast: BatchWeightPropagationToast) => void;
};

export type BatchWeightPropagationExecutionResult = {
  plan: BatchWeightPropagationPlan;
  savedProfileCount: number;
};

type BatchWeightProfileSlot = {
  typeField: string;
  lbsField: string;
  hidden: (profile: BatchWeightProfileLike, defaultPepTypes: string[]) => boolean;
};

const BATCH_WEIGHT_PROFILE_SLOTS: BatchWeightProfileSlot[] = [
  {
    typeField: "app1Type",
    lbsField: "app1BatchLbs",
    hidden: (profile) =>
      hasRecipeRows(profile.app1CheeseRecipe) ||
      isMixType(profile.app1Type),
  },
  {
    typeField: "app2Type",
    lbsField: "app2BatchLbs",
    hidden: (profile) =>
      hasRecipeRows(profile.app2CheeseRecipe) ||
      isMixType(profile.app2Type),
  },
  {
    typeField: "app3Type",
    lbsField: "app3BatchLbs",
    hidden: (profile) =>
      hasRecipeRows(profile.app3CheeseRecipe) ||
      isMixType(profile.app3Type),
  },
  {
    typeField: "app4Type",
    lbsField: "app4BatchLbs",
    hidden: (profile) =>
      hasRecipeRows(profile.app4CheeseRecipe) ||
      isMixType(profile.app4Type),
  },
  {
    typeField: "pep1Type",
    lbsField: "pep1BatchLbs",
    hidden: (profile, defaultPepTypes) =>
      isDefaultPepType(profile.pep1Type, defaultPepTypes),
  },
  {
    typeField: "pep1TypeB",
    lbsField: "pep1BatchLbsB",
    hidden: (profile, defaultPepTypes) =>
      isDefaultPepType(profile.pep1TypeB, defaultPepTypes),
  },
  {
    typeField: "pep2Type",
    lbsField: "pep2BatchLbs",
    hidden: (profile, defaultPepTypes) =>
      profile.pep1Combined === true ||
      isDefaultPepType(profile.pep2Type, defaultPepTypes),
  },
  {
    typeField: "pep2TypeB",
    lbsField: "pep2BatchLbsB",
    hidden: (profile, defaultPepTypes) =>
      profile.pep1Combined === true ||
      isDefaultPepType(profile.pep2TypeB, defaultPepTypes),
  },
  {
    typeField: "frontlineRecipeName",
    lbsField: "sauceBarrelLbs",
    hidden: (profile) =>
      hasRecipeRows(profile.frontlineRecipe),
  },
];

function isMixType(type: unknown): boolean {
  return typeof type === "string" && type.trim().toLowerCase().includes("mix");
}

function isDefaultPepType(type: unknown, defaultPepTypes: unknown): boolean {
  const trimmed = typeof type === "string" ? type.trim() : "";
  return Array.isArray(defaultPepTypes) && defaultPepTypes.includes(trimmed);
}

function buildNewBatchWeightMap(
  entries: BatchWeightCandidate[],
): Map<string, number> {
  const newWeights = new Map<string, number>();
  for (const { name, lbs } of entries) {
    const key = (name ?? "").trim().toLowerCase();
    if (key && Number.isFinite(lbs) && lbs > 0) newWeights.set(key, lbs);
  }
  return newWeights;
}

export function collectBatchWeightProfileUpdates(
  profile: BatchWeightProfileLike,
  entries: BatchWeightCandidate[],
  defaultPepTypes: string[],
): Partial<Record<string, number>> {
  const newWeights = buildNewBatchWeightMap(entries);
  const updates: Partial<Record<string, number>> = {};

  for (const { typeField, lbsField, hidden } of BATCH_WEIGHT_PROFILE_SLOTS) {
    if (hidden(profile, defaultPepTypes)) continue;
    const typeName = typeof profile[typeField] === "string"
      ? profile[typeField].trim()
      : "";
    if (!typeName) continue;
    const newLbs = newWeights.get(typeName.toLowerCase());
    if (newLbs == null || Number(profile[lbsField]) === newLbs) continue;
    updates[lbsField] = newLbs;
  }

  return updates;
}

export function buildBatchWeightPropagationPlan(
  profiles: BatchWeightPropagationProfile[],
  openForm: BatchWeightProfileLike,
  entries: BatchWeightCandidate[],
  defaultPepTypes: string[],
): BatchWeightPropagationPlan {
  const profileUpdates: BatchWeightProfileUpdate[] = [];
  for (const { brand, flavor, profile } of profiles) {
    const updates = collectBatchWeightProfileUpdates(profile, entries, defaultPepTypes);
    if (Object.keys(updates).length > 0) {
      profileUpdates.push({ brand, flavor, updates });
    }
  }

  return {
    profileUpdates,
    openFormUpdates: collectBatchWeightProfileUpdates(openForm, entries, defaultPepTypes),
  };
}

export async function executeBatchWeightPropagation(
  input: BatchWeightPropagationExecution,
): Promise<BatchWeightPropagationExecutionResult> {
  const plan = buildBatchWeightPropagationPlan(
    input.profiles,
    input.openForm,
    input.entries,
    input.defaultPepTypes,
  );
  let savedProfileCount = 0;
  const propagations: Promise<void>[] = [];

  for (const { brand, flavor, updates } of plan.profileUpdates) {
    if (!await input.saveProfile(brand, flavor, updates)) continue;
    savedProfileCount++;
    propagations.push(Promise.resolve(input.propagateToPendingRuns(brand, flavor)));
  }
  await Promise.allSettled(propagations);

  for (const [field, lbs] of Object.entries(plan.openFormUpdates)) {
    if (lbs !== undefined) input.setOpenFormValue(field, lbs);
  }

  const toast = batchWeightPropagationToast(savedProfileCount);
  if (toast) input.notify(toast);

  return { plan, savedProfileCount };
}

// Collect the pairs worth remembering right now: named ingredient + a positive
// manually-visible batch weight that differs from what's already learned.
export function collectBatchWeightCandidates(
  slice: BatchWeightFormSlice,
  learned: Map<string, number>,
): BatchWeightCandidate[] {
  const out = new Map<string, BatchWeightCandidate>();

  const consider = (name: string | null | undefined, lbs: number | null | undefined) => {
    const trimmed = (name ?? "").trim();
    const weight = Number(lbs);
    if (!trimmed || !Number.isFinite(weight) || weight <= 0) return;
    const key = trimmed.toLowerCase();
    if (learned.get(key) === weight) return; // already remembered as-is
    out.set(key, { name: trimmed, lbs: weight });
  };

  for (const app of slice.apps) {
    const type = (app.type ?? "").trim();
    if (!type) continue;
    // Mix slots and recipe-backed cheese slots hide the manual field — the sum
    // of the recipe rows IS their batch weight, so never learn the stale value.
    if (type.toLowerCase().includes("mix")) continue;
    if (hasRecipeRows(app.cheeseRecipe)) continue;
    consider(type, app.batchLbs);
  }

  for (const pep of slice.peps) {
    const type = (pep.type ?? "").trim();
    if (!type) continue;
    // Default pep types are measured in sticks; the lbs field is hidden.
    if (slice.defaultPepTypes.includes(type)) continue;
    consider(type, pep.batchLbs);
  }

  const sauceName = (slice.sauce.recipeName ?? "").trim();
  // A sauce WITH recipe rows derives its barrel weight from the rows
  // (ready-made sauces like BBQ/Ranch are the ones with a manual barrel field).
  if (sauceName && !hasRecipeRows(slice.sauce.recipe)) {
    consider(sauceName, slice.sauce.barrelLbs);
  }

  return [...out.values()];
}
