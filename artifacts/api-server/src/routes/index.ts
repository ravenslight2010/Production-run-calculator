import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import runsRouter from "./runs";
import profileDataHealthRouter from "./profileDataHealth";
import masterDataHealthRouter from "./masterDataHealth";
import runTemplatesRouter from "./runTemplates";
import coreSyncRunsRouter from "./capabilities/coreSyncRuns";
import masterDataImportsRouter from "./capabilities/masterDataImports";
import inventoryOperationsRouter from "./capabilities/inventoryOperations";
import administrationRouter from "./capabilities/administration";
import retainedAiRouter from "./capabilities/retainedAi";
import serverJobsRouter from "./serverJobs";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getCapabilityMatch,
  getRequiredCapabilities,
  isRequireLiveScope,
  isRequireManagerRole,
} from "../middlewares/requireCapability";
import { noStoreMiddleware } from "../lib/cacheControl";
import { startupGate } from "../lib/startupGate";
import type { Capability } from "../lib/roles";
// Domain handlers register against the generic lifecycle without making that
// lifecycle import its workloads (which would create an initialization cycle).
import "../lib/serverJobWorkloads";

const router: IRouter = Router();

/**
 * The write-side authorization contract.  Entries are deliberately route-level
 * rather than inferred from a UI family: adding a POST/PUT/PATCH/DELETE to a
 * mounted router without adding it here makes validation fail.  `auth-only`
 * records the narrow intentional floor/current-day and per-user exceptions;
 * `public` is limited to session-establishment/recovery endpoints.
 */
export type MutationAuthorization = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  ownership: "per-user" | "floor-operational" | "capability-gated" | "manager-only" | "public";
  capabilities?: readonly Capability[];
  capabilityMatch?: "all" | "any";
  managerRole?: boolean;
  scope: "scoped" | "per-user" | "live-only";
  sandbox: "allowed" | "denied";
};
export const directAuthorizationCoverageRouters = [
  {
    name: "production runs",
    router: runsRouter,
    authOnlyRoutes: ["GET /runs"],
  },
  { name: "profile data health", router: profileDataHealthRouter },
  { name: "master data health", router: masterDataHealthRouter },
  {
    name: "run templates",
    router: runTemplatesRouter,
    authOnlyRoutes: [
      "GET /run-templates",
      "POST /run-templates",
      "DELETE /run-templates",
    ],
  },
] as const;

export const mutationAuthorizationRouters = [
  // Keep the original route owners in this guard as well as their capability
  // families.  The family mounts are the production composition, while these
  // direct owners make it impossible for a newly added direct mount (or an
  // alternate handler on one of these routers) to escape classification.
  ...directAuthorizationCoverageRouters,
  { name: "health", router: healthRouter }, { name: "auth", router: authRouter },
  { name: "core-sync-runs", router: coreSyncRunsRouter },
  { name: "master-data-imports", router: masterDataImportsRouter },
  { name: "inventory-operations", router: inventoryOperationsRouter },
  { name: "administration", router: administrationRouter },
  { name: "retained-ai", router: retainedAiRouter },
  { name: "server-jobs", router: serverJobsRouter },
] as const;

export type ReadAuthorization = {
  method: "GET";
  path: string;
  capabilities: readonly Capability[];
  capabilityMatch: "all" | "any";
  scope: "scoped" | "live-only";
};

const reads = (
  capabilities: readonly Capability[],
  capabilityMatch: ReadAuthorization["capabilityMatch"],
  scope: ReadAuthorization["scope"],
  routes: readonly string[],
): ReadAuthorization[] => routes.map((path) => ({
  method: "GET",
  path,
  capabilities,
  capabilityMatch,
  scope,
}));

/**
 * The read-side authorization contract. Unlike ordinary authenticated reads,
 * these routes expose manager, diagnostic, or other capability-owned data.
 * Keeping the expected capability and scope here makes a new protected GET
 * fail the registration check until its policy is explicitly recorded.
 */
export const readAuthorizationInventory: readonly ReadAuthorization[] = [
  ...reads(["manage-staff"], "all", "scoped", [
    "/sync/conflict-stats", "/manager-action-queue",
    "/profile-data/health-check", "/profile-data/health-workspace",
    "/ai-memory/health-check",
  ]),
  ...reads(["manage-inventory"], "all", "scoped", [
    "/duplicate-reviews",
    "/inventory/count-observations/:id", "/inventory/count-observations",
    "/inventory/quality-checks",
  ]),
  ...reads(["manage-profiles", "manage-inventory"], "any", "scoped", [
    "/import-history",
  ]),
  ...reads(["manage-factory-settings"], "all", "scoped", ["/factory-data"]),
  ...reads(["review-incidents"], "all", "scoped", [
    "/incidents", "/incidents/unreviewed-count", "/incidents/actionable-count",
    "/incidents/assignees", "/incidents/:id", "/field-checks",
    "/reports/handoff", "/reports/operational-view",
    "/reports/operational/finalized", "/reports/operational/finalized/search",
    "/reports/operational/finalized/proof-key-health",
    "/reports/operational/finalized/:id", "/reports/operational/finalized/:id/export",
  ]),
  ...reads(["manage-staff"], "all", "live-only", ["/roles", "/users"]),
  ...reads(["approve-password-resets"], "all", "live-only", ["/password-reset-requests"]),
  ...reads(["manage-profiles"], "all", "scoped", [
    "/master-data/health", "/master-data/health/history",
  ]),
  ...reads(["manage-staff"], "all", "live-only", [
    "/audit-logs/profile-name-link-cleanup", "/audit-logs",
  ]),
  ...reads(["use-ai-tools"], "all", "scoped", ["/ai-memory/facility"]),
];

/**
 * The authenticated composition point. Family order is explicit, while every
 * family owns its internal route registration. Public URLs are unchanged because
 * each family router is mounted at the API root.
 */
export const authenticatedCapabilityFamilies = [
  { name: "core-sync-runs", router: coreSyncRunsRouter },
  { name: "master-data-imports", router: masterDataImportsRouter },
  { name: "inventory-operations", router: inventoryOperationsRouter },
  { name: "administration", router: administrationRouter },
  { name: "retained-ai", router: retainedAiRouter },
  { name: "server-jobs", router: serverJobsRouter },
] as const;

// Stale-data protection runs first, including public health/auth routes.
router.use(noStoreMiddleware);

// Public lifecycle order is contractual: probes, readiness gate, then auth.
router.use(healthRouter);
router.use(startupGate);
router.use(authRouter);

// All capability families are authenticated. Family-owned capability checks
// continue to run inside their existing route modules.
router.use(requireAuth);
for (const family of authenticatedCapabilityFamilies) {
  router.use(family.router);
}

export default router;

type RouteLayer = {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
  handle?: unknown;
};

const writes = (
  ownership: MutationAuthorization["ownership"],
  scope: MutationAuthorization["scope"],
  sandbox: MutationAuthorization["sandbox"],
  capability: Capability | undefined,
  routes: readonly string[],
): MutationAuthorization[] => routes.map((route) => {
  const [method, path] = route.split(" ") as [MutationAuthorization["method"], string];
  return {
    method, path, ownership, scope, sandbox,
    ...(capability ? { capabilities: [capability] as const, capabilityMatch: "all" as const } : {}),
  };
});

export const mutationAuthorizationInventory: readonly MutationAuthorization[] = [
  ...writes("public", "live-only", "denied", undefined, [
    "POST /auth/sign-up", "POST /auth/sign-in", "POST /auth/sign-out",
    "POST /auth/forgot-password", "POST /auth/reset-password",
  ]),
  ...writes("per-user", "per-user", "allowed", undefined, [
    // Password changes update only the authenticated caller's account row.
    // Sandbox access is intentional: global storage does not imply cross-user
    // authority, and the seeded sandbox user may rotate only its own password.
    "POST /auth/change-password", "POST /me/onboarding-seen", "POST /me/tour-completed",
    "POST /me/notification-prefs", "POST /me/floor-mode",
  ]),
  ...writes("per-user", "scoped", "allowed", undefined, [
    "POST /web-push/subscriptions", "DELETE /web-push/subscriptions/:id",
  ]),
  ...writes("floor-operational", "scoped", "allowed", undefined, [
    "POST /completed-history", "POST /field-checks/observations",
    "POST /inventory/restock", "POST /inventory/consume-sauce-barrel", "POST /inventory/consume",
    "POST /inventory/waste-insight", "POST /run-suggestions/observe",
    "POST /run-suggestions/follow-up", "POST /sync/operational-intents",
    "POST /sync/auto-track/claim", "PUT /sync/today", "POST /cycle-count-schedules/:id/mark-counted",
    "POST /operations-insights/spec-reconciliation", "POST /ai/spec-reconcile",
    "POST /operations-insights/mix-reconciliation", "POST /ai/mix-reconcile",
    "POST /operations-insights/recap", "POST /ai/summary",
    "POST /operations-insights/anomalies", "POST /ai/anomalies",
  ]),
  ...writes("capability-gated", "scoped", "allowed", "use-ai-tools", ["POST /run-suggestions/update"]),
  ...writes("capability-gated", "scoped", "allowed", "manage-profiles", [
    "PATCH /brand-profiles/:key/clear-slot", "POST /brand-profiles", "DELETE /brand-profiles",
    "POST /import-aliases", "POST /fill-missing-values", "POST /spec-import-aliases", "POST /spec-import-aliases/delete",
    "POST /spec-sheets", "DELETE /spec-sheets/:id", "POST /shipping-guides", "DELETE /shipping-guides/:id",
    "POST /merge-aliases", "POST /denied-merges", "DELETE /denied-merges", "POST /merged-away", "DELETE /merged-away",
    "POST /master-data/health/scan", "POST /master-data/health/repair",
  ]),
  ...writes("capability-gated", "scoped", "allowed", "manage-inventory", [
    "POST /cheese-recipes", "DELETE /cheese-recipes", "POST /cycle-count-schedules", "DELETE /cycle-count-schedules",
    "POST /die-line-defaults", "DELETE /die-line-defaults", "POST /die-types", "POST /die-types/delete",
    "POST /dough-recipes", "DELETE /dough-recipes", "POST /ingredients", "DELETE /ingredients", "POST /ingredients/merge",
    "POST /freezer-pull-items", "DELETE /freezer-pull-items", "POST /freezer-surplus", "PUT /freezer-surplus/allocations/:runId",
    "POST /ingredient-batch-weights", "POST /mixes", "DELETE /mixes", "POST /photo-aliases",
    "POST /premix-sheets", "DELETE /premix-sheets/:id", "POST /cheese-sheets", "DELETE /cheese-sheets/:id",
    "POST /sauce-recipes", "DELETE /sauce-recipes", "PATCH /inventory/items/:id/production-link",
    "POST /inventory/items", "PATCH /inventory/items/:id", "DELETE /inventory/items/:id",
    "POST /inventory/quality-checks",
    "POST /inventory/count-observations", "POST /inventory/count-observations/:id/cancel",
    "POST /inventory/count-observations/:id/apply", "POST /inventory/adjust", "POST /inventory/locations",
    "PATCH /inventory/locations/:id", "DELETE /inventory/locations/:id", "POST /inventory/transfer",
    "POST /inventory/merge", "PUT /inventory/settings",
  ]),
  ...writes("capability-gated", "scoped", "allowed", "use-ai-tools", [
    "POST /inventory/identify-photo", "POST /inventory/quality-photo", "POST /inventory/production-sheet-photo",
    "POST /inventory/label-verify",
  ]),
  ...writes("capability-gated", "scoped", "allowed", "review-incidents", [
    "POST /incidents/:id/review", "PATCH /incidents/:id/workflow", "POST /incidents/:id/resolve",
    "POST /operations-insights/incident-patterns", "POST /ai/incident-clusters",
  ]),
  ...writes("floor-operational", "scoped", "allowed", undefined, ["POST /incidents"]),
  ...writes("capability-gated", "scoped", "allowed", "edit-production-rules", [
    "POST /production-rules", "DELETE /production-rules",
  ]),
  ...writes("capability-gated", "scoped", "allowed", "manage-factory-settings", [
    "PUT /factory-data", "POST /runs", "DELETE /runs/:id", "PUT /sync/:date", "DELETE /sync/:date",
  ]),
  ...writes("manager-only", "live-only", "denied", "manage-staff", [
    "POST /roles", "PUT /roles/:name", "DELETE /roles/:name", "PUT /users/:userId/role",
    "PUT /users/:userId/password", "DELETE /users/:userId",
  ]),
  ...writes("capability-gated", "live-only", "denied", "approve-password-resets", [
    "POST /password-reset-requests/:id/approve", "POST /password-reset-requests/:id/decline",
  ]),
  ...writes("capability-gated", "scoped", "allowed", "manage-staff", [
    "PATCH /manager-action-queue/:id", "POST /sync/reset", "POST /sync/purge-all",
    "POST /profile-data/ai-retention/apply", "POST /profile-data/health-check/apply",
    "POST /profile-data/health-check/batches/:batchId/undo", "POST /ai-memory/health-check/apply",
  ]),
  {
    method: "POST", path: "/import-history", ownership: "capability-gated", scope: "scoped", sandbox: "allowed",
    capabilities: ["manage-profiles", "manage-inventory"], capabilityMatch: "any",
  },
  ...writes("capability-gated", "scoped", "allowed", "use-ai-tools", [
    "POST /ai/fill-missing", "POST /ai/match-import", "POST /ai/parse-spec-sheet", "POST /ai/parse-spec-images",
    "POST /ai/match-premix", "POST /ai/suggest-merges",
    "POST /operations-insights/schedule-order", "POST /ai/schedule-optimize",
  ]),
  // This route retains its intentional signed-in contribution policy; its
  // handler enforces per-domain write rules and capability requirements before
  // recording knowledge, while bulk reading remains use-ai-tools gated.
  ...writes("floor-operational", "scoped", "allowed", undefined, ["POST /ai-memory/facility"]),
  ...writes("manager-only", "scoped", "allowed", "manage-staff", ["POST /ai-corrections", "DELETE /ai-corrections/:id"]),
  ...writes("capability-gated", "scoped", "allowed", "review-incidents", ["POST /reports/operational"]),
  {
    method: "POST", path: "/field-checks/hardware-confirmations", ownership: "manager-only",
    scope: "scoped", sandbox: "allowed", capabilities: ["review-incidents"], capabilityMatch: "all", managerRole: true,
  },
  ...writes("floor-operational", "scoped", "allowed", undefined, ["POST /run-templates", "DELETE /run-templates", "POST /sandbox/reset"]),
  ...writes("capability-gated", "scoped", "allowed", "manage-inventory", ["POST /duplicate-reviews", "POST /duplicate-reviews/resolve"]),
  ...writes("capability-gated", "scoped", "allowed", "manage-staff", ["PUT /supervisor-pin"]),
  {
    method: "POST", path: "/server-jobs", ownership: "capability-gated", scope: "scoped", sandbox: "allowed",
    capabilities: ["manage-staff", "manage-inventory", "edit-production-rules", "approve-password-resets",
      "review-incidents", "use-ai-tools", "manage-factory-settings", "manage-profiles"], capabilityMatch: "any",
  },
  {
    method: "POST", path: "/server-jobs/:id/cancel", ownership: "capability-gated", scope: "scoped", sandbox: "allowed",
    capabilities: ["manage-staff", "manage-inventory", "edit-production-rules", "approve-password-resets",
      "review-incidents", "use-ai-tools", "manage-factory-settings", "manage-profiles"], capabilityMatch: "any",
  },
];

/**
 * Route-registration assertion used by the authorization integration suite.
 * It checks both completeness and ordering: a write cannot merely have a
 * capability middleware after its handler, and a capability-gated matrix row
 * cannot silently lose its gate.  Pass every mounted application router.
 */
export function validateMutationAuthorizationInventory(
  routers: readonly { name: string; router: { stack: unknown[] } }[],
): void {
  const byRoute = new Map<string, MutationAuthorization[]>();
  for (const entry of mutationAuthorizationInventory) {
    const key = `${entry.method} ${entry.path}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), entry]);
  }
  const validateStack = (
    stack: readonly unknown[],
    owned: { name: string; router: { stack: unknown[] } },
    requireDirectAuth: boolean,
  ): void => {
    for (const rawLayer of stack) {
      const layer = rawLayer as RouteLayer;
      if (!layer.route) {
        const nestedStack = (layer.handle as { stack?: unknown[] } | undefined)?.stack;
        if (Array.isArray(nestedStack)) validateStack(nestedStack, owned, requireDirectAuth);
        continue;
      }
      for (const [rawMethod, enabled] of Object.entries(layer.route.methods)) {
        if (!enabled) continue;
        const method = rawMethod.toUpperCase();
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        const entries = paths.flatMap((path) => byRoute.get(`${method} ${path}`) ?? []);
        if (!entries.length) {
          throw new Error(`${owned.name} write ${method} ${paths.join(", ")} is missing from mutationAuthorizationInventory`);
        }
        const required = layer.route.stack
          .map(({ handle }, index) => ({ capabilities: getRequiredCapabilities(handle), index }))
          .filter((item): item is { capabilities: readonly Capability[]; index: number } => !!item.capabilities);
        const liveScopeIndex = layer.route.stack.findIndex(({ handle }) => isRequireLiveScope(handle));
        const managerRoleIndex = layer.route.stack.findIndex(({ handle }) => isRequireManagerRole(handle));
        const matches = entries.some((entry) => {
          const expected = entry.capabilities ?? [];
          const capabilityMatches = required.length === (expected.length ? 1 : 0) &&
            (expected.length === 0 || required.some(({ capabilities, index }) =>
              index < layer.route!.stack.length - 1 &&
              capabilities.length === expected.length &&
              expected.every((capability) => capabilities.includes(capability)),
            ));
          const mustBeLiveOnly = entry.scope === "live-only" && entry.sandbox === "denied" && entry.ownership !== "public";
          const liveScopeMatches = mustBeLiveOnly
            ? liveScopeIndex >= 0 && liveScopeIndex < layer.route!.stack.length - 1
            : liveScopeIndex < 0;
          const managerMatches = Boolean(entry.managerRole) === (managerRoleIndex >= 0) &&
            (managerRoleIndex < 0 || managerRoleIndex < layer.route!.stack.length - 1);
          // Auth routes are mounted before the application-wide requireAuth.
          // Any non-public auth mutation must therefore carry its own direct
          // authentication middleware; it cannot rely on the root-router gate.
          const directAuthMatches = !requireDirectAuth || entry.ownership === "public" ||
            layer.route!.stack.some(({ handle }, index) =>
              handle === requireAuth && index < layer.route!.stack.length - 1,
            );
          return capabilityMatches && liveScopeMatches && managerMatches && directAuthMatches;
        });
        if (!matches) {
          throw new Error(`${owned.name} write ${method} ${paths.join(", ")} does not match its inventory authorization middleware`);
        }
      }
    }
  };

  for (const owned of routers) {
    validateStack(owned.router.stack, owned, owned.router === authRouter);
  }
}

/**
 * Assert that every capability- or live-scope-gated GET in the assembled
 * application router has an explicit read policy. This walks mounted routers
 * rather than source files, so nested capability families and alternate route
 * path arrays are checked as Express registered them.
 */
export function validateReadAuthorizationInventory(
  router: { stack: unknown[] },
): void {
  const byRoute = new Map<string, ReadAuthorization[]>();
  for (const entry of readAuthorizationInventory) {
    byRoute.set(entry.path, [...(byRoute.get(entry.path) ?? []), entry]);
  }

  const validateStack = (stack: readonly unknown[], owner: string): void => {
    for (const rawLayer of stack) {
      const layer = rawLayer as RouteLayer;
      if (!layer.route) {
        const nestedStack = (layer.handle as { stack?: unknown[] } | undefined)?.stack;
        if (Array.isArray(nestedStack)) validateStack(nestedStack, owner);
        continue;
      }

      const methods = layer.route.methods;
      if (!methods.get && !methods._all && !methods.all) continue;
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const capabilityMiddleware = layer.route.stack
        .map(({ handle }) => ({
          capabilities: getRequiredCapabilities(handle),
          match: getCapabilityMatch(handle),
        }))
        .filter((item): item is {
          capabilities: readonly Capability[];
          match: "all" | "any";
        } => !!item.capabilities && !!item.match);
      const liveScope = layer.route.stack.some(({ handle }) => isRequireLiveScope(handle));

      // Ordinary authenticated GETs are intentionally outside this inventory.
      if (capabilityMiddleware.length === 0 && !liveScope) continue;

      for (const path of paths) {
        const entries = byRoute.get(path) ?? [];
        if (entries.length === 0) {
          throw new Error(`${owner} protected read GET ${path} is missing from readAuthorizationInventory`);
        }
        const matches = entries.some((entry) => {
          const actual = capabilityMiddleware[0];
          const capabilityMatches = capabilityMiddleware.length === 1 && !!actual &&
            actual.match === entry.capabilityMatch &&
            actual.capabilities.length === entry.capabilities.length &&
            entry.capabilities.every((capability) => actual.capabilities.includes(capability));
          const scopeMatches = entry.scope === "live-only" ? liveScope : !liveScope;
          return capabilityMatches && scopeMatches;
        });
        if (!matches) {
          throw new Error(`${owner} protected read GET ${path} does not match its inventory authorization middleware`);
        }
      }
    }
  };

  validateStack(router.stack, "assembled API router");
}
