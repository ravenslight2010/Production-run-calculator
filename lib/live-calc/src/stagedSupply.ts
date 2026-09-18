/**
 * Shared staged-supply accounting for the live calculators.
 *
 * Values are deliberately allowed to be fractional.  A final Sauce barrel or
 * Frontline batch can be partial, and rounding here would make the operator's
 * "still to make" number grow or shrink as work moves between stages.
 */
export const SAUCE_STAGED_UNIT_CAP = 3;
export const FRONTLINE_STAGED_UNIT_CAP = 2;
export const FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT = 50;

export type StagedSupplyInput = {
  /** Demand in physical units (barrels for Sauce, batches for Frontline). */
  total: number;
  consumed?: number;
  onLine?: number;
  ready?: number;
  inProduction?: number;
  /** Maximum number of units allowed in the staged pipeline. */
  cap: number;
};

export type StagedSupply = {
  total: number;
  consumed: number;
  onLine: number;
  ready: number;
  inProduction: number;
  /** Demand not represented by consumed or staged units. */
  stillToMake: number;
  /** Additional units that may be staged without exceeding the cap. */
  stagingRoom: number;
  /** Demand remaining after consumed units, including currently staged units. */
  remaining: number;
};

function positive(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}

/** Compute the state of a staged supply pipeline without rounding partial units. */
export function computeStagedSupply(input: StagedSupplyInput): StagedSupply {
  const total = positive(input.total);
  const consumed = positive(input.consumed);
  const onLine = positive(input.onLine);
  const ready = positive(input.ready);
  const inProduction = positive(input.inProduction);
  const cap = positive(input.cap);
  const remaining = Math.max(0, total - consumed);
  const staged = onLine + ready + inProduction;
  return {
    total,
    consumed,
    onLine,
    ready,
    inProduction,
    remaining,
    stillToMake: Math.max(0, remaining - staged),
    stagingRoom: Math.max(0, cap - staged),
  };
}

/**
 * Fill a station pipeline from canonical lifetime consumption. This projection
 * is deliberately stateless: every device derives the same active stages after
 * reload or peer adoption, while the cumulative consumed register remains the
 * only synchronized correction/claim ledger.
 */
export function computeAutomaticStagedSupply(input: {
  total: number;
  consumed?: number;
  cap: number;
}): StagedSupply {
  const total = positive(input.total);
  const consumed = Math.min(total, positive(input.consumed));
  let open = Math.max(0, total - consumed);
  const take = () => {
    const amount = Math.min(1, open);
    open = Math.max(0, open - amount);
    return amount;
  };
  const onLine = take();
  const ready = input.cap >= 2 ? take() : 0;
  const inProduction = input.cap >= 3 ? take() : 0;
  return computeStagedSupply({
    total,
    consumed,
    onLine,
    ready,
    inProduction,
    cap: input.cap,
  });
}

export type SauceSupplyInput = Omit<StagedSupplyInput, "cap">;
export function computeSauceSupply(input: SauceSupplyInput): StagedSupply {
  return computeStagedSupply({ ...input, cap: SAUCE_STAGED_UNIT_CAP });
}

export function computeAutomaticSauceSupply(
  input: Pick<SauceSupplyInput, "total" | "consumed">,
): StagedSupply {
  return computeAutomaticStagedSupply({ ...input, cap: SAUCE_STAGED_UNIT_CAP });
}

export type FrontlineSupplyInput = Omit<StagedSupplyInput, "cap">;
export function computeFrontlineSupply(input: FrontlineSupplyInput): StagedSupply {
  return computeStagedSupply({ ...input, cap: FRONTLINE_STAGED_UNIT_CAP });
}

export function computeAutomaticFrontlineSupply(
  input: Pick<FrontlineSupplyInput, "total" | "consumed">,
): StagedSupply {
  return computeAutomaticStagedSupply({ ...input, cap: FRONTLINE_STAGED_UNIT_CAP });
}

/**
 * Frontline's operational weight is bounded even when an old or malformed
 * configuration contains zero, a negative value, or an implausibly large
 * value.  The configured effective weight is intentionally not rounded.
 */
export function computeFrontlineEffectiveBatchWeight(configuredEffectiveWeight: number | null | undefined): number {
  return Number.isFinite(configuredEffectiveWeight) &&
    Number(configuredEffectiveWeight) > 0 &&
    Number(configuredEffectiveWeight) <= FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT
    ? Number(configuredEffectiveWeight)
    : FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT;
}

/** Convert pounds of Frontline demand into (possibly partial) batch units. */
export function computeFrontlineSupplyFromLbs(input: Omit<FrontlineSupplyInput, "total"> & {
  demandLbs: number;
  configuredEffectiveWeight?: number | null;
}): StagedSupply & { effectiveBatchWeight: number } {
  const effectiveBatchWeight = computeFrontlineEffectiveBatchWeight(input.configuredEffectiveWeight);
  return {
    ...computeFrontlineSupply({
      ...input,
      total: positive(input.demandLbs) / effectiveBatchWeight,
    }),
    effectiveBatchWeight,
  };
}

export function computeSauceRunRequirement(input: {
  casesNeeded: number;
  pizzasPerCase: number;
  ozPerPizza: number;
  barrelLbs: number;
}): { totalLbs: number; totalUnits: number } {
  const pizzas = positive(input.casesNeeded) * positive(input.pizzasPerCase);
  const totalLbs = pizzas > 0 && positive(input.ozPerPizza) > 0
    ? pizzas * positive(input.ozPerPizza) / 16 + 30
    : 0;
  const barrelLbs = positive(input.barrelLbs);
  return {
    totalLbs,
    totalUnits: barrelLbs > 0 ? totalLbs / barrelLbs : 0,
  };
}

export function computeFrontlineRunRequirement(input: {
  casesNeeded: number;
  pizzasPerCase: number;
  ozPerPizza: number;
  configuredEffectiveWeight?: number | null;
}): { totalLbs: number; totalUnits: number; effectiveBatchWeight: number } {
  const pizzas = positive(input.casesNeeded) * positive(input.pizzasPerCase);
  const totalLbs = pizzas > 0 && positive(input.ozPerPizza) > 0
    ? pizzas * positive(input.ozPerPizza) / 16 + 20
    : 0;
  const effectiveBatchWeight =
    computeFrontlineEffectiveBatchWeight(input.configuredEffectiveWeight);
  return {
    totalLbs,
    totalUnits: totalLbs / effectiveBatchWeight,
    effectiveBatchWeight,
  };
}