import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runsRouter from "./runs";
import syncRouter from "./sync";
import inventoryRouter from "./inventory";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Health check stays public so platform probes work without a session.
router.use(healthRouter);

// Everything else requires a signed-in user. This gates all reads/writes,
// the live-sync SSE streams, and the paid AI photo endpoint behind auth.
router.use(requireAuth);
router.use(runsRouter);
router.use(syncRouter);
router.use(inventoryRouter);

export default router;
