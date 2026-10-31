// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cancelledDocumentMessage, cancelledJourneyRead } from "../e2e/breakPlanningEvidence";

describe("bounded browser navigation evidence classification", () => {
  const input = {
    webkit: true,
    text: "/127.0.0.1:55395/api/factory-data due to access control checks.",
    successfulOrigins: new Set(["http://127.0.0.1:55395"]),
    navigationPaths: new Set<string>(),
    duringReload: true,
  };
  it("retains the exact cancelled API path even when API and page origins differ", () => {
    expect(cancelledDocumentMessage(input)).toBe("/api/factory-data");
    expect(cancelledDocumentMessage({ ...input, text: "Fetch API cannot load http://127.0.0.1:55395/api/incidents due to access control checks." })).toBe("/api/incidents");
    expect(cancelledDocumentMessage({ ...input, text: "Fetch API cannot load http://127.0.0.1:55395/api/incidents/actionable-count due to access control checks." })).toBe("/api/incidents/actionable-count");
    expect(cancelledDocumentMessage({ ...input, text: "/127.0.0.1:55395/api/sync/auto-track/claim?today=fixture&epoch=0 due to access control checks." })).toBe("/api/sync/auto-track/claim");
  });
  it("requires a known navigation, not merely an access-control message", () => {
    expect(cancelledDocumentMessage({ ...input, duringReload: false })).toBeUndefined();
    expect(cancelledDocumentMessage({ ...input, duringReload: false, navigationPaths: new Set(["/api/factory-data"]) })).toBe("/api/factory-data");
    expect(cancelledDocumentMessage({ ...input, duringReload: false, text: "/127.0.0.1:55395/api/sync/auto-track/claim due to access control checks." })).toBeUndefined();
  });
  it("does not hide another origin, engine, path, HTTP error or application error", () => {
    expect(cancelledDocumentMessage({ ...input, successfulOrigins: new Set(["http://127.0.0.1:1"]) })).toBeUndefined();
    expect(cancelledDocumentMessage({ ...input, webkit: false })).toBeUndefined();
    for (const text of [
      "/127.0.0.1:55395/api/sync/other due to access control checks.",
      "/127.0.0.1:55395/api/factory-data-other due to access control checks.",
      "/127.0.0.1:55395/api/incidents/actionable-count-extra due to access control checks.",
      "/127.0.0.1:55395/api/sync/auto-track/claim-extra due to access control checks.",
      "404 GET /api/factory-data",
      "Save failed",
    ]) expect(cancelledDocumentMessage({ ...input, text })).toBeUndefined();
  });
});

describe("exact navigation-cancelled reads requiring fresh recovery evidence", () => {
  const read = { method: "GET", pathname: "/api/me", code: "net::ERR_ABORTED", knownOrigin: true, duringNavigation: true };
  it("recognizes only the observed exact routes and cancellation codes", () => {
    for (const pathname of ["/api/me", "/api/qc/import-review-badges", "/api/sync/operational-intents/cursor", "/api/background-operations/diagnostics", "/api/reports/operational-view"]) {
      expect(cancelledJourneyRead({ ...read, pathname })).toBe(true);
      expect(cancelledJourneyRead({ ...read, pathname, code: "Load request cancelled" })).toBe(true);
    }
  });
  it("refuses writes, normal failures, other origins/routes and non-navigation errors", () => {
    for (const change of [{ method: "PUT" }, { method: "POST" }, { method: "DELETE" }, { knownOrigin: false }, { duringNavigation: false }, { pathname: "/api/me-extra" }, { pathname: "/api/sync/today" }, { code: "net::ERR_CONNECTION_REFUSED" }, { code: "HTTP 500" }]) {
      expect(cancelledJourneyRead({ ...read, ...change })).toBe(false);
    }
  });
});
