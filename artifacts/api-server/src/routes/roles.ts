import { Router, type IRouter } from "express";
import { ResetStaffPasswordBody, SetStaffRoleBody } from "@workspace/api-zod";
import { noStore } from "../lib/cacheControl";
import {
  deleteUser,
  getStaffMember,
  listStaff,
  markOnboardingSeen,
  markTourCompleted,
  resetUserPassword,
  setUserRole,
} from "../lib/roles";
import {
  approveResetRequest,
  declineResetRequest,
  listPendingResetRequests,
} from "../lib/passwordResets";
import { requireRole } from "../middlewares/requireRole";

function pathUserId(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

const router: IRouter = Router();

// Current user's identity + role. Any signed-in user may read this so the web
// and mobile clients know which controls to show/hide.
router.get("/me", async (req, res): Promise<void> => {
  const userId = req.userId!;
  noStore(res);
  res.json(await getStaffMember(userId));
});

// Mark the first-login "Get Started" overview as seen for the current user.
// Idempotent; returns the updated StaffMember so the client can refresh its
// cached identity without a second round-trip.
router.post("/me/onboarding-seen", async (req, res): Promise<void> => {
  const userId = req.userId!;
  res.json(await markOnboardingSeen(userId));
});

// Mark the guided tour as completed for the current user once they reach its
// final step. Idempotent; returns the updated StaffMember so the client can
// refresh its cached identity without a second round-trip.
router.post("/me/tour-completed", async (req, res): Promise<void> => {
  const userId = req.userId!;
  res.json(await markTourCompleted(userId));
});

// Staff roster — manager only. Lists every account so a manager can
// promote/demote them.
router.get("/users", requireRole("manager"), async (_req, res): Promise<void> => {
  noStore(res);
  res.json(await listStaff());
});

// Change a staff member's role — manager only. Refuses to remove the last
// manager so the team can't lock itself out.
router.put("/users/:userId/role", requireRole("manager"), async (req, res): Promise<void> => {
  const targetUserId = pathUserId(req.params.userId);
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

// Reset a staff member's password — manager only. Recovery path for a
// locked-out operator; no current password is required.
router.put(
  "/users/:userId/password",
  requireRole("manager"),
  async (req, res): Promise<void> => {
    const targetUserId = pathUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const parsed = ResetStaffPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const result = await resetUserPassword(targetUserId, parsed.data.newPassword);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  },
);

// Pending forgotten-password requests — manager only. These are the staff
// members waiting for a manager to approve a reset and hand them a relay code.
router.get(
  "/password-reset-requests",
  requireRole("manager"),
  async (_req, res): Promise<void> => {
    noStore(res);
    res.json(await listPendingResetRequests());
  },
);

// Approve a pending reset — manager only. Mints a short-lived single-use code
// and returns it so the manager can relay it to the locked-out staff member.
router.post(
  "/password-reset-requests/:id/approve",
  requireRole("manager"),
  async (req, res): Promise<void> => {
    const id = pathUserId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const result = await approveResetRequest(id);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      username: result.username,
      code: result.code,
      expiresAt: result.expiresAt,
    });
  },
);

// Decline a pending reset — manager only. Marks the request declined so it
// drops off the list without ever issuing a code.
router.post(
  "/password-reset-requests/:id/decline",
  requireRole("manager"),
  async (req, res): Promise<void> => {
    const id = pathUserId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const result = await declineResetRequest(id);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  },
);

// Remove a staff member — manager only. Refuses to delete the last remaining
// manager so the team can't lock itself out.
router.delete("/users/:userId", requireRole("manager"), async (req, res): Promise<void> => {
  const targetUserId = pathUserId(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const result = await deleteUser(targetUserId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(204).end();
});

export default router;
