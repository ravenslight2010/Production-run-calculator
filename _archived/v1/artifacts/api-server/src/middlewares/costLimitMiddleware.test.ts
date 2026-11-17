// Unit tests for the AI cost-limit wiring.
//
// The aiCostLimit middleware is mounted on the /api/ai router. Its costFn takes
// the *original* URL (which retains the /api/ai/... prefix) so the
// AI_ENDPOINT_COSTS multipliers apply to the exact endpoints they name, rather
// than the router-relative req.path (e.g. "/ai/forecast") which would never
// match. Without this, every AI request would be priced at the base cost of 1
// and the whole credential-protection budget would be toothless.
import type { Request } from "express";
import { describe, it, expect } from "vitest";
import { aiRequestCost, costLimitTelemetryScope } from "./costLimitMiddleware";

const requestAt = (path: string, baseUrl = "") =>
  ({ path, baseUrl }) as Request;

describe("aiRequestCost — maps the mounted request path to the cost multiplier", () => {
  it("applies the retained-photo multiplier for the inventory endpoint", () => {
    expect(aiRequestCost(requestAt("/count-observations", "/api/inventory"))).toBe(20);
  });

  it("prices unlisted endpoints at the base cost of 1", () => {
    expect(aiRequestCost(requestAt("/ask", "/api/ai"))).toBe(1);
    expect(aiRequestCost(requestAt("/fill-missing", "/api/ai"))).toBe(1);
    expect(aiRequestCost(requestAt("/forecast", "/api/ai"))).toBe(1);
    expect(aiRequestCost(requestAt("/api/runs"))).toBe(1);
  });

  it("normalizes the app's /ai mount to the public /api/ai path", () => {
    expect(aiRequestCost(requestAt("/forecast", "/ai"))).toBe(1);
    expect(aiRequestCost(requestAt("/fill-missing", "/ai"))).toBe(1);
  });

  it("normalizes directly mounted inventory routes to their public API path", () => {
    expect(aiRequestCost(requestAt("/inventory/count-observations"))).toBe(20);
  });

  it("only scopes retained inventory photo analysis for operator telemetry", () => {
    expect(costLimitTelemetryScope(requestAt("/count-observations", "/api/inventory"))).toBe(
      "inventory_photo_analysis",
    );
    expect(costLimitTelemetryScope(requestAt("/ask", "/api/ai"))).toBeUndefined();
  });
});