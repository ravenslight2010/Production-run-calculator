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
import { requireAuth } from "../middlewares/requireAuth";
import { noStoreMiddleware } from "../lib/cacheControl";
import { startupGate } from "../lib/startupGate";

const router: IRouter = Router();

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