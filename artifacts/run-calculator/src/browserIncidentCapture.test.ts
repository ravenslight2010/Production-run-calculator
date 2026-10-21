// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const { reportIncident } = vi.hoisted(() => ({ reportIncident: vi.fn().mockResolvedValue({}) }));
vi.mock("./inventoryShared", () => ({ reportIncident }));

import {
  clearBrowserIncidentCaptureForTests,
  installBrowserFailureCapture,
  reportBrowserFailure,
} from "./browserIncidentCapture";

afterEach(() => {
  clearBrowserIncidentCaptureForTests();
  reportIncident.mockClear();
  window.history.replaceState({}, "", "/");
});

describe("browser incident capture", () => {
  it("deduplicates repeated failures and bounds distinct signals", async () => {
    await reportBrowserFailure("crash", new Error("same"));
    await reportBrowserFailure("crash", new Error("same"));
    await reportBrowserFailure("crash", new Error("two"));
    await reportBrowserFailure("crash", new Error("three"));
    await reportBrowserFailure("crash", new Error("four"));
    await reportBrowserFailure("crash", new Error("five"));
    expect(reportIncident).toHaveBeenCalledTimes(4);
  });

  it("captures rejected promises with bounded structured context", () => {
    const uninstall = installBrowserFailureCapture();
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("async failed") });
    window.dispatchEvent(event);
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      diagnostics: expect.objectContaining({
        signalKind: "rejected_promise",
        action: "complete_async_action",
      }),
    }));
    uninstall();
  });

  it("captures API failures without retaining routes or response bodies", () => {
    const uninstall = installBrowserFailureCapture();
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "sync",
        requestRoute: "sync_today_write",
        requestOutcome: "http_server_error",
        elapsedMs: 12,
        observedAt: "2026-10-16T22:48:00.000Z",
        backgroundObserved: false,
        connectivity: "online",
        httpStatus: 503,
        reasonCode: "SYNC_PAYLOAD_TOO_LARGE",
      },
    }));
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: "API 503",
      screen: "/",
      diagnostics: expect.objectContaining({
        signalKind: "sync",
        requestOutcome: "http_server_error",
      }),
    }));
    expect(JSON.stringify(reportIncident.mock.calls)).not.toContain("private");
    uninstall();
  });

  it("captures structured HTTP failures separately from transport errors and keeps server references optional", () => {
    const uninstall = installBrowserFailureCapture();
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "sync",
        requestRoute: "sync_today_write",
        requestOutcome: "http_server_error",
        elapsedMs: 4_023_360,
        observedAt: "2026-10-16T22:48:00.000Z",
        backgroundObserved: true,
        connectivity: "online",
        httpStatus: 500,
        reasonCode: "SYNC_PAYLOAD_TOO_LARGE",
        correlationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
      },
    }));
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: "API 500",
      diagnostics: expect.objectContaining({
        requestOperationCategory: "sync",
        requestRoute: "sync_today_write",
        requestOutcome: "http_server_error",
        requestReasonCode: "SYNC_PAYLOAD_TOO_LARGE",
        requestElapsedMs: 4_023_360,
        requestObservedAt: "2026-10-16T22:48:00.000Z",
        requestBackgroundInvolvement: "observed",
        requestHttpStatus: 500,
        correlationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
      }),
    }));

    reportIncident.mockClear();
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "inventory",
        requestOutcome: "transport_failure",
        elapsedMs: 52,
        observedAt: "2026-10-16T22:49:00.000Z",
        backgroundObserved: false,
        connectivity: "online",
      },
    }));
    const body = reportIncident.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      errorMessage: "API transport failure",
      diagnostics: expect.objectContaining({ requestOutcome: "transport_failure" }),
    });
    expect(body.diagnostics).not.toHaveProperty("correlationId");
    uninstall();
  });

  it("filters only classified auth lifecycle cancellations and keeps unexplained cancellations actionable", () => {
    const uninstall = installBrowserFailureCapture();
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "authentication",
        requestRoute: "authentication",
        requestOutcome: "cancelled",
        cancellationClassification: "expected_auth_lifecycle",
        elapsedMs: 46,
        observedAt: "2026-10-20T15:27:52.000Z",
        backgroundObserved: false,
        connectivity: "online",
      },
    }));
    expect(reportIncident).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "authentication",
        requestRoute: "authentication",
        requestOutcome: "cancelled",
        elapsedMs: 47,
        observedAt: "2026-10-20T15:27:53.000Z",
        backgroundObserved: false,
        connectivity: "online",
      },
    }));
    expect(reportIncident).toHaveBeenCalledOnce();
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: "API request cancelled",
      diagnostics: expect.objectContaining({ requestOutcome: "cancelled" }),
    }));
    expect(reportIncident.mock.calls[0]?.[0].diagnostics).not.toHaveProperty("correlationId");
    expect(JSON.stringify(reportIncident.mock.calls)).not.toMatch(/private|abort reason/);
    uninstall();
  });

  it("does not submit browser incidents from read-only station displays", async () => {
    window.history.replaceState({}, "", "/?screen=dashboard");
    await reportBrowserFailure("api_failure", new Error("sync unavailable"));
    expect(reportIncident).not.toHaveBeenCalled();
  });
});
