import { Router, type IRouter } from "express";
import { SetStaffRoleBody } from "@workspace/api-zod";
import { getStaffMember, listStaff, setUserRole } from "../lib/roles";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

// Current user's identity + role. Any signed-in user may read this so the web
// and mobile clients know which controls to show/hide.
router.get("/me", async (req, res): Promise<void> => {
  const userId = req.userId!;
  res.json(await getStaffMember(userId));
});

// Staff roster — manager only. Lists every account so a manager can
// promote/demote them.
router.get("/users", requireRole("manager"), async (_req, res): Promise<void> => {
  res.json(await listStaff());
});

// Change a staff member's role — manager only. Refuses to remove the last
// manager so the team can't lock itself out.
router.put("/users/:userId/role", requireRole("manager"), async (req, res): Promise<void> => {
  const targetUserId = Array.isArray(req.params.userId)
    ? req.params.userId[0]
    : req.params.userId;
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = SetStaffRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await setUserRole(targetUserId, parsed.data.role);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.row);
});

export default router;
