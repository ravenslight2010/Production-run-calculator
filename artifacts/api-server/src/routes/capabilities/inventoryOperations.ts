import { Router, type IRouter } from "express";
import inventoryRouter from "../inventory";
import incidentsRouter from "../incidents";
import fieldChecksRouter from "../fieldChecks";
import actionItemsRouter from "../actionItems";
import freezerPullItemsRouter from "../freezerPullItems";
import freezerSurplusRouter from "../freezerSurplus";
import warehouseSnapshotRouter from "../warehouseSnapshot";
import runSuggestionsRouter from "../runSuggestions";
import operationalReportsRouter from "../operationalReports";

/** Inventory movement and manager/floor operational workflows. */
const router: IRouter = Router();

router.use(inventoryRouter);
router.use(incidentsRouter);
router.use(fieldChecksRouter);
router.use(actionItemsRouter);
router.use(freezerPullItemsRouter);
router.use(freezerSurplusRouter);
router.use(warehouseSnapshotRouter);
router.use(runSuggestionsRouter);
router.use(operationalReportsRouter);

export default router;