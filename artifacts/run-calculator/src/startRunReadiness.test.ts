import { describe, expect, it } from "vitest";
import {
  findFirstUnreadyScheduledRun,
  getStartRunReadiness,
} from "./startRunReadiness";

describe("getStartRunReadiness", () => {
  it("blocks a case-based run without a positive case pack", () => {
    expect(getStartRunReadiness({ casesNeeded: 20, pizzasPerCase: 0 })).toEqual({
      ready: false,
      missingInput: "pizzasPerCase",
    });
    expect(getStartRunReadiness({ casesNeeded: 20, pizzasPerCase: -1 })).toEqual({
      ready: false,
      missingInput: "pizzasPerCase",
    });
  });

  it("allows a corrected case-based run", () => {
    expect(getStartRunReadiness({ casesNeeded: 20, pizzasPerCase: 12 })).toEqual({
      ready: true,
    });
  });

  it("does not require a case pack for a run that does not request cases", () => {
    expect(getStartRunReadiness({ casesNeeded: 0, pizzasPerCase: 0 })).toEqual({
      ready: true,
    });
  });
});

describe("findFirstUnreadyScheduledRun", () => {
  const runs = [
    { id: "first", casesNeeded: 0 },
    { id: "second", casesNeeded: 25 },
  ];

  it("stops schedule persistence at the first invalid effective setup", () => {
    expect(
      findFirstUnreadyScheduledRun(runs, (run) => ({
        pizzasPerCase: run.id === "second" ? 0 : 12,
      })),
    ).toEqual(runs[1]);
  });

  it("allows the schedule after the case pack is corrected", () => {
    expect(findFirstUnreadyScheduledRun(runs, () => ({ pizzasPerCase: 12 }))).toBeNull();
  });
});