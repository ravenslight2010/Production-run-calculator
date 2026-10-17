export const SAUCE_STOCK_CAP_BARRELS = 2;
export const SAUCE_STOCK_STEP_BARRELS = 0.1;

const positive = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Start a run with two barrels on line exactly once; initialized zero is valid. */
export function initializeSauceStockOnRunStart(values: Record<string, unknown>): Record<string, unknown> {
  if (values.sauceStockInitialized === true) return {};
  return {
    sauceStockBarrels: SAUCE_STOCK_CAP_BARRELS,
    sauceStockAnchorNetSec: 0,
    sauceStockCorrectionGeneration: 0,
    sauceStockInitialized: true,
  };
}

/** Each automatic claim consumes one tenth of a barrel. */
export function computeSauceStockStepSeconds(
  sauceOzPerPizza: unknown,
  ppm: unknown,
  barrelLbs: unknown,
): number {
  const rate = positive(sauceOzPerPizza) * positive(ppm) / (16 * 60);
  const barrel = positive(barrelLbs);
  return rate > 0 && barrel > 0
    ? barrel * SAUCE_STOCK_STEP_BARRELS / rate
    : 0;
}

export function capSauceStock(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  const capped = Math.min(SAUCE_STOCK_CAP_BARRELS, Math.max(0, finite));
  return Math.round(capped * 10) / 10;
}

/** Apply one due tenth-barrel tick without floating-point residue. */
export function depleteSauceStock(onHandBarrels: number): number {
  return capSauceStock(capSauceStock(onHandBarrels) - SAUCE_STOCK_STEP_BARRELS);
}
