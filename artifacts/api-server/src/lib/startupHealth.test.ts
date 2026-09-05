import { describe, expect, it, beforeEach } from "vitest";
import {
  beginStartup,
  claimStartupSlowWarning,
  DEFAULT_STARTUP_WARNING_THRESHOLD_MS,
  getStartupHealth,
  getStartupWarningThresholdMs,
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

  it("uses a bounded configurable warning threshold", () => {
    expect(getStartupWarningThresholdMs()).toBe(DEFAULT_STARTUP_WARNING_THRESHOLD_MS);
    expect(getStartupWarningThresholdMs("4_000")).toBe(DEFAULT_STARTUP_WARNING_THRESHOLD_MS);
    expect(getStartupWarningThresholdMs("4000")).toBe(4_000);
    expect(getStartupWarningThresholdMs("0")).toBe(DEFAULT_STARTUP_WARNING_THRESHOLD_MS);
    expect(getStartupWarningThresholdMs("999999999999")).toBe(24 * 60 * 60 * 1000);
  });

  it("claims the slow-start warning once while startup remains pending", () => {
    beginStartup(4_000);
    markStartupStage("data_heals");

    expect(claimStartupSlowWarning(33_999, 30_000)).toBe(false);
    expect(claimStartupSlowWarning(34_000, 30_000)).toBe(true);
    expect(claimStartupSlowWarning(40_000, 30_000)).toBe(false);

    markStartupReady(41_000);
    expect(claimStartupSlowWarning(50_000, 30_000)).toBe(false);
  });
});