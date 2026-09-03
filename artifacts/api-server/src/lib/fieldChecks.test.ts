import { describe, expect, it } from "vitest";
import {
  FIELD_CHECK_INCOMPLETE_REVIEW_THRESHOLD,
  deriveFieldCheckStatus,
  HARDWARE_CHECK_VERSION,
  hardwareConfirmationObservation,
  validateFieldCheckBatch,
  validateHardwareConfirmation,
} from "./fieldChecks";

const validObservation = {
  observationId: "browser-abc123:startup:1:success",
  checkName: "startup",
  checkVersion: "1",
  outcome: "success",
  observedAt: "2026-09-03T12:00:00.000Z",
  appBuild: "build-123",
  deviceCategory: "mobile-chrome",
  metrics: { durationMs: 42 },
};

describe("field-check contract", () => {
  it("accepts bounded browser observations and rejects unknown checks", () => {
    expect(validateFieldCheckBatch({ observations: [validObservation] }).ok).toBe(true);
    expect(validateFieldCheckBatch({
      observations: [{ ...validObservation, checkName: "recipe-payload" }],
    }).ok).toBe(false);
  });

  it("rejects free-form or oversized metrics", () => {
    expect(validateFieldCheckBatch({
      observations: [{
        ...validObservation,
        metrics: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`metric${i}`, i])),
      }],
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{ ...validObservation, metrics: { stack: "secret" } }],
    }).ok).toBe(false);
  });

  it("rejects overlarge batches and duplicate-shaped ids", () => {
    expect(validateFieldCheckBatch({ observations: [] }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: Array.from({ length: 21 }, (_, i) => ({
        ...validObservation,
        observationId: `browser-abc123:startup:${i}:success`,
      })),
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{ ...validObservation, observationId: "short" }],
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{
        ...validObservation,
        observedAt: "2020-01-01T00:00:00.000Z",
      }],
    }).ok).toBe(false);
  });

  it("has deterministic healthy, collecting, review, and unsupported states", () => {
    const now = Date.parse("2026-09-03T12:00:00.000Z");
    expect(deriveFieldCheckStatus({
      observedBy: "browser",
      expiresHours: 24,
      lastSuccessfulAt: new Date(now - 60_000),
      actionable: false,
      now,
    })).toBe("healthy");
    expect(deriveFieldCheckStatus({
      observedBy: "browser",
      expiresHours: 24,
      lastSuccessfulAt: new Date(now - 25 * 60 * 60 * 1000),
      actionable: false,
      now,
    })).toBe("collecting");
    expect(deriveFieldCheckStatus({
      observedBy: "browser",
      expiresHours: 24,
      lastSuccessfulAt: null,
      actionable: true,
      now,
    })).toBe("needs-review");
    expect(deriveFieldCheckStatus({
      observedBy: "hardware",
      expiresHours: null,
      lastSuccessfulAt: null,
      actionable: false,
      now,
    })).toBe("unsupported");
    expect(FIELD_CHECK_INCOMPLETE_REVIEW_THRESHOLD).toBe(3);
  });

  it("accepts only bounded, current hardware confirmations", () => {
    const confirmation = {
      checkName: "touch-accuracy",
      checkVersion: HARDWARE_CHECK_VERSION,
      outcome: "success",
      observedAt: new Date().toISOString(),
      deviceCategory: "android-tablet",
    };
    const valid = validateHardwareConfirmation(confirmation);
    expect(valid.ok).toBe(true);
    expect(validateHardwareConfirmation({ ...confirmation, notes: "free form" }).ok).toBe(false);
    expect(validateHardwareConfirmation({ ...confirmation, deviceCategory: "desktop-chrome" }).ok).toBe(false);
    if (valid.ok) {
      expect(hardwareConfirmationObservation(valid.data)).toMatchObject({
        ...confirmation,
        appBuild: "hardware-protocol",
        metrics: {},
      });
    }
  });

  it("distinguishes confirmed and failed hardware evidence from unsupported", () => {
    const now = Date.now();
    expect(deriveFieldCheckStatus({
      observedBy: "hardware",
      expiresHours: null,
      lastSuccessfulAt: new Date(now),
      actionable: false,
      now,
    })).toBe("healthy");
    expect(deriveFieldCheckStatus({
      observedBy: "hardware",
      expiresHours: null,
      lastSuccessfulAt: null,
      actionable: true,
      now,
    })).toBe("needs-review");
  });
});