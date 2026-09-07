import { describe, expect, it } from "vitest";
import apiRouter, {
  authenticatedCapabilityFamilies,
  readAuthorizationInventory,
  validateReadAuthorizationInventory,
} from "../index";
import { collectGetRoutePathsFromRouter } from "../../lib/routeScan";
import { Router } from "express";
import { requireCapability } from "../../middlewares/requireCapability";

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

  it("classifies every protected GET in the assembled route stack", () => {
    expect(() => validateReadAuthorizationInventory(apiRouter)).not.toThrow();
    expect(readAuthorizationInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "GET",
        path: "/import-history",
        capabilities: ["manage-profiles", "manage-inventory"],
        capabilityMatch: "any",
        scope: "scoped",
      }),
      expect.objectContaining({
        method: "GET",
        path: "/roles",
        capabilities: ["manage-staff"],
        capabilityMatch: "all",
        scope: "live-only",
      }),
    ]));
  });

  it("fails registration for nested and alternate protected read variants", () => {
    const nested = Router();
    nested.get(["/unclassified-a", "/unclassified-b"], requireCapability("manage-staff"), (_req, res) => {
      res.sendStatus(200);
    });
    const assembled = Router();
    assembled.use(nested);

    expect(() => validateReadAuthorizationInventory(assembled)).toThrow(
      /protected read GET \/unclassified-a is missing/,
    );
  });
});