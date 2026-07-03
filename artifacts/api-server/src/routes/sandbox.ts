import { Router, type IRouter, type Request, type Response } from "express";
import { currentScope } from "../lib/requestScope";
import { resetSandbox, sandboxAllowed } from "../lib/sandbox";

const router: IRouter = Router();

// Sandbox controls. Sits behind the router-level requireAuth. The only action is
// a destructive re-copy of live → sandbox, so it is guarded three ways: it
// refuses unless the current request's data scope is "sandbox" (i.e. the caller
// is signed in as the seeded sandbox account), a live session can never trigger
// it, and it is disabled entirely in production (defense in depth alongside the
// sign-in gate, in case a sandbox session already exists when the environment
// flips to production).
router.post("/sandbox/reset", async (req: Request, res: Response) => {
  if (!sandboxAllowed()) {
    res.status(403).json({ error: "Sandbox is not available in production" });
    return;
  }
  if (currentScope() !== "sandbox") {
    res.status(403).json({ error: "Reset is only available in the sandbox account" });
    return;
  }
  try {
    await resetSandbox();
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "failed to reset sandbox");
    res.status(500).json({ error: "Failed to reset sandbox" });
  }
});

export default router;
