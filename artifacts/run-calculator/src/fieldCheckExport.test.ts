import { afterEach, describe, expect, it, vi } from "vitest";
import { createFieldCheckExport, downloadFieldCheckExport, FIELD_CHECK_EXPORT_MAX_BYTES } from "./fieldCheckExport";

const at = new Date("2026-10-16T12:34:56.789Z");
function fixture() {
  return {
    scope: "current facility", generatedAt: at.toISOString(), overallStatus: "needs-review",
    checks: [{
      name: "performance", status: "needs-review", observedBy: "browser",
      coverage: "no-success", lastObservedAt: at.toISOString(), lastReceiptDelayMs: 12_345,
      lastSuccessfulAt: null, lastSuccessfulMetrics: null,
      failureCount: 1, incompleteCount: 0, actionable: true, issueStatus: "open",
      recentFailures: [{
        outcome: "failure", observedAt: at.toISOString(), appBuild: "local", deviceCategory: "mobile-chrome",
        metrics: { durationMs: 20_001, sourceCode: 3 },
      }],
    }],
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("allowlisted field-check export", () => {
  it("labels filtered populations without exporting raw build identifiers or extra metadata", () => {
    const input = { ...fixture(), population: {
      appBuild: "PRIVATE-build-identifier", deviceCategory: "mobile-safari",
      countBasis: "retained-observations", retentionDays: 30, actor: "PRIVATE-actor",
    } };
    const result = createFieldCheckExport(input, at);
    expect(result.json).not.toMatch(/PRIVATE/);
    expect(JSON.parse(result.json).population).toEqual({
      selection: "filtered", countBasis: "retained-observations",
      retentionDays: 30, buildSelection: "selected-unverified", deviceCategory: "mobile-safari",
    });
    input.population.appBuild = "local";
    expect(JSON.parse(createFieldCheckExport(input, at).json).population.buildSelection).toBe("unknown-local");
    expect(JSON.parse(createFieldCheckExport({ ...fixture(), population: {
      appBuild: null, deviceCategory: null, countBasis: "lifetime-issues", retentionDays: 30,
    } }, at).json).population).toEqual({
      selection: "unfiltered", countBasis: "lifetime-issues", retentionDays: 30,
      buildSelection: "all", deviceCategory: "all",
    });
  });
  it("defines every exported field and version, exact times, scope and advisory provenance", () => {
    const result = createFieldCheckExport(fixture(), at);
    expect(result.filename).toBe("field-check-report-v1-2026-10-16T12-34-56-789Z.json");
    const output = JSON.parse(result.json);
    expect(Object.keys(output)).toEqual(["schemaVersion", "capturedAt", "facilityScope", "population", "provenance",
      "diagnosticCodeLegend", "reportGeneratedAt", "overallStatus", "checks"]);
    expect(output).toMatchObject({
      schemaVersion: 1, capturedAt: at.toISOString(), facilityScope: "current facility",
      reportGeneratedAt: at.toISOString(), overallStatus: "needs-review",
      provenance: { environment: "unknown", buildIdentity: "unknown", missingDetailLabel: "unavailable" },
      checks: [{
        name: "performance", status: "needs-review", observedBy: "browser",
        coverage: "no-success", lastObservedAt: at.toISOString(), lastReceiptDelayMs: 12_345,
        lastSuccessfulAt: "unavailable",
        lastSuccessfulDiagnostics: { durationMs: "unavailable", durationAtCeiling: false, failureCode: "unavailable", sourceCode: "unavailable" },
        failureCount: 1, incompleteCount: 0, actionable: true, issueStatus: "open",
        recentFailures: [{
          outcome: "failure", observedAt: at.toISOString(), buildCategory: "unknown-local", deviceCategory: "mobile-chrome",
          diagnostics: {
            durationMs: 20_001, durationAtCeiling: false, failureCode: "unavailable",
            sourceCode: 3,
          },
          reportedRequestCorrelationId: "unavailable",
        }],
      }],
    });
    expect(output.provenance.notice).toContain("Not release readiness or physical-device verification");
    expect(Object.keys(output.checks[0])).toEqual(["name", "status", "coverage", "observedBy", "lastObservedAt",
      "lastReceiptDelayMs",
      "lastSuccessfulAt", "lastSuccessfulDiagnostics", "failureCount", "incompleteCount", "actionable",
      "issueStatus", "recentFailures"]);
    expect(Object.keys(output.checks[0].recentFailures[0])).toEqual(["outcome", "observedAt",
      "buildCategory", "deviceCategory", "diagnostics", "reportedRequestCorrelationId"]);
    expect(Object.keys(output.checks[0].recentFailures[0].diagnostics)).toEqual(["durationMs",
      "durationAtCeiling", "failureCode", "sourceCode"]);
    expect(output.diagnosticCodeLegend.legacyRequestClassification)
      .toContain("not captured by the older record");
    expect(new TextEncoder().encode(result.json).length).toBeLessThan(FIELD_CHECK_EXPORT_MAX_BYTES);
  });

  it("never serializes extra fields, free text, raw build values or arbitrary numeric keys", () => {
    const input = fixture();
    const poison = { runId: "PRIVATE", userId: "PRIVATE", clientId: "PRIVATE", url: "https://PRIVATE",
      error: "PRIVATE", credentials: "PRIVATE", payload: { recipe: "PRIVATE" } };
    Object.assign(input, poison);
    Object.assign(input.checks[0]!, poison, { label: "PRIVATE", evidence: "PRIVATE" });
    Object.assign(input.checks[0]!.recentFailures[0]!, poison, { appBuild: "PRIVATE", deviceCategory: "PRIVATE" });
    Object.assign(input.checks[0]!.recentFailures[0]!.metrics, { PRIVATE: 1234, runId: 42 });
    expect(createFieldCheckExport(input, at).json).not.toMatch(/PRIVATE|runId|userId|clientId|credentials|https:/);
  });

  it("marks missing and invalid details explicitly without inventing diagnostic causes", () => {
    const input = fixture();
    Object.assign(input.checks[0], { status: "PRIVATE", observedBy: "PRIVATE", actionable: null,
      failureCount: Infinity, incompleteCount: -1, lastObservedAt: "PRIVATE" });
    Object.assign(input.checks[0]!.recentFailures[0]!, {
      observedAt: "PRIVATE", outcome: "PRIVATE", metrics: { durationMs: NaN, sourceCode: 999, failureCode: 999 },
    });
    const output = JSON.parse(createFieldCheckExport(input, at).json).checks[0];
    expect(output).toMatchObject({ status: "unavailable", observedBy: "unavailable", actionable: "unavailable",
      failureCount: "unavailable", incompleteCount: "unavailable", lastObservedAt: "unavailable",
      recentFailures: [{ observedAt: "unavailable", outcome: "unavailable",
        diagnostics: { durationMs: "unavailable", sourceCode: "unavailable", failureCode: "unavailable" } }] });
    expect(() => createFieldCheckExport({ scope: "current facility", checks: [{}] })).toThrow();
  });

  it("bounds counts, metrics, builds and duration saturation", () => {
    const input = fixture();
    const sample = input.checks[0]!.recentFailures[0]!;
    sample.metrics.durationMs = 10_000_000;
    sample.appBuild = "a".repeat(40);
    let output = JSON.parse(createFieldCheckExport(input, at).json).checks[0].recentFailures[0];
    expect(output.buildCategory).toBe("revision-shaped-unverified");
    expect(output.diagnostics.durationAtCeiling).toBe(true);
    sample.metrics.durationMs++;
    output = JSON.parse(createFieldCheckExport(input, at).json).checks[0].recentFailures[0];
    expect(output.diagnostics.durationMs).toBe("unavailable");
  });

  it("exports only allowlisted API categories and a valid client-reported correlation reference", () => {
    const input = fixture();
    const failure = input.checks[0]!.recentFailures[0]!;
    Object.assign(failure.metrics, {
      sourceCode: 5, outcomeCode: 1, operationCode: 6, backgroundCode: 1, httpStatusCode: 500,
      privatePath: 99,
    });
    Object.assign(failure, {
      reportedRequestCorrelationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
      requestBody: "PRIVATE",
    });
    const output = JSON.parse(createFieldCheckExport(input, at).json).checks[0].recentFailures[0];
    expect(output).toMatchObject({
      diagnostics: {
        sourceCode: 5,
        requestOutcomeCode: 1,
        operationCode: 6,
        backgroundCode: 1,
        httpStatusCode: 500,
      },
      reportedRequestCorrelationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
    });
    expect(JSON.stringify(output)).not.toContain("PRIVATE");
    failure.reportedRequestCorrelationId = "private-record-id";
    expect(JSON.parse(createFieldCheckExport(input, at).json).checks[0].recentFailures[0]
      .reportedRequestCorrelationId).toBe("unavailable");
  });

  it("keeps the maximum bounded snapshot below the byte cap and drops oversized scalar inputs", () => {
    const input = fixture();
    const check = input.checks[0]!;
    const failure = check.recentFailures[0]!;
    failure.appBuild = "PRIVATE".repeat(100_000);
    failure.observedAt = "PRIVATE".repeat(100_000);
    check.recentFailures = Array(5).fill(failure);
    input.checks = Array(18).fill(check);
    const output = createFieldCheckExport(input, at);
    expect(new TextEncoder().encode(output.json).length).toBeLessThan(FIELD_CHECK_EXPORT_MAX_BYTES);
    expect(output.json).not.toContain("PRIVATE");
    expect(JSON.parse(output.json).checks).toHaveLength(18);
  });

  it("rejects missing, unknown and oversized structures before download and leaves data intact", () => {
    for (const input of [null, {}, { scope: "PRIVATE", checks: [] },
      { scope: "current facility", checks: Array(19).fill({}) },
      { scope: "current facility", checks: [{ name: "PRIVATE", recentFailures: [] }] }]) {
      expect(() => createFieldCheckExport(input, at)).toThrow();
    }
    const input = fixture();
    input.checks[0]!.recentFailures = Array(6).fill(input.checks[0]!.recentFailures[0]);
    const before = JSON.stringify(input);
    expect(() => createFieldCheckExport(input, at)).toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });

  it("allows only the check-specific numeric diagnostic categories", () => {
    const input = fixture();
    input.checks[0]!.name = "sync-acknowledgment";
    Object.assign(input.checks[0]!.recentFailures[0]!.metrics, { failureCode: 2 });
    let details = JSON.parse(createFieldCheckExport(input, at).json).checks[0].recentFailures[0].diagnostics;
    expect(details).toMatchObject({ failureCode: 2, sourceCode: "unavailable" });
    input.checks[0]!.name = "production-run-save-sync";
    Object.assign(input.checks[0]!.recentFailures[0]!.metrics, { durationMs: 1, sourceCode: 1, failureCode: 5 });
    details = JSON.parse(createFieldCheckExport(input, at).json).checks[0].recentFailures[0].diagnostics;
    expect(details.failureCode).toBe("unavailable");
  });

  it("creates a JSON download and releases its object URL without changing observations", () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => "blob:safe");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const input = fixture();
    const before = JSON.stringify(input);
    downloadFieldCheckExport(input);
    expect(create.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:safe");
    expect(JSON.stringify(input)).toBe(before);
    vi.useRealTimers();
  });

  it("surfaces browser failures and still cleans up without changing observations", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:safe", revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked"); });
    const input = fixture();
    const before = JSON.stringify(input);
    expect(() => downloadFieldCheckExport(input)).toThrow("blocked");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledOnce();
    expect(JSON.stringify(input)).toBe(before);
    vi.useRealTimers();
  });
});
