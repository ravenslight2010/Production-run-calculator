// Unit tests for the AI cost-limit wiring.
//
// The aiCostLimit middleware is mounted on the /api/ai router. Its costFn takes
// the *original* URL (which retains the /api/ai/... prefix) so the
// AI_ENDPOINT_COSTS multipliers apply to the exact endpoints they name, rather
// than the router-relative req.path. Without this, higher-cost retained requests
// would be priced at the base cost of 1.
import type { Request } from "express";
import { describe, it, expect } from "vitest";
import { aiRequestCost } from "./costLimitMiddleware";

const requestAt = (path: string, baseUrl = "") =>
  ({ path, baseUrl }) as Request;

describe("aiRequestCost — maps the mounted request path to the cost multiplier", () => {
  it("prices unlisted endpoints at the base cost of 1", () => {
    expect(aiRequestCost(requestAt("/fill-missing", "/api/ai"))).toBe(1);
    expect(aiRequestCost(requestAt("/api/runs"))).toBe(1);
  });

  it("normalizes retained base-cost AI routes", () => {
    expect(aiRequestCost(requestAt("/fill-missing", "/ai"))).toBe(1);
  });

});
