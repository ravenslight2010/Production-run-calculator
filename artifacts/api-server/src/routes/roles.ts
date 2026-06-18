import { Router, type IRouter } from "express";
import { SetStaffRoleBody } from "@workspace/api-zod";
import { getOrCreateUserRole, listUserRoles, setUserRole } from "../lib/roles";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

// Current user's identity + role. Any signed-in user may read this so the web
// and mobile clients know which controls to show/hide. Creates the row on first
// sight, which is how new staff get their default (operator) role.
router.get("/me", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const row = await getOrCreateUserRole(userId);
  res.json({
    userId: row.clerkUserId,
    role: row.role,
    email: row.email ?? null,
    name: row.name ?? null,
  });
});

// Staff roster — manager only. Lists everyone we have seen sign in, so a manager
// can promote/demote them.
router.get("/users", requireRole("manager"), async (_req, res): Promise<void> => {
  const rows = await listUserRoles();
  res.json(
    rows.map((r) => ({
      userId: r.clerkUserId,
      role: r.role,
      email: r.email ?? null,
      name: r.name ?? null,
    })),
  );
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
  res.json({
    userId: result.row.clerkUserId,
    role: result.row.role,
    email: result.row.email ?? null,
    name: result.row.name ?? null,
  });
});

export default router;
