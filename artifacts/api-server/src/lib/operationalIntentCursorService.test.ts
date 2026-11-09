import { describe, expect, it, vi } from "vitest";
import { syncSnapshotId } from "./syncContract";
import {
  OPERATIONAL_INTENT_CURSOR_PAGE_SIZE,
  readOperationalIntentCursorPage,
  type OperationalIntentCursorReader,
  type OperationalIntentCursorReceipt,
} from "./operationalIntentCursorService";

function receipt(
  cursor: number,
  overrides: Partial<OperationalIntentCursorReceipt> = {},
): OperationalIntentCursorReceipt {
  return {
    cursor,
    date: "2030-03-10",
    outcome: "accepted",
    commandType: "operational-intent",
    actorId: "operator-1",
    deviceId: "device-1",
    baseRevision: 1,
    canonicalRevision: cursor,
    serverReceivedAt: new Date("2030-03-10T10:00:00Z"),
    createdAt: new Date("2030-03-10T10:00:00Z"),
    ...overrides,
  };
}

function reader(
  receipts: OperationalIntentCursorReceipt[],
  snapshots: Array<{ date: string; data: unknown }> = [],
): OperationalIntentCursorReader {
  return {
    readReceipts: vi.fn(async () => receipts),
    readMaterializedSnapshots: vi.fn(async () => snapshots),
  };
}

describe("readOperationalIntentCursorPage", () => {
  it("returns the requested cursor and an empty page when there are no receipts", async () => {
    const store = reader([]);

    const page = await readOperationalIntentCursorPage("live", 42, store);

    expect(page).toEqual({ cursor: 42, hasMore: false, mutations: [] });
    expect(store.readReceipts).toHaveBeenCalledWith("live", 42, OPERATIONAL_INTENT_CURSOR_PAGE_SIZE);
    expect(store.readMaterializedSnapshots).toHaveBeenCalledWith("live", []);
  });

  it("continues from the last receipt and signals a full page", async () => {
    const canonical = { payload: "x".repeat(30_000) };
    const store = reader(Array.from(
      { length: OPERATIONAL_INTENT_CURSOR_PAGE_SIZE },
      (_, index) => receipt(index + 101),
    ), [{ date: "2030-03-10", data: canonical }]);

    const page = await readOperationalIntentCursorPage("live", 100, store);

    expect(page.cursor).toBe(200);
    expect(page.hasMore).toBe(true);
    expect(page.mutations).toHaveLength(OPERATIONAL_INTENT_CURSOR_PAGE_SIZE);
    expect(page.mutations[0]!.cursor).toBe(101);
    expect(page.mutations.at(-1)!.cursor).toBe(200);
    expect(page.mutations.filter((mutation) => mutation.snapshot !== null)).toHaveLength(1);
    expect(page.mutations.slice(0, -1).every((mutation) => mutation.snapshot === null)).toBe(true);
    expect(page.mutations.at(-1)!.snapshot).toEqual(canonical);
    expect(JSON.stringify(page).length).toBeLessThan(70_000);
  });

  it("uses the current scoped materialization for a compacted receipt", async () => {
    const canonical = {
      dayState: { date: "2030-03-10", runs: [{ id: "canonical-current" }] },
      runValues: { "canonical-current": { casesNeeded: 12 } },
    };
    const store = reader(
      [receipt(7)],
      [{ date: "2030-03-10", data: canonical }],
    );

    const page = await readOperationalIntentCursorPage("live", 6, store);

    expect(page.mutations[0]).toMatchObject({
      cursor: 7,
      snapshot: canonical,
      materializedSnapshotId: syncSnapshotId(canonical),
    });
    expect(store.readMaterializedSnapshots).toHaveBeenCalledWith("live", ["2030-03-10"]);
  });

  it("includes one snapshot per date at that date's last adoptable receipt", async () => {
    const firstDateSnapshot = { dayState: { date: "2030-03-10", runs: [{ id: "first-date" }] } };
    const secondDateSnapshot = { dayState: { date: "2030-03-11", runs: [{ id: "second-date" }] } };
    const store = reader([
      receipt(1, { date: "2030-03-10", outcome: "accepted" }),
      receipt(2, { date: "2030-03-10", outcome: "superseded" }),
      receipt(3, { date: "2030-03-10", outcome: "review-required" }),
      receipt(4, { date: "2030-03-11", outcome: "rebased" }),
      receipt(5, { date: "2030-03-11", outcome: "rejected" }),
    ], [
      { date: "2030-03-10", data: firstDateSnapshot },
      { date: "2030-03-11", data: secondDateSnapshot },
    ]);

    const page = await readOperationalIntentCursorPage("live", 0, store);

    expect(page.cursor).toBe(5);
    expect(page.mutations.map(({ cursor, snapshot }) => ({ cursor, snapshot }))).toEqual([
      { cursor: 1, snapshot: null },
      { cursor: 2, snapshot: firstDateSnapshot },
      { cursor: 3, snapshot: null },
      { cursor: 4, snapshot: secondDateSnapshot },
      { cursor: 5, snapshot: null },
    ]);
    expect(page.mutations.filter((mutation) => mutation.snapshot !== null)).toHaveLength(2);
  });

  it("does not expose snapshots for non-adoptable outcomes", async () => {
    const store = reader(
      [
        receipt(1, { outcome: "review-required" }),
        receipt(2, { outcome: "rejected" }),
      ],
      [{ date: "2030-03-10", data: { private: "canonical snapshot" } }],
    );

    const page = await readOperationalIntentCursorPage("live", 0, store);

    expect(page.mutations).toHaveLength(2);
    expect(page.mutations.map(({ snapshot, materializedSnapshotId }) => ({
      snapshot,
      materializedSnapshotId,
    }))).toEqual([
      { snapshot: null, materializedSnapshotId: null },
      { snapshot: null, materializedSnapshotId: null },
    ]);
    expect(page.cursor).toBe(2);
    expect(page.hasMore).toBe(false);
  });
});
