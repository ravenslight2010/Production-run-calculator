import { describe, expect, it } from "vitest";
import {
  canRebaseManualApplicatorAdjustment,
  type ManualSectionAutoTrackLedgerRow,
} from "./manualSectionAutoTrackRebase";

const runId = "app1-run";
const baseline = {
  app1BatchesMade: 4,
  app1BatchAnchorNetSec: 10,
  app1BatchCorrectionGeneration: 1,
  app1StockLbs: 2,
  app1StockAnchorNetSec: 10,
  app1StockCorrectionGeneration: 1,
  app1StockConsumedLbs: 0.25,
};

function snapshot(values: Record<string, number>) {
  return { runValues: { [runId]: values } };
}

function manualBaselineRow(): ManualSectionAutoTrackLedgerRow {
  return {
    canonicalRevision: 1,
    commandType: "manual-section:app1",
    outcome: "accepted",
    snapshot: snapshot(baseline),
    actionData: { runId, section: "app1" },
  };
}

function acceptedStockTick(): ManualSectionAutoTrackLedgerRow {
  const after = {
    ...baseline,
    app1StockLbs: 1.75,
    app1StockAnchorNetSec: 11,
    app1StockConsumedLbs: 0.5,
  };
  return {
    canonicalRevision: 2,
    commandType: "auto-track",
    outcome: "accepted",
    snapshot: snapshot(after),
    actionData: {
      runId,
      channel: "app1-stock",
      mutations: [
        { field: "app1StockLbs", from: baseline.app1StockLbs, to: after.app1StockLbs },
        { field: "app1StockAnchorNetSec", from: baseline.app1StockAnchorNetSec, to: after.app1StockAnchorNetSec },
        { field: "app1StockConsumedLbs", from: baseline.app1StockConsumedLbs, to: after.app1StockConsumedLbs },
      ],
    },
  };
}

describe("manual applicator adjustment auto-track rebase proof", () => {
  it("allows only a contiguous, accepted same-run stock tick after the observed baseline", () => {
    const tick = acceptedStockTick();
    const after = (tick.snapshot as { runValues: Record<string, Record<string, number>> }).runValues[runId];

    expect(canRebaseManualApplicatorAdjustment({
      runId,
      section: "app1",
      baseValues: baseline,
      currentValues: after,
      currentRevision: 2,
      ledgerRows: [manualBaselineRow(), tick],
    })).toBe(true);
  });

  it("rejects an intervening manual edit even when a later auto-track tick also changed stock", () => {
    const manualAfter = { ...baseline, app1StockLbs: 1 };
    const manual: ManualSectionAutoTrackLedgerRow = {
      canonicalRevision: 2,
      commandType: "manual-section:app1",
      outcome: "accepted",
      snapshot: snapshot(manualAfter),
      actionData: { runId, section: "app1" },
    };
    const tick: ManualSectionAutoTrackLedgerRow = {
      ...acceptedStockTick(),
      canonicalRevision: 3,
      snapshot: snapshot({ ...manualAfter, app1StockLbs: 0.75, app1StockConsumedLbs: 0.5, app1StockAnchorNetSec: 11 }),
      actionData: {
        runId,
        channel: "app1-stock",
        mutations: [
          { field: "app1StockLbs", from: 1, to: 0.75 },
          { field: "app1StockConsumedLbs", from: baseline.app1StockConsumedLbs, to: 0.5 },
          { field: "app1StockAnchorNetSec", from: baseline.app1StockAnchorNetSec, to: 11 },
        ],
      },
    };

    expect(canRebaseManualApplicatorAdjustment({
      runId,
      section: "app1",
      baseValues: baseline,
      currentValues: (tick.snapshot as { runValues: Record<string, Record<string, number>> }).runValues[runId],
      currentRevision: 3,
      ledgerRows: [manualBaselineRow(), manual, tick],
    })).toBe(false);
  });

  it("fails closed when revisions are missing or a claim cannot account for every changed field", () => {
    const tick = acceptedStockTick();
    const after = (tick.snapshot as { runValues: Record<string, Record<string, number>> }).runValues[runId];

    expect(canRebaseManualApplicatorAdjustment({
      runId, section: "app1", baseValues: baseline, currentValues: after,
      currentRevision: 3, ledgerRows: [manualBaselineRow(), tick],
    })).toBe(false);
    expect(canRebaseManualApplicatorAdjustment({
      runId,
      section: "app1",
      baseValues: baseline,
      currentValues: after,
      currentRevision: 2,
      ledgerRows: [manualBaselineRow(), { ...tick, actionData: { runId, channel: "app1-stock", mutations: [] } }],
    })).toBe(false);
  });
});
