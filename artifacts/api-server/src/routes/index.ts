import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runsRouter from "./runs";
import syncRouter from "./sync";
import inventoryRouter from "./inventory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runsRouter);
router.use(syncRouter);
router.use(inventoryRouter);

export default router;
