import { Router, type Request, type Response } from "express";
import { requireCapability } from "../middlewares/requireCapability";
import { getBackgroundOperationDiagnostics } from "../lib/backgroundOperations";

const router = Router();

router.get(
  "/background-operations/diagnostics",
  requireCapability("manage-staff"),
  async (_req: Request, res: Response): Promise<void> => {
    const diagnostics = await getBackgroundOperationDiagnostics();
    const warnings = Object.entries(diagnostics)
      .filter(([, diagnostic]) => diagnostic.status === "warning" && diagnostic.lastFailureAt)
      .map(([operation, diagnostic]) => ({
        operation,
        lastFailureAt: diagnostic.lastFailureAt!,
      }));

    res.json({
      warnings,
      windowMs: Math.max(...Object.values(diagnostics).map(({ windowMs }) => windowMs)),
    });
  },
);

export default router;