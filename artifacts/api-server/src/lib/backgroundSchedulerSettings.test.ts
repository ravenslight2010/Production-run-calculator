import { describe, expect, it } from "vitest";
import { shouldEnableBackgroundCapacityTelemetry } from "./backgroundSchedulerSettings";

describe("background capacity telemetry setting", () => {
  it("keeps the existing enabled-by-default behavior", () => {
    expect(shouldEnableBackgroundCapacityTelemetry({})).toBe(true);
  });

  it("preserves the existing quiet-fixture default", () => {
    expect(shouldEnableBackgroundCapacityTelemetry({
      DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS: "1",
    })).toBe(false);
  });

  it("allows an isolated measurement to retain telemetry while jobs are disabled", () => {
    expect(shouldEnableBackgroundCapacityTelemetry({
      DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS: "1",
      ENABLE_BACKGROUND_CAPACITY_TELEMETRY: "1",
    })).toBe(true);
  });
});
