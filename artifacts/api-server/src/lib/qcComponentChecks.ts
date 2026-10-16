import * as z from "zod";
import {
  applySubstitutions,
  type IngredientSubstitution,
} from "@workspace/inventory-math";

export const QC_COMPONENT_OBSERVATIONS = [
  "present-correct",
  "present-mismatch",
  "missing",
  "not-checked",
] as const;

export type QcComponentObservation = (typeof QC_COMPONENT_OBSERVATIONS)[number];
export type QcComponentOutcome = "pass" | "fail" | "not-evaluated";
export type QcOverallComponentOutcome = QcComponentOutcome;

export type ExpectedQcComponent = {
  componentId: string;
  group: string;
  name: string;
  ingredientId?: string;
};

export type QcComponentResolution = {
  status: "complete" | "incomplete";
  reason?: string;
  components: ExpectedQcComponent[];
};

const MAX_EXPECTED_COMPONENTS = 200;
const MAX_COMPONENT_NAME = 200;

const recipeRowSchema = z.object({
  ingredient: z.string().max(MAX_COMPONENT_NAME),
  ingredientId: z.string().trim().min(1).max(200).optional(),
  lbs: z.number().finite().min(0).max(1_000_000),
});

const substitutionsSchema = z.array(z.object({
  id: z.string().trim().min(1).max(200),
  ingredient: z.string().trim().min(1).max(MAX_COMPONENT_NAME),
  action: z.enum(["swap", "add", "remove"]),
  substitute: z.string().trim().max(MAX_COMPONENT_NAME).optional(),
  amount: z.number().finite().min(0).max(1_000_000).optional(),
}).strict().superRefine((substitution, ctx) => {
  if (
    substitution.action !== "remove"
    && (!substitution.substitute || !substitution.substitute.trim())
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["substitute"],
      message: "A swap or add substitution needs a name",
    });
  }
}));

const runComponentSettingsSchema = z.object({
  doughRecipeName: z.string().max(MAX_COMPONENT_NAME),
  doughRecipe: z.array(recipeRowSchema).max(MAX_EXPECTED_COMPONENTS),
  frontlineRecipeName: z.string().max(MAX_COMPONENT_NAME),
  frontlineRecipe: z.array(recipeRowSchema).max(MAX_EXPECTED_COMPONENTS),
  app1Type: z.string().max(MAX_COMPONENT_NAME),
  app1CheeseRecipeName: z.string().max(MAX_COMPONENT_NAME),
  app1CheeseRecipe: z.array(recipeRowSchema).max(MAX_EXPECTED_COMPONENTS),
  app2Type: z.string().max(MAX_COMPONENT_NAME),
  app2CheeseRecipeName: z.string().max(MAX_COMPONENT_NAME),
  app2CheeseRecipe: z.array(recipeRowSchema).max(MAX_EXPECTED_COMPONENTS),
  app3Type: z.string().max(MAX_COMPONENT_NAME),
  app3CheeseRecipeName: z.string().max(MAX_COMPONENT_NAME),
  app3CheeseRecipe: z.array(recipeRowSchema).max(MAX_EXPECTED_COMPONENTS),
  app4Type: z.string().max(MAX_COMPONENT_NAME),
  app4CheeseRecipeName: z.string().max(MAX_COMPONENT_NAME),
  app4CheeseRecipe: z.array(recipeRowSchema).max(MAX_EXPECTED_COMPONENTS),
  pep1Type: z.string().max(MAX_COMPONENT_NAME),
  pep1TypeB: z.string().max(MAX_COMPONENT_NAME),
  pep2Type: z.string().max(MAX_COMPONENT_NAME),
  pep2TypeB: z.string().max(MAX_COMPONENT_NAME),
}).passthrough();

function cleanedName(value: string): string {
  return value.trim();
}

function isConfiguredType(value: string): boolean {
  const name = cleanedName(value);
  return name !== "" && name.toLocaleLowerCase("en-US") !== "none";
}

function outcomeForObservation(
  observation: QcComponentObservation | undefined,
): QcComponentOutcome {
  if (observation === "present-correct") return "pass";
  if (observation === "present-mismatch" || observation === "missing") return "fail";
  return "not-evaluated";
}

/**
 * Resolve expected component identities exclusively from the canonical run
 * settings and the day-level substitution overlay. The caller supplies data
 * read from the server's canonical snapshot, never expected values from a QC
 * request. Missing component fields are not treated as empty defaults.
 */
export function resolveQcExpectedComponents(
  rawValues: unknown,
  rawSubstitutions: unknown,
  runSubTab?: unknown,
): QcComponentResolution {
  const valuesResult = runComponentSettingsSchema.safeParse(rawValues);
  if (!valuesResult.success) {
    return {
      status: "incomplete",
      reason: "Canonical run component settings are missing or invalid.",
      components: [],
    };
  }

  const substitutionsResult = rawSubstitutions === undefined
    ? { success: true as const, data: [] as IngredientSubstitution[] }
    : substitutionsSchema.safeParse(rawSubstitutions);
  if (!substitutionsResult.success) {
    return {
      status: "incomplete",
      reason: "The production-day substitution list is invalid.",
      components: [],
    };
  }

  const values = applySubstitutions(
    valuesResult.data,
    substitutionsResult.data,
  );
  const components: ExpectedQcComponent[] = [];
  let incompleteReason: string | undefined;

  const add = (
    componentId: string,
    group: string,
    rawName: string,
    ingredientId?: string,
  ) => {
    const name = cleanedName(rawName);
    if (!name) {
      incompleteReason ??= "A configured component has no identifiable name.";
      return;
    }
    if (components.length >= MAX_EXPECTED_COMPONENTS) {
      incompleteReason ??= "The expected component set exceeds the supported limit.";
      return;
    }
    components.push({
      componentId,
      group,
      name,
      ...(ingredientId ? { ingredientId } : {}),
    });
  };

  const addRecipeRows = (
    group: string,
    field: string,
    rows: readonly z.infer<typeof recipeRowSchema>[],
  ) => {
    rows.forEach((row, index) => {
      add(`${field}:${index}`, group, row.ingredient, row.ingredientId);
    });
  };

  const doughName = cleanedName(values.doughRecipeName);
  if (runSubTab !== "crusts" && (doughName || values.doughRecipe.length > 0)) {
    if (values.doughRecipe.length > 0) {
      addRecipeRows("Dough", "dough", values.doughRecipe);
    } else {
      incompleteReason ??= "The configured dough recipe has no component rows.";
    }
  }

  const sauceName = cleanedName(values.frontlineRecipeName);
  if (sauceName || values.frontlineRecipe.length > 0) {
    if (values.frontlineRecipe.length > 0) {
      addRecipeRows("Frontline (Sauce)", "sauce", values.frontlineRecipe);
    } else if (sauceName) {
      // Ready-made sauces are intentionally configured by product name alone.
      add("sauce:product", "Frontline (Sauce)", sauceName);
    }
  }

  const applicators = [
    ["app1", "Applicator 1", values.app1Type, values.app1CheeseRecipeName, values.app1CheeseRecipe],
    ["app2", "Applicator 2", values.app2Type, values.app2CheeseRecipeName, values.app2CheeseRecipe],
    ["app3", "Applicator 3", values.app3Type, values.app3CheeseRecipeName, values.app3CheeseRecipe],
    ["app4", "Applicator 4", values.app4Type, values.app4CheeseRecipeName, values.app4CheeseRecipe],
  ] as const;
  for (const [slot, group, rawType, rawRecipeName, rows] of applicators) {
    const type = cleanedName(rawType);
    const recipeName = cleanedName(rawRecipeName);
    const typeIsRecipe = /^(cheese|mix)$/i.test(type);
    const configured = Boolean(type || recipeName || rows.length);
    if (!configured) continue;
    if (rows.length > 0) {
      addRecipeRows(group, slot, rows);
    } else if (typeIsRecipe) {
      if (recipeName) add(`${slot}:product`, group, recipeName);
      else incompleteReason ??= `${group} is configured without an identifiable recipe.`;
    } else if (isConfiguredType(type)) {
      add(`${slot}:type`, group, type);
    } else if (recipeName) {
      add(`${slot}:product`, group, recipeName);
    }
  }

  const pepperoniTypes = [
    ["pep1", "Pepperoni 1", values.pep1Type],
    ["pep1b", "Pepperoni 1 additional type", values.pep1TypeB],
    ["pep2", "Pepperoni 2", values.pep2Type],
    ["pep2b", "Pepperoni 2 additional type", values.pep2TypeB],
  ] as const;
  for (const [slot, group, name] of pepperoniTypes) {
    if (isConfiguredType(name)) add(`${slot}:type`, group, name);
  }

  if (components.length === 0) {
    incompleteReason ??= "No configured components were found for this run.";
  }

  return {
    status: incompleteReason ? "incomplete" : "complete",
    ...(incompleteReason ? { reason: incompleteReason } : {}),
    components,
  };
}

export type EvaluatedQcComponent = ExpectedQcComponent & {
  observation: QcComponentObservation;
  outcome: QcComponentOutcome;
};

/**
 * Re-evaluate observations against the server-resolved expected snapshot.
 * Overall failure takes precedence over incompleteness; otherwise an
 * incomplete expected list or any unchecked item prevents a pass.
 */
export function evaluateQcComponents(
  resolution: QcComponentResolution,
  observations: ReadonlyMap<string, QcComponentObservation>,
): { items: EvaluatedQcComponent[]; outcome: QcOverallComponentOutcome } {
  const items = resolution.components.map((component) => {
    const observation = observations.get(component.componentId) ?? "not-checked";
    return {
      ...component,
      observation,
      outcome: outcomeForObservation(observation),
    };
  });
  const outcome = items.some((item) => item.outcome === "fail")
    ? "fail"
    : resolution.status !== "complete"
      || items.some((item) => item.outcome !== "pass")
      ? "not-evaluated"
      : "pass";
  return { items, outcome };
}
