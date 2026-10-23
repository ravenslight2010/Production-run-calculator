import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";

export type RecipeQcFamily = "dough" | "sauce" | "cheese" | "mix";

export const RECIPE_QC_FAMILIES: readonly RecipeQcFamily[] = [
  "dough",
  "sauce",
  "cheese",
  "mix",
];

const RECIPE_QC_FIELDS: Record<RecipeQcFamily, readonly string[]> = {
  dough: [
    "name", "notes", "components", "enabled", "brand", "flavors",
    "doughballWeightOz", "doughballsPerTray", "doughballVariants",
  ],
  sauce: ["name", "notes", "components", "enabled", "brand", "flavors"],
  cheese: [
    "name", "brand", "flavors", "shredderSetting", "cellulose", "notes",
    "components", "enabled",
  ],
  // Inventory amounts are operational stock values, not recipe revisions.
  mix: [
    "name", "brand", "flavor", "batchSize", "daysEarly", "notes",
    "components", "isPrep", "enabled",
  ],
};

const RECIPE_QC_DEFAULTS: Record<RecipeQcFamily, Record<string, unknown>> = {
  dough: {
    notes: "", components: [], enabled: false, brand: "", flavors: [],
    doughballWeightOz: 0, doughballsPerTray: 0, doughballVariants: [],
  },
  sauce: {
    notes: "", components: [], enabled: false, brand: "", flavors: [],
  },
  cheese: {
    brand: "", flavors: [], shredderSetting: "", cellulose: "", notes: "",
    components: [], enabled: false,
  },
  mix: {
    brand: "", flavor: "", batchSize: 0, daysEarly: 0, notes: "",
    components: [], isPrep: false, enabled: false,
  },
};

const RECIPE_QC_LOCK_PREFIX: Record<RecipeQcFamily, string> = {
  dough: "dough-recipes",
  sauce: "sauce-recipes",
  cheese: "cheese-recipes",
  mix: "mixes",
};

export function recipeQcFamilyLockName(family: RecipeQcFamily): string {
  return RECIPE_QC_LOCK_PREFIX[family];
}

export async function lockRecipeQcFamily(
  executor: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  scope: string,
  family: RecipeQcFamily,
): Promise<void> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${recipeQcFamilyLockName(family) + ":" + scope}))`,
  );
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function boundedValue(value: unknown, depth = 0): { value: unknown; truncated: boolean } {
  if (typeof value === "string") {
    return value.length > 120
      ? { value: `${value.slice(0, 120)}…`, truncated: true }
      : { value, truncated: false };
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return { value, truncated: false };
  }
  if (depth >= 3) return { value: "[nested value omitted]", truncated: true };
  if (Array.isArray(value)) {
    const sample = value.slice(0, 8).map((child) => boundedValue(child, depth + 1));
    return {
      value: { count: value.length, sample: sample.map((child) => child.value) },
      truncated: value.length > 8 || sample.some((child) => child.truncated),
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 10);
    const summarized = entries.map(([key, child]) => [key, boundedValue(child, depth + 1)] as const);
    return {
      value: Object.fromEntries(summarized.map(([key, child]) => [key, child.value])),
      truncated: Object.keys(value as Record<string, unknown>).length > 10 ||
        summarized.some(([, child]) => child.truncated),
    };
  }
  return { value: null, truncated: false };
}

function recipeFields(family: RecipeQcFamily, recipe: Record<string, unknown>) {
  return Object.fromEntries(
    RECIPE_QC_FIELDS[family]
      .map((field) => {
        const value = recipe[field];
        return [
          field,
          value === undefined || value === null
            ? RECIPE_QC_DEFAULTS[family][field] ?? null
            : value,
        ];
      }),
  );
}

export function recipeQcResultHash(
  family: RecipeQcFamily,
  recipeId: string,
  recipeValue: object,
): string {
  const recipe = recipeValue as Record<string, unknown>;
  return createHash("sha256")
    .update(stable({ version: 1, family, recipeId, fields: recipeFields(family, recipe) }))
    .digest("hex");
}

export type RecipeQcCapture = {
  operationId: string;
  recordId: string;
  payload: Record<string, unknown>;
};

/** Build durable, bounded evidence for a committed recipe-content revision. */
export function buildRecipeQcCapture(
  family: RecipeQcFamily,
  recipeId: string,
  beforeValue: object | undefined,
  afterValue: object,
): RecipeQcCapture | null {
  const before = beforeValue as Record<string, unknown> | undefined;
  const after = afterValue as Record<string, unknown>;
  const normalizedBefore = before ? recipeFields(family, before) : undefined;
  const normalizedAfter = recipeFields(family, after);
  const changedFields = before
    ? RECIPE_QC_FIELDS[family].filter((field) =>
        !isDeepStrictEqual(normalizedBefore?.[field], normalizedAfter[field]),
      )
    : [...RECIPE_QC_FIELDS[family]];
  if (changedFields.length === 0) return null;

  const bounded = (recipe: Record<string, unknown> | undefined) => {
    if (!recipe) return null;
    const normalized = recipeFields(family, recipe);
    const fields = Object.fromEntries(changedFields.map((field) => {
      const result = boundedValue(normalized[field]);
      return [field, { value: result.value, truncated: result.truncated }];
    }));
    return fields;
  };
  const resultHash = recipeQcResultHash(family, recipeId, after);
  const recordId = `${family}:${recipeId}`;
  return {
    operationId: `recipe-capture:${randomUUID()}`,
    recordId,
    payload: {
      summaryVersion: 1,
      recipeType: family,
      recipeId,
      displayName: String(after.name ?? before?.name ?? "Unnamed recipe").slice(0, 120),
      resultHash,
      changedFields,
      before: bounded(before),
      after: bounded(after),
      summaryLimitations:
        "Values are bounded previews. Long text and large collections are truncated; omitted details are unknown, not confirmed unchanged.",
    },
  };
}
