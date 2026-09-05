import { describe, expect, it, beforeEach } from "vitest";
import {
  beginStartup,
  getStartupHealth,
  markStartupFailed,
  markStartupReady,
  markStartupStage,
  resetStartupHealthForTests,
} from "./startupHealth";

describe("startup health state", () => {
  beforeEach(() => {
    resetStartupHealthForTests();
  });

  it("stays not ready while required initialization is running", () => {
    beginStartup(1_000);
    markStartupStage("data_heals");

    expect(getStartupHealth(1_250)).toEqual({
      phase: "starting",
      stage: "data_heals",
      durationMs: 250,
    });
  });

  it("exposes only a safe failure category", () => {
    beginStartup(2_000);
    markStartupFailed("data_heals", "data_heals_failed", 2_750);

    expect(getStartupHealth(9_000)).toEqual({
      phase: "failed",
      stage: "data_heals",
      durationMs: 750,
      failure: { stage: "data_heals", errorCode: "data_heals_failed" },
    });
  });

  it("becomes ready only after initialization succeeds", () => {
    beginStartup(3_000);
    markStartupStage("seed_roles");
    markStartupReady(3_500);

    expect(getStartupHealth(10_000)).toEqual({
      phase: "ready",
      stage: "seed_roles",
      durationMs: 500,
    });
  });
});