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
      detail: { path: "/api/private?id=secret", status: 503 },
    }));
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: "API 503",
      diagnostics: expect.objectContaining({ signalKind: "api_failure" }),
    }));
    expect(JSON.stringify(reportIncident.mock.calls)).not.toContain("private");
    uninstall();
  });
});