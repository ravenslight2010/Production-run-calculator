import { Router, type IRouter } from "express";
import runsRouter from "../runs";
import syncRouter from "../sync";
import completedHistoryRouter from "../completedHistory";

/**
 * Live production state and run lifecycle.
 *
 * Keep these routes together: they share the day-state/run consistency boundary,
 * but remain one in-process service and retain their existing public paths.
 */
const router: IRouter = Router();

router.use(runsRouter);
router.use(syncRouter);
router.use(completedHistoryRouter);

export default router;