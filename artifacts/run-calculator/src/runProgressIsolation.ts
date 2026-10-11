import type { FormValues, RunMeta } from "./types";

/**
 * Packaging, Sauce, and Frontline applicator completion belong to a started
 * run. A pending run can legitimately carry staged dough counters, but never
 * completed production counters from another run.
 *
 * Returning the original object for started runs and already-clean pending runs
 * keeps normal live calculations referentially stable.
 */
export function isolatePendingRunPackagingProgress(
  run: RunMeta | undefined,
  values: FormValues,
): FormValues {
  if (
    run?.startedAt ||
    (
      Number(values.skidsCompleted) === 0
      && Number(values.casesOnCurrentSkid) === 0
      && Number(values.sauceBarrelsMade) === 0
      && Number(values.sauceBarrelAnchorNetSec) === 0
      && Number(values.sauceBarrelCorrectionGeneration) === 0
      && Number(values.app1BatchesMade) === 0
      && Number(values.app1BatchAnchorNetSec) === 0
      && Number(values.app1BatchCorrectionGeneration) === 0
      && Number(values.app2BatchesMade) === 0
      && Number(values.app2BatchAnchorNetSec) === 0
      && Number(values.app2BatchCorrectionGeneration) === 0
      && Number(values.app3BatchesMade) === 0
      && Number(values.app3BatchAnchorNetSec) === 0
      && Number(values.app3BatchCorrectionGeneration) === 0
      && Number(values.app4BatchesMade) === 0
      && Number(values.app4BatchAnchorNetSec) === 0
      && Number(values.app4BatchCorrectionGeneration) === 0
      && values.applicatorStockInitialized !== true
      && Number(values.app1StockLbs) === 0 && Number(values.app1StockAnchorNetSec) === 0 && Number(values.app1StockCorrectionGeneration) === 0
      && Number(values.app2StockLbs) === 0 && Number(values.app2StockAnchorNetSec) === 0 && Number(values.app2StockCorrectionGeneration) === 0
      && Number(values.app3StockLbs) === 0 && Number(values.app3StockAnchorNetSec) === 0 && Number(values.app3StockCorrectionGeneration) === 0
      && Number(values.app4StockLbs) === 0 && Number(values.app4StockAnchorNetSec) === 0 && Number(values.app4StockCorrectionGeneration) === 0
      && Number(values.pep1StockLbs) === 0 && Number(values.pep1StockAnchorNetSec) === 0 && Number(values.pep1StockCorrectionGeneration) === 0
      && Number(values.pep1bStockLbs) === 0 && Number(values.pep1bStockAnchorNetSec) === 0 && Number(values.pep1bStockCorrectionGeneration) === 0
      && Number(values.pep2StockLbs) === 0 && Number(values.pep2StockAnchorNetSec) === 0 && Number(values.pep2StockCorrectionGeneration) === 0
      && Number(values.pep2bStockLbs) === 0 && Number(values.pep2bStockAnchorNetSec) === 0 && Number(values.pep2bStockCorrectionGeneration) === 0
    )
  ) {
    return values;
  }

  return {
    ...values,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    sauceBarrelsMade: 0,
    sauceBarrelAnchorNetSec: 0,
    sauceBarrelCorrectionGeneration: 0,
    app1BatchesMade: 0,
    app1BatchAnchorNetSec: 0,
    app1BatchCorrectionGeneration: 0,
    app1StockLbs: 0,
    app1StockAnchorNetSec: 0,
    app1StockCorrectionGeneration: 0,
    app2BatchesMade: 0,
    app2BatchAnchorNetSec: 0,
    app2BatchCorrectionGeneration: 0,
    app2StockLbs: 0,
    app2StockAnchorNetSec: 0,
    app2StockCorrectionGeneration: 0,
    app3BatchesMade: 0,
    app3BatchAnchorNetSec: 0,
    app3BatchCorrectionGeneration: 0,
    app3StockLbs: 0,
    app3StockAnchorNetSec: 0,
    app3StockCorrectionGeneration: 0,
    app4BatchesMade: 0,
    app4BatchAnchorNetSec: 0,
    app4BatchCorrectionGeneration: 0,
    app4StockLbs: 0,
    app4StockAnchorNetSec: 0,
    app4StockCorrectionGeneration: 0,
    applicatorStockInitialized: false,
    pep1StockLbs: 0,
    pep1StockAnchorNetSec: 0,
    pep1StockCorrectionGeneration: 0,
    pep1bStockLbs: 0,
    pep1bStockAnchorNetSec: 0,
    pep1bStockCorrectionGeneration: 0,
    pep2StockLbs: 0,
    pep2StockAnchorNetSec: 0,
    pep2StockCorrectionGeneration: 0,
    pep2bStockLbs: 0,
    pep2bStockAnchorNetSec: 0,
    pep2bStockCorrectionGeneration: 0,
  };
}
