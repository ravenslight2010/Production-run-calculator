// Unit tests for verifyForecastHistory — the reconciliation gate that decides
// whether a POST /ai/forecast request's client-submitted `history` is trusted
// enough to persist its resulting plan into shared facility memory.
//
// We mock @workspace/db so the stored daily_sync row per date is controlled
// deterministically, without a real database.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ForecastInput } from "./aiForecast";

let rowsByDate: Record<string, unknown[]> = {};
let queriedDate: string | undefined;
let throwOnQuery = false;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (throwOnQuery) throw new Error("db down");
          return rowsByDate[queriedDate ?? ""] ?? [];
        },
      }),
    }),
  },
  dailySyncTable: { date: "date", scope: "scope" },
}));

// verifyForecastHistory only uses `and`/`eq` to build the where clause; stub
// `eq` to capture which date was queried (the fake table columns above aren't
// real drizzle columns) while leaving the rest of drizzle intact.
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: () => ({}),
    eq: (col: unknown, value: unknown) => {
      if (col === "date") queriedDate = value as string;
      return {};
    },
  };
});

vi.mock("../lib/requestScope", () => ({
  currentScope: () => "live",
}));

import { verifyForecastHistory } from "./aiForecastVerify";

const log = { warn: vi.fn() };

function dayRow(runs: Array<{ id: string; brand: string; flavor: string; endedAt?: number }>, runValues: Record<string, { casesNeeded: number }>) {
  return [{ data: { dayState: { runs }, runValues } }];
}

type HistoryRun = ForecastInput["history"][number]["runs"][number];
type HistoryDay = ForecastInput["history"][number];

function history(entries: Array<{ date: string; brand: string; flavor: string; cases: number }>): ForecastInput["history"] {
  const byDate = new Map<string, HistoryDay>();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, runs: [] });
    byDate.get(e.date)!.runs.push({ brand: e.brand, flavor: e.flavor, cases: e.cases, dieType: "", netRunMin: 0 });
  }
  return [...byDate.values()];
}

function runsOf(entries: Array<{ brand: string; flavor: string; cases: number }>): HistoryRun[] {
  return entries.map((e) => ({ ...e, dieType: "", netRunMin: 0 }));
}

beforeEach(() => {
  rowsByDate = {};
  queriedDate = undefined;
  throwOnQuery = false;
  log.warn.mockClear();
});

describe("verifyForecastHistory", () => {
  it("passes when every claimed product/date matches a real finished run", async () => {
    rowsByDate["2026-06-16"] = dayRow(
      [{ id: "r1", brand: "Tony's", flavor: "Pepperoni", endedAt: 1 }],
      { r1: { casesNeeded: 300 } },
    );
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Tony's", flavor: "Pepperoni", cases: 300 }]),
      "live",
      log,
    );
    expect(ok).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("trivially passes an empty-runs day (asserts nothing)", async () => {
    const ok = await verifyForecastHistory(
      [{ date: "2026-06-16", runs: [] }] as ForecastInput["history"],
      "live",
      log,
    );
    expect(ok).toBe(true);
  });

  it("fails closed when the server has no stored row for a claimed date", async () => {
    const ok = await verifyForecastHistory(
      history([{ date: "2099-01-01", brand: "Tony's", flavor: "Pepperoni", cases: 300 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it("fails when a claimed product never actually ran that day", async () => {
    rowsByDate["2026-06-16"] = dayRow(
      [{ id: "r1", brand: "Tony's", flavor: "Pepperoni", endedAt: 1 }],
      { r1: { casesNeeded: 300 } },
    );
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Fabricated Brand", flavor: "Fake Flavor", cases: 500 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
  });

  it("fails when claimed case volume wildly exceeds the actual finished run", async () => {
    rowsByDate["2026-06-16"] = dayRow(
      [{ id: "r1", brand: "Tony's", flavor: "Pepperoni", endedAt: 1 }],
      { r1: { casesNeeded: 100 } },
    );
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Tony's", flavor: "Pepperoni", cases: 10000 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
  });

  it("fails on inflation SPLIT across multiple runs for the same product/day", async () => {
    // Each individual claimed run is small enough to look plausible, but the
    // AGGREGATE for the product that day is wildly above the real total.
    rowsByDate["2026-06-16"] = dayRow(
      [{ id: "r1", brand: "Tony's", flavor: "Pepperoni", endedAt: 1 }],
      { r1: { casesNeeded: 100 } },
    );
    const claimed: ForecastInput["history"] = [
      {
        date: "2026-06-16",
        runs: runsOf([
          { brand: "Tony's", flavor: "Pepperoni", cases: 90 },
          { brand: "Tony's", flavor: "Pepperoni", cases: 90 },
          { brand: "Tony's", flavor: "Pepperoni", cases: 90 },
        ]),
      },
    ];
    const ok = await verifyForecastHistory(claimed, "live", log);
    expect(ok).toBe(false);
  });

  it("fails when a claimed day silently omits a real finished product", async () => {
    rowsByDate["2026-06-16"] = dayRow(
      [
        { id: "r1", brand: "Tony's", flavor: "Pepperoni", endedAt: 1 },
        { id: "r2", brand: "Aldo's", flavor: "Supreme", endedAt: 1 },
      ],
      { r1: { casesNeeded: 300 }, r2: { casesNeeded: 200 } },
    );
    // Only reports one of the two real products that ran that day.
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Tony's", flavor: "Pepperoni", cases: 300 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
  });

  it("fails on severe under-reporting of a real product's volume", async () => {
    rowsByDate["2026-06-16"] = dayRow(
      [{ id: "r1", brand: "Tony's", flavor: "Pepperoni", endedAt: 1 }],
      { r1: { casesNeeded: 1000 } },
    );
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Tony's", flavor: "Pepperoni", cases: 10 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
  });

  it("ignores a run that never finished (no endedAt) — not real history yet", async () => {
    rowsByDate["2026-06-16"] = dayRow(
      [{ id: "r1", brand: "Tony's", flavor: "Pepperoni" }],
      { r1: { casesNeeded: 300 } },
    );
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Tony's", flavor: "Pepperoni", cases: 300 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
  });

  it("fails closed on a DB read error", async () => {
    throwOnQuery = true;
    const ok = await verifyForecastHistory(
      history([{ date: "2026-06-16", brand: "Tony's", flavor: "Pepperoni", cases: 300 }]),
      "live",
      log,
    );
    expect(ok).toBe(false);
  });
});
