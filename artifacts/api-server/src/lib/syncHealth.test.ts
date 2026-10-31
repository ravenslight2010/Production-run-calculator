import { describe, expect, it, vi } from "vitest";
import { buildSyncHealthReport } from "./syncHealth";
import type { LegacySyncReadiness, SyncPeerFrameTelemetry } from "./capacityTelemetry";

const NOW = 1_800_000_000_000;
const at = new Date(NOW);
const prior = { id: "prior", startedAt: NOW - 900_000, endedAt: NOW - 60_000 };
const live = { id: "live", startedAt: NOW - 30_000 };
const pending = { id: "pending" };
const values = { casesNeeded: 200, approxLineSpeed: 90, pizzasPerCase: 12, casesPerSkid: 40 };

async function diagnose(data: Record<string, unknown>) {
  // The report only selects. A thenable query fixture records the three
  // bounded reads, and deliberately exposes no mutation/transaction methods.
  let call = 0;
  const select = vi.fn(() => {
    const result = call++ === 0 ? [{ data, canonicalRevision: 7 }] : [];
    const chain: Record<string, unknown> = {};
    for (const key of ["from", "where", "orderBy", "limit"]) chain[key] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  });
  const before = JSON.stringify(data);
  const report = await buildSyncHealthReport(
    { select } as unknown as Parameters<typeof buildSyncHealthReport>[0],
    "live", "2026-10-31", at,
    {} as LegacySyncReadiness, {} as SyncPeerFrameTelemetry,
  );
  expect(JSON.stringify(data)).toBe(before);
  expect(select).toHaveBeenCalledTimes(3);
  return report.checks.find((check) => check.name === "operational-projection")!;
}

describe("manager sync health lifecycle identity", () => {
  it.each([undefined, 0, 2, -1, 999])(
    "diagnoses the later active run independently of device index %s",
    async (currentIndex) => {
      const check = await diagnose({
        dayState: { runs: [prior, live, pending], currentIndex },
        // Missing prior/pending values must not make the live run fail.
        runValues: { live: values },
        operationalProjection: { runId: "live", calculationRevision: 7 },
      });
      expect(check.status).toBe("healthy");
    },
  );

  it.each([
    { runs: [prior, { ...live, pausedAt: NOW }], id: "live" },
    { runs: [prior, { ...live, endedAt: NOW - 1 }], id: "live" },
    { runs: [pending, { id: "second-pending" }], id: "pending" },
    { runs: [live, { ...live, id: "tie" }], id: "tie" },
  ])("uses canonical paused, draining, setup and tie selection: $id", async ({ runs, id }) => {
    expect((await diagnose({
      dayState: { runs, currentIndex: 0 },
      runValues: { [id]: values },
      operationalProjection: { runId: id, calculationRevision: 7 },
    })).status).toBe("healthy");
  });

  it("does not borrow an ended run's values when the active run has none", async () => {
    const check = await diagnose({
      dayState: { runs: [prior, live] },
      runValues: { prior: values },
    });
    expect(check.status).toBe("failing");
    expect(check.summary).toContain("missing");
  });

  it("still detects a projection belonging to the wrong run", async () => {
    expect((await diagnose({
      dayState: { runs: [prior, live] },
      runValues: { prior: values, live: values },
      operationalProjection: { runId: "prior", calculationRevision: 7 },
    })).status).toBe("failing");
  });

  it("reports no eligible run without inventing production progress", async () => {
    const check = await diagnose({ dayState: { runs: [] }, runValues: {} });
    expect(check.status).toBe("warning");
    expect(check.summary).toContain("no eligible operational run");
  });
});
