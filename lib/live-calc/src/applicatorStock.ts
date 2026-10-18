import { computeFrontlineEffectiveBatchWeight } from "./stagedSupply";

export const APPLICATOR_STOCK_REGISTERS = [
  "app1", "app2", "app3", "app4", "pep1", "pep1b", "pep2", "pep2b",
] as const;
export type ApplicatorStockRegister = (typeof APPLICATOR_STOCK_REGISTERS)[number];

export const APPLICATOR_STOCK_CHANNELS = [
  "app1-stock", "app2-stock", "app3-stock", "app4-stock",
  "pep1-stock", "pep1b-stock", "pep2-stock", "pep2b-stock",
] as const;
export type ApplicatorStockChannel = (typeof APPLICATOR_STOCK_CHANNELS)[number];

export const MIX_APPLICATOR_STOCK_CAP_LBS = 100;
export const PEPPERONI_STOCK_CAP_LBS = 50;

export type ApplicatorStockFields = {
  stock: string;
  anchor: string;
  correctionGeneration: string;
};

export function applicatorStockFields(register: ApplicatorStockRegister): ApplicatorStockFields {
  const prefix = register;
  return {
    stock: `${prefix}StockLbs`,
    anchor: `${prefix}StockAnchorNetSec`,
    correctionGeneration: `${prefix}StockCorrectionGeneration`,
  };
}

export function applicatorStockRegisterForChannel(channel: string): ApplicatorStockRegister | undefined {
  const match = /^(app[1-4]|pep[12]b?)-stock$/.exec(channel);
  return match?.[1] as ApplicatorStockRegister | undefined;
}

function finitePositive(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readRecipeLbs(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    return sum + finitePositive((row as Record<string, unknown>).lbs);
  }, 0);
}

/** Capacity is physical stock, not a projection of calculated run demand. */
export function computeApplicatorStockCapacityLbs(
  values: Record<string, unknown>,
  register: ApplicatorStockRegister,
): number {
  if (register.startsWith("app")) {
    const type = String(values[`${register}Type`] ?? "").trim();
    if (!type) return 0;
    if (type.toLowerCase().includes("mix")) return MIX_APPLICATOR_STOCK_CAP_LBS;
    const configuredWeight =
      readRecipeLbs(values[`${register}CheeseRecipe`]) ||
      finitePositive(values[`${register}BatchLbs`]);
    return computeFrontlineEffectiveBatchWeight(configuredWeight) * 2;
  }

  const typeField = register.endsWith("b")
    ? `${register.slice(0, -1)}TypeB`
    : `${register}Type`;
  if (!String(values[typeField] ?? "").trim()) return 0;
  if (register.startsWith("pep2") && values.pep1Combined === true) return 0;
  return PEPPERONI_STOCK_CAP_LBS;
}

/** Seed a new run's physical bins once; prior made-count registers are untouched. */
export function initializeApplicatorStockOnRunStart(
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (values.applicatorStockInitialized === true) return {};
  const initialized: Record<string, unknown> = { applicatorStockInitialized: true };
  for (const register of APPLICATOR_STOCK_REGISTERS) {
    const fields = applicatorStockFields(register);
    initialized[fields.stock] = computeApplicatorStockCapacityLbs(values, register);
    initialized[fields.anchor] = 0;
    initialized[fields.correctionGeneration] = 0;
  }
  return initialized;
}

export function computeApplicatorStockRateLbsPerSecond(ozPerPizza: unknown, ppm: unknown): number {
  return finitePositive(ozPerPizza) * finitePositive(ppm) / (16 * 60);
}

export function computeApplicatorStockCadenceSeconds(
  values: Record<string, unknown>,
  register: ApplicatorStockRegister,
  ppm: unknown,
): number {
  const capacityLbs = computeApplicatorStockCapacityLbs(values, register);
  const batchLbs = register.startsWith("pep")
    ? PEPPERONI_STOCK_CAP_LBS
    : capacityLbs / 2;
  const ozField = register.endsWith("b")
    ? `${register.slice(0, -1)}OzPerPizzaB`
    : `${register}OzPerPizza`;
  const rate = computeApplicatorStockRateLbsPerSecond(values[ozField], ppm);
  return batchLbs > 0 && rate > 0 ? batchLbs / rate / 4 : 0;
}

export function depleteApplicatorStock(input: {
  onHandLbs: number;
  elapsedSeconds: number;
  ozPerPizza: number;
  ppm: number;
}): number {
  const onHand = finitePositive(input.onHandLbs);
  const elapsed = finitePositive(input.elapsedSeconds);
  const rate = computeApplicatorStockRateLbsPerSecond(input.ozPerPizza, input.ppm);
  return Math.max(0, onHand - elapsed * rate);
}

export function capApplicatorStock(value: number, capacityLbs: number): number {
  const capacity = finitePositive(capacityLbs);
  const stock = Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(capacity, Math.max(0, stock)) * 100) / 100;
}
