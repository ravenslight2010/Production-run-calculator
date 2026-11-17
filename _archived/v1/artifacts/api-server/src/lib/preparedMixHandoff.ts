/**
 * Immutable bridge between a day's prep run and canonical run-finalization.
 *
 * The v1 contract lives in existing inventory ledger notes, avoiding a second
 * database or client-side authority. It is deliberately versioned and parsed
 * fail-closed because it changes which physical stock item a canonical source
 * line represents.
 */
export const PREP_HANDOFF_NOTE_PREFIX = "prepared-mix-handoff:v1:";
export const PREP_HANDOFF_CLAIM_PREFIX = "prepared-mix-handoff:";
export const PREPARED_MIX_ITEM_PREFIX = "ingredient:Prepared mix [";
export const PREPARED_MIX_ITEM_SUFFIX = "]:lbs";

export class PreparedMixHandoffConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreparedMixHandoffConfigurationError";
  }
}

export type PreparedMixHandoff = {
  version: 1;
  eventDate: string;
  mixId: string;
  mixName: string;
  preparedItemKey: string;
  sourceFactors: Array<{ itemKey: string; factor: number }>;
};

export type PrepMixComponentPlan = {
  ingredient: string;
  lbs: number;
  fallbackOzPerPizza?: number;
};
export type PrepRunSource = {
  runId: string;
  date: string;
  brand: string;
  flavor: string;
  cases: number;
  pizzas: number;
  productionScale?: number;
  ingredients: string[];
  ingredientOzPerPizza: Record<string, number>;
  /** Canonical raw run lines, already using the released actual-case policy. */
  sourceLines: ReadonlyMap<string, number>;
  /** Production units in one source line converted to pounds. */
  sourceUnitPounds: ReadonlyMap<string, number>;
};

export function matchesPrepIngredient(a: string, b: string): boolean {
  const ak = a.trim().toLowerCase();
  const bk = b.trim().toLowerCase();
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  const [longer, shorter] = ak.length >= bk.length ? [ak, bk] : [bk, ak];
  if (!longer.startsWith(shorter)) return false;
  const next = longer[shorter.length];
  return next === " " || next === "-" || next === "," || next === "(" || next === "/";
}

function runComponentPounds(
  component: PrepMixComponentPlan,
  run: PrepRunSource,
): number {
  if (!run.ingredients.some((name) => matchesPrepIngredient(name, component.ingredient))) {
    return 0;
  }
  const exact = run.ingredientOzPerPizza[component.ingredient];
  const matching = exact === undefined
    ? Object.entries(run.ingredientOzPerPizza).find(([name]) =>
      matchesPrepIngredient(name, component.ingredient))
    : undefined;
  const ozPerPizza = exact ?? matching?.[1] ?? component.fallbackOzPerPizza ?? 0;
  if (!Number.isFinite(ozPerPizza) || ozPerPizza <= 0) return 0;
  return (ozPerPizza / 16) * run.pizzas;
}

/**
 * Split the existing planned prep output across its contributing runs without
 * changing the mix formula. The released waste/startup amounts are distributed
 * in proportion to each run's ingredient contribution. The source-key factors
 * then bind those existing run lines to prepared pounds for completion/revisions.
 */
export function buildPreparedMixRunHandoffs(input: {
  eventDate: string;
  mixId: string;
  mixName: string;
  preparedItemKey: string;
  totalLbs: number;
  startupLbs: number;
  components: readonly PrepMixComponentPlan[];
  runs: readonly PrepRunSource[];
}): Array<{ runId: string; preparedLbs: number; contract: PreparedMixHandoff }> {
  const runNeeds = input.runs.map((run) => {
    const sourceNames = new Set<string>();
    let componentPounds = 0;
    for (const component of input.components) {
      componentPounds += runComponentPounds(component, run);
      sourceNames.add(component.ingredient);
    }
    const sourcePoundsByKey = new Map<string, number>();
    for (const [itemKey, qty] of run.sourceLines) {
      const match = itemKey.match(/^ingredient:(.*):(lbs|batches)$/);
      if (!match) continue;
      const sourceName = match[1].trim();
      if (
        !matchesPrepIngredient(sourceName, input.mixName) &&
        ![...sourceNames].some((name) => matchesPrepIngredient(sourceName, name))
      ) continue;
      const poundsPerUnit = run.sourceUnitPounds.get(itemKey);
      if (!poundsPerUnit || !Number.isFinite(poundsPerUnit) || poundsPerUnit <= 0) {
        throw new PreparedMixHandoffConfigurationError(
          `Prepared mix "${input.mixName}" has an unmapped production unit for "${sourceName}"`,
        );
      }
      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error(`Prepared mix "${input.mixName}" has an invalid run quantity`);
      }
      sourcePoundsByKey.set(itemKey, qty * poundsPerUnit);
    }
    const sourcePounds = [...sourcePoundsByKey.values()].reduce((sum, qty) => sum + qty, 0);
    return { run, componentPounds, sourcePoundsByKey, sourcePounds };
  });

  const totalComponentPounds = runNeeds.reduce((sum, run) => sum + run.componentPounds, 0);
  if (totalComponentPounds <= 0) return [];
  const wastePounds = Math.max(
    0,
    input.totalLbs - totalComponentPounds - input.startupLbs,
  );
  return runNeeds.flatMap((need) => {
    if (need.componentPounds <= 0 || need.sourcePounds <= 0) return [];
    const plannedRunNeed =
      need.componentPounds +
      (wastePounds * need.componentPounds) / totalComponentPounds +
      (input.startupLbs * need.componentPounds) / totalComponentPounds;
    const preparedLbs = plannedRunNeed * (need.run.productionScale ?? 1);
    const factor = preparedLbs / need.sourcePounds;
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`Prepared mix "${input.mixName}" has an invalid run handoff`);
    }
    return [{
      runId: need.run.runId,
      preparedLbs,
      contract: {
        version: 1 as const,
        eventDate: input.eventDate,
        mixId: input.mixId,
        mixName: input.mixName,
        preparedItemKey: input.preparedItemKey,
        sourceFactors: [...need.sourcePoundsByKey.keys()].map((itemKey) => ({
          itemKey,
          factor,
        })),
      },
    }];
  });
}

export function preparedMixItemKey(mixId: string): string {
  return `${PREPARED_MIX_ITEM_PREFIX}${encodeURIComponent(mixId)}${PREPARED_MIX_ITEM_SUFFIX}`;
}

export function preparedMixHandoffClaimId(runId: string): string {
  return `${PREP_HANDOFF_CLAIM_PREFIX}${runId}`;
}

export function serializePreparedMixHandoff(contract: PreparedMixHandoff): string {
  return `${PREP_HANDOFF_NOTE_PREFIX}${JSON.stringify(contract)}`;
}

export function parsePreparedMixHandoff(note: string): PreparedMixHandoff | null {
  if (!note.startsWith(PREP_HANDOFF_NOTE_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(note.slice(PREP_HANDOFF_NOTE_PREFIX.length));
  } catch {
    throw new Error("Prepared-stock handoff audit record is invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prepared-stock handoff audit record is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.eventDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.eventDate) ||
    typeof record.mixId !== "string" ||
    typeof record.mixName !== "string" ||
    typeof record.preparedItemKey !== "string" ||
    !record.preparedItemKey.startsWith(PREPARED_MIX_ITEM_PREFIX) ||
    !record.preparedItemKey.endsWith(PREPARED_MIX_ITEM_SUFFIX) ||
    !Array.isArray(record.sourceFactors) ||
    record.sourceFactors.length === 0
  ) {
    throw new Error("Prepared-stock handoff audit record is invalid");
  }
  const sourceFactors: PreparedMixHandoff["sourceFactors"] = [];
  const seen = new Set<string>();
  for (const item of record.sourceFactors) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Prepared-stock handoff audit record is invalid");
    }
    const mapping = item as Record<string, unknown>;
    if (
      typeof mapping.itemKey !== "string" ||
      !/^ingredient:.+:(lbs|batches)$/.test(mapping.itemKey) ||
      typeof mapping.factor !== "number" ||
      !Number.isFinite(mapping.factor) ||
      mapping.factor <= 0 ||
      seen.has(mapping.itemKey)
    ) {
      throw new Error("Prepared-stock handoff audit record is invalid");
    }
    seen.add(mapping.itemKey);
    sourceFactors.push({ itemKey: mapping.itemKey, factor: mapping.factor });
  }
  return {
    version: 1,
    eventDate: record.eventDate,
    mixId: record.mixId,
    mixName: record.mixName,
    preparedItemKey: record.preparedItemKey,
    sourceFactors,
  };
}

/** Replace only the raw ingredient lines frozen by a valid prep event. */
export function applyPreparedMixHandoffs(
  sourceLines: ReadonlyMap<string, number>,
  contracts: readonly PreparedMixHandoff[],
): Map<string, number> {
  if (contracts.length === 0) return new Map(sourceLines);
  const sourceToTarget = new Map<string, { preparedKey: string; factor: number }>();
  for (const contract of contracts) {
    for (const mapping of contract.sourceFactors) {
      const existing = sourceToTarget.get(mapping.itemKey);
      if (
        existing &&
        (existing.preparedKey !== contract.preparedItemKey ||
          existing.factor !== mapping.factor)
      ) {
        throw new Error("Prepared-stock handoff has conflicting source mappings");
      }
      sourceToTarget.set(mapping.itemKey, {
        preparedKey: contract.preparedItemKey,
        factor: mapping.factor,
      });
    }
  }

  const result = new Map(sourceLines);
  const preparedTotals = new Map<string, number>();
  for (const [sourceKey, mapping] of sourceToTarget) {
    const qty = sourceLines.get(sourceKey);
    if (qty == null) continue;
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error("Prepared-stock handoff source quantity is invalid");
    }
    result.delete(sourceKey);
    preparedTotals.set(
      mapping.preparedKey,
      (preparedTotals.get(mapping.preparedKey) ?? 0) + qty * mapping.factor,
    );
  }
  for (const [preparedKey, qty] of preparedTotals) {
    if (sourceLines.has(preparedKey) && !sourceToTarget.has(preparedKey)) {
      throw new Error("Prepared-stock handoff overlaps a source stock key");
    }
    const rounded = Math.round(qty * 1000) / 1000;
    if (rounded > 0) result.set(preparedKey, (result.get(preparedKey) ?? 0) + rounded);
  }
  return result;
}
