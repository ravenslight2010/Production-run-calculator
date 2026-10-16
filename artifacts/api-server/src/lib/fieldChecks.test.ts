import { describe, expect, it } from "vitest";
import {
  FIELD_CHECK_INCOMPLETE_REVIEW_THRESHOLD,
  deriveFieldCheckStatus,
  deriveFieldCheckCoverage,
  HARDWARE_CHECK_VERSION,
  FIELD_CHECK_CATALOG,
  hardwareConfirmationObservation,
  validateFieldCheckBatch,
  validateHardwareConfirmation,
  fieldCheckFiltersSchema,
} from "./fieldChecks";

const validObservation = {
  observationId: "browser-abc123:startup:1:success",
  checkName: "startup",
  checkVersion: "1",
  outcome: "success",
  observedAt: new Date().toISOString(),
  appBuild: "build-123",
  deviceCategory: "mobile-chrome",
  metrics: { durationMs: 42 },
};

describe("field-check contract", () => {
  it("accepts only bounded exact scalar report filters", () => {
    for (const filters of [{}, { appBuild: "local" }, { appBuild: "x".repeat(100), deviceCategory: "mobile-safari" }]) {
      expect(fieldCheckFiltersSchema.safeParse(filters).success).toBe(true);
    }
    for (const filters of [
      { appBuild: "" }, { appBuild: " x " }, { appBuild: "x".repeat(101) },
      { appBuild: ["a", "b"] }, { appBuild: { eq: "a" } },
      { deviceCategory: "safari" }, { deviceCategory: ["mobile-safari"] },
      { scope: "sandbox" }, { limit: "5000" },
    ]) expect(fieldCheckFiltersSchema.safeParse(filters).success).toBe(false);
  });
  it("validates v3 diagnostic allowlists while accepting queued legacy evidence", () => {
    const accepts = (checkName: string, metrics: Record<string, number>, outcome = "failure", checkVersion = "3") =>
      validateFieldCheckBatch({ observations: [{ ...validObservation, checkName, checkVersion, outcome, metrics }] }).ok;
    for (const failureCode of [1, 2, 3]) expect(accepts("sync-acknowledgment", { failureCode })).toBe(true);
    expect(accepts("sync-acknowledgment", {})).toBe(false);
    expect(accepts("sync-acknowledgment", { failureCode: 4 })).toBe(false);
    expect(accepts("sync-acknowledgment", { failureCode: 1.5 })).toBe(false);
    expect(accepts("sync-acknowledgment", { failureCode: 1, runId: 123 })).toBe(false);
    expect(accepts("sync-acknowledgment", { failureCode: 1 }, "success")).toBe(false);
    expect(accepts("sync-acknowledgment", {}, "success")).toBe(true);
    expect(accepts("stale-deployment-recovery", {}, "incomplete")).toBe(true);
    expect(accepts("stale-deployment-recovery", { durationMs: 1 }, "success")).toBe(false);
    for (const sourceCode of [1, 2, 3, 4]) expect(accepts("performance", { sourceCode, durationMs: 1501 })).toBe(true);
    const invalidMetrics: Array<Record<string, number>> = [
      { sourceCode: 99, durationMs: 1 }, { sourceCode: 1 }, { sourceCode: 1, durationMs: -1 },
      { sourceCode: 1, durationMs: 10_000_001 }, { sourceCode: 1, durationMs: 1, url: 1 },
    ];
    for (const metrics of invalidMetrics) {
      expect(accepts("performance", metrics)).toBe(false);
    }
    expect(accepts("sync-acknowledgment", {}, "failure", "2")).toBe(true);
    expect(accepts("performance", { durationMs: 2000 }, "failure", "2")).toBe(true);
    expect(accepts("sync-acknowledgment", { failureCode: 99 }, "failure", "4")).toBe(false);
  });
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

  it("accepts fixed workflow metrics and bounded save-failure cause codes only", () => {
    const workflow = {
      ...validObservation,
      observationId: "browser-abc123:spec-import-review-commit:1:success",
      checkName: "spec-import-review-commit",
      outcome: "success",
      metrics: { durationMs: 15 * 60 * 1000 },
    };
    expect(validateFieldCheckBatch({ observations: [workflow] }).ok).toBe(true);
    expect(validateFieldCheckBatch({
      observations: [{ ...workflow, outcome: "incomplete" }],
    }).ok).toBe(true);
    expect(validateFieldCheckBatch({
      observations: [{ ...workflow, metrics: { durationMs: 15 * 60 * 1000 + 1 } }],
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{ ...workflow, metrics: { durationMs: 20, itemCount: 1 } }],
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{ ...workflow, metrics: {} }],
    }).ok).toBe(false);

    const saveFailure = {
      ...workflow,
      observationId: "browser-abc123:production-run-save-sync:1:failure",
      checkName: "production-run-save-sync",
      outcome: "failure",
      metrics: { durationMs: 20, failureCode: 2 },
    };
    expect(validateFieldCheckBatch({ observations: [saveFailure] }).ok).toBe(true);
    expect(validateFieldCheckBatch({
      observations: [{ ...saveFailure, metrics: { durationMs: 20, failureCode: 99 } }],
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{ ...saveFailure, outcome: "success" }],
    }).ok).toBe(false);
    expect(validateFieldCheckBatch({
      observations: [{ ...saveFailure, checkName: "spec-import-review-commit" }],
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

  it("keeps evidence coverage separate from health", () => {
    const now = Date.parse("2026-09-03T12:00:00.000Z");
    expect(deriveFieldCheckCoverage({
      expiresHours: 24, lastSuccessfulAt: null, hasObservation: false, now,
    })).toBe("never-observed");
    expect(deriveFieldCheckCoverage({
      expiresHours: 24, lastSuccessfulAt: null, hasObservation: true, now,
    })).toBe("no-success");
    expect(deriveFieldCheckCoverage({
      expiresHours: 24, lastSuccessfulAt: new Date(now - 60_000), hasObservation: true, now,
    })).toBe("current");
    expect(deriveFieldCheckCoverage({
      expiresHours: 24, lastSuccessfulAt: new Date(now - 25 * 60 * 60 * 1000), hasObservation: true, now,
    })).toBe("stale");
    expect(deriveFieldCheckCoverage({
      expiresHours: null, lastSuccessfulAt: new Date(now - 5 * 365 * 24 * 60 * 60 * 1000),
      hasObservation: true, now,
    })).toBe("current");
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
    expect(validateHardwareConfirmation({ ...confirmation, deviceCategory: "iphone" }).ok).toBe(true);
    if (valid.ok) {
      expect(hardwareConfirmationObservation(valid.data)).toMatchObject({
        ...confirmation,
        appBuild: "hardware-protocol",
        metrics: {},
      });
    }
  });

  it("classifies expanded checks by honest observation owner", () => {
    expect(FIELD_CHECK_CATALOG.find((check) => check.name === "production-run-save-sync")).toMatchObject({
      observedBy: "browser",
      expiresHours: 72,
    });
    expect(FIELD_CHECK_CATALOG.find((check) => check.name === "spec-import-review-commit")).toMatchObject({
      observedBy: "browser",
      expiresHours: 168,
    });
    expect(FIELD_CHECK_CATALOG.find((check) => check.name === "offline-queue-replay")).toMatchObject({
      observedBy: "browser",
      expiresHours: 168,
    });
    expect(FIELD_CHECK_CATALOG.find((check) => check.name === "reload-persistence")?.label)
      .toBe("Reload startup");
    expect(FIELD_CHECK_CATALOG.find((check) => check.name === "stale-deployment-recovery")?.evidence)
      .toContain("different build");
    for (const name of ["orientation-layout", "safe-area-clearance", "camera-file-selection", "update-handoff"]) {
      expect(FIELD_CHECK_CATALOG.find((check) => check.name === name)).toMatchObject({
        observedBy: "hardware",
        expiresHours: 720,
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