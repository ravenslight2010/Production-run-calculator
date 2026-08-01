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
import ingredientBatchWeightsRouter from "./ingredientBatchWeights";
import photoAliasesRouter from "./photoAliases";
import specImportAliasesRouter from "./specImportAliases";
import savedSpecSheetsRouter from "./savedSpecSheets";
import savedShippingGuidesRouter from "./savedShippingGuides";
import savedPremixSheetsRouter from "./savedPremixSheets";
import mergeAliasesRouter from "./mergeAliases";
import deniedMergesRouter from "./deniedMerges";
import mergedAwayRouter from "./mergedAway";
import aiCorrectionsRouter from "./aiCorrections";
import aiMemoryRouter from "./aiMemory";
import productionRulesRouter from "./productionRules";
import freezerPullItemsRouter from "./freezerPullItems";
import mixesRouter from "./mixes";
import ingredientsRouter from "./ingredients";
import cheeseRecipesRouter from "./cheeseRecipes";
import doughRecipesRouter from "./doughRecipes";
import sauceRecipesRouter from "./sauceRecipes";
import brandProfilesRouter from "./brandProfiles";
import cycleCountSchedulesRouter from "./cycleCountSchedules";
import runTemplatesRouter from "./runTemplates";
import supervisorPinRouter from "./supervisorPin";
import dieTypesRouter from "./dieTypes";
import dieLineDefaultsRouter from "./dieLineDefaults";
import sandboxRouter from "./sandbox";
import auditLogsRouter from "./auditLogs";
import { requireAuth } from "../middlewares/requireAuth";
import { noStoreMiddleware } from "../lib/cacheControl";

const router: IRouter = Router();

// Stale-data protection, on by default: every GET response gets the no-store
// triplet automatically unless its route is in CACHE_CONTROL_EXCLUSIONS (the SSE
// streams, the public health probe, /auth/username-available). The sync DATA
// GETs are NOT excluded — caching them rendered a live user's schedule empty in
// production (see cacheControl.ts). Handlers no longer call noStore() themselves,
// so a new shared-list GET can't accidentally ship cacheable. Runs before
// everything so it also covers the public health/auth routes below.
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
router.use(ingredientBatchWeightsRouter);
router.use(photoAliasesRouter);
router.use(specImportAliasesRouter);
router.use(savedSpecSheetsRouter);
router.use(savedShippingGuidesRouter);
router.use(savedPremixSheetsRouter);
router.use(mergeAliasesRouter);
router.use(deniedMergesRouter);
router.use(mergedAwayRouter);
router.use(aiCorrectionsRouter);
router.use(aiMemoryRouter);
router.use(productionRulesRouter);
router.use(freezerPullItemsRouter);
router.use(mixesRouter);
router.use(ingredientsRouter);
router.use(cheeseRecipesRouter);
router.use(doughRecipesRouter);
router.use(sauceRecipesRouter);
router.use(brandProfilesRouter);
router.use(cycleCountSchedulesRouter);
router.use(runTemplatesRouter);
router.use(supervisorPinRouter);
router.use(dieTypesRouter);
router.use(dieLineDefaultsRouter);
router.use(sandboxRouter);
router.use(auditLogsRouter);

export default router;
