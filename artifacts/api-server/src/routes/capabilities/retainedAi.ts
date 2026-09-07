import { Router, type IRouter } from "express";
import aiRouter from "../ai";
import aiCorrectionsRouter from "../aiCorrections";
import aiMemoryRouter from "../aiMemory";
import aiMemoryHealthRouter from "../aiMemoryHealth";

/**
 * Retained model-backed features and their correction/grounding memory.
 * Deterministic compatibility URLs exposed by aiRouter remain unchanged.
 */
const router: IRouter = Router();

router.use(aiRouter);
router.use(aiCorrectionsRouter);
router.use(aiMemoryRouter);
router.use(aiMemoryHealthRouter);

export default router;