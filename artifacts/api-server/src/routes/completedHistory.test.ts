import { describe, expect, it } from "vitest";
import { validateCompletionBoundary, parseHistoryCursor } from "./completedHistory";

const endedAt = Date.parse("2026-09-06T15:00:00.000Z");
const valid = {
  operationId: "completed:2026-09-06:run-1",
  runId: "run-1",
  date: "2026-09-06",
  completedAt: new Date(endedAt).toISOString(),
  snapshot: {
    dayState: {
      date: "2026-09-06",
      currentIndex: 0,
      runs: [{ id: "run-1", brand: "Acme", flavor: "Cheese", startedAt: endedAt - 60_000, endedAt }],
    },
    runValues: { "run-1": { casesNeeded: 20 } },
  },
};

describe("completed history cursor", () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  it("keeps the full date/run identity as the stable page boundary", () => {
    expect(parseHistoryCursor(encode({ date: "2026-10-23", runId: "equal-time-z" })))
      .toEqual({ date: "2026-10-23", runId: "equal-time-z" });
  });
  it.each(["garbage", encode({ date: "2026-02-30", runId: "r" }), encode({ date: "2026-10-23" })])(
    "rejects malformed cursors (%s)", (cursor) => expect(parseHistoryCursor(cursor)).toBeNull(),
  );
});
describe("completed history boundary", () => {
  it("accepts exactly one ended run whose envelope matches the snapshot", () => {
    expect(validateCompletionBoundary(valid)).toBe(true);
  });

  it.each([
    { ...valid, date: "2026-09-05" },
    { ...valid, runId: "run-2" },
    { ...valid, completedAt: "2026-09-06T15:01:00.000Z" },
    { ...valid, snapshot: { ...valid.snapshot, runValues: {} } },
    {
      ...valid,
      snapshot: {
        ...valid.snapshot,
        dayState: { ...valid.snapshot.dayState, runs: [{ id: "run-1", startedAt: endedAt - 60_000 }] },
      },
    },
  ])("rejects an envelope that is not the immutable snapshot boundary", (candidate) => {
    expect(validateCompletionBoundary(candidate)).toBe(false);
  });
});