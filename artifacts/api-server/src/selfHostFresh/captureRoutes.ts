import { Router, type Request, type Response } from "express";
import { FRESH_AUDIT_REASON, FRESH_BUILD_PROFILE } from "./contract";
function unavailable(_req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res
    .status(409)
    .json({
      status: "not-applicable",
      buildProfile: FRESH_BUILD_PROFILE,
      reason: FRESH_AUDIT_REASON,
    });
}
// Every method is rejected before production capture auth/rate-store/report/DB
// middleware can run. This router cannot issue a receipt, approval or repair.
export const publicSourceLibraryReconciliationCaptureRouter = Router();
publicSourceLibraryReconciliationCaptureRouter.all(
  "/profile-data/source-library-reconciliation/capture",
  unavailable,
);
publicSourceLibraryReconciliationCaptureRouter.all(
  "/profile-data/source-library-reconciliation/diagnostics",
  unavailable,
);
const router = Router();
router.all("/profile-data/source-library-reconciliation/capture", unavailable);
router.all(
  "/profile-data/source-library-reconciliation/diagnostics",
  unavailable,
);
export default router;
