import { describe, expect, it } from "vitest";
import apiRouter, { authenticatedCapabilityFamilies } from "../index";
import { collectGetRoutePathsFromRouter } from "../../lib/routeScan";

describe("capability route registration", () => {
  it("has one explicit top-level registration for every authenticated family", () => {
    expect(authenticatedCapabilityFamilies.map(({ name }) => name)).toEqual([
      "core-sync-runs",
      "master-data-imports",
      "inventory-operations",
      "administration",
      "retained-ai",
      "server-jobs",
    ]);
    expect(new Set(authenticatedCapabilityFamilies.map(({ router }) => router)).size).toBe(
      authenticatedCapabilityFamilies.length,
    );
  });

  it("keeps representative public URLs visible through nested family routers", () => {
    const paths = collectGetRoutePathsFromRouter(apiRouter);
    expect(paths).toEqual(expect.arrayContaining([
      "/healthz",
      "/runs",
      "/sync/today",
      "/inventory",
      "/brand-profiles",
      "/roles",
    ]));
  });
});