import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import runsRouter from "./runs";
import syncRouter from "./sync";
import inventoryRouter from "./inventory";
import rolesRouter from "./roles";
import aiRouter from "./ai";
import incidentsRouter from "./incidents";
import importAliasesRouter from "./importAliases";
import fillMissingValuesRouter from "./fillMissingValues";
import photoAliasesRouter from "./photoAliases";
import specImportAliasesRouter from "./specImportAliases";
import mergeAliasesRouter from "./mergeAliases";
import deniedMergesRouter from "./deniedMerges";
import aiCorrectionsRouter from "./aiCorrections";
import aiMemoryRouter from "./aiMemory";
import productionRulesRouter from "./productionRules";
import { requireAuth } from "../middlewares/requireAuth";
import { noStoreMiddleware } from "../lib/cacheControl";

const router: IRouter = Router();

// Stale-data protection, on by default: every GET response gets the no-store
// triplet automatically unless its route is in CACHE_CONTROL_EXCLUSIONS (SSE
// streams, full-payload sync GETs, the public health probe,
// /auth/username-available). Handlers no longer call noStore() themselves, so a
// new shared-list GET can't accidentally ship cacheable. Runs before everything
// so it also covers the public health/auth routes below.
router.use(noStoreMiddleware);

// Health check stays public so platform probes work without a session.
router.use(healthRouter);

// Auth endpoints (sign-up/in/out) must be public — they are how a session is
// established in the first place.
router.use(authRouter);

// Everything else requires a signed-in user. This gates all reads/writes,
// the live-sync SSE streams, and the paid AI photo endpoint behind auth.
router.use(requireAuth);
router.use(rolesRouter);
router.use(runsRouter);
router.use(syncRouter);
router.use(inventoryRouter);
router.use(aiRouter);
router.use(incidentsRouter);
router.use(importAliasesRouter);
router.use(fillMissingValuesRouter);
router.use(photoAliasesRouter);
router.use(specImportAliasesRouter);
router.use(mergeAliasesRouter);
router.use(deniedMergesRouter);
router.use(aiCorrectionsRouter);
router.use(aiMemoryRouter);
router.use(productionRulesRouter);

export default router;
