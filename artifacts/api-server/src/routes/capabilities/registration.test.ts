import { describe, expect, it } from "vitest";
import apiRouter, {
  authenticatedCapabilityFamilies,
  readAuthorizationInventory,
  validateReadAuthorizationInventory,
} from "../index";
import { collectGetRoutePathsFromRouter } from "../../lib/routeScan";
import { Router } from "express";
import { requireCapability } from "../../middlewares/requireCapability";

const intentionallyUnexposedReadRouteExemptions = [
  {
    method: "GET" as const,
    path: "/background-operations/diagnostics",
    module: "backgroundOperationDiagnostics.ts",
    reason:
      "The standalone module is not exposed in this task branch; endpoint wiring and request tests are owned by the companion restore task. Remove this exemption when mounted.",
  },
];

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
      "/qc/planning",
    ]));
  });

  it("checks mounted protected GETs and declared contracts in the assembled route stack", () => {
    expect(() => validateReadAuthorizationInventory(apiRouter, {
      exemptions: intentionallyUnexposedReadRouteExemptions,
    })).not.toThrow();
    expect(readAuthorizationInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "GET",
        path: "/health/diagnostics",
        capabilities: ["manage-staff"],
        capabilityMatch: "all",
        scope: "live-only",
      }),
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

  it("fails clearly when a declared manager GET is not effectively registered", () => {
    const diagnosticRead = readAuthorizationInventory.filter(
      ({ path }) => path === "/background-operations/diagnostics",
    );
    expect(diagnosticRead).toHaveLength(1);

    expect(() => validateReadAuthorizationInventory(Router(), {
      inventory: diagnosticRead,
    })).toThrow(
      /declared protected read GET \/background-operations\/diagnostics is not registered in the assembled API router/,
    );
  });

  it("fails when a declared protected GET is mounted without its policy middleware", () => {
    const unprotected = Router();
    unprotected.get("/background-operations/diagnostics", (_req, res) => {
      res.sendStatus(200);
    });

    expect(() => validateReadAuthorizationInventory(unprotected, {
      inventory: readAuthorizationInventory.filter(
        ({ path }) => path === "/background-operations/diagnostics",
      ),
    })).toThrow(
      /declared protected read GET \/background-operations\/diagnostics is not registered with its inventory authorization middleware/,
    );
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

  it("rejects an exemption as soon as its route is mounted", () => {
    const mounted = Router();
    mounted.get(
      "/background-operations/diagnostics",
      requireCapability("manage-staff"),
      (_req, res) => res.sendStatus(200),
    );

    expect(() => validateReadAuthorizationInventory(mounted, {
      inventory: readAuthorizationInventory.filter(
        ({ path }) => path === "/background-operations/diagnostics",
      ),
      exemptions: intentionallyUnexposedReadRouteExemptions,
    })).toThrow(/read authorization exemption .* is stale; remove it now that the route is mounted/);
  });
});
