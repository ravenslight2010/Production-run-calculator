import { Router, type IRouter } from "express";
import {
  CreateRoleBody,
  ResetStaffPasswordBody,
  SetFloorModeBody,
  SetStaffRoleBody,
  UpdateRoleBody,
} from "@workspace/api-zod";
import {
  createRole,
  deleteRole,
  deleteUser,
  getStaffMember,
  listRoles,
  listStaff,
  markOnboardingSeen,
  markTourCompleted,
  resetUserPassword,
  setFloorModeEnabled,
  setUserRole,
  updateRoleCapabilities,
  type Capability,
} from "../lib/roles";
import {
  approveResetRequest,
  declineResetRequest,
  listPendingResetRequests,
} from "../lib/passwordResets";
import { requireCapability, requireLiveScope } from "../middlewares/requireCapability";

function pathUserId(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

const router: IRouter = Router();

// Current user's identity + role. Any signed-in user may read this so the web
// and mobile clients know which controls to show/hide.
router.get("/me", async (req, res): Promise<void> => {
  const userId = req.userId!;
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

// Set the current user's Floor Mode on/off preference. Per-user (not
// device-local) so it follows them across devices; settable both directions.
router.post("/me/floor-mode", async (req, res): Promise<void> => {
  const parsed = SetFloorModeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.userId!;
  res.json(await setFloorModeEnabled(userId, parsed.data.enabled));
});

// ---------------------------------------------------------------------------
// Role administration (manage-staff capability)
// ---------------------------------------------------------------------------

// List all defined roles with their capability sets. Gated to manage-staff
// because only the staff-admin surface needs the full role catalog. Staff/role
// administration operates on genuinely global tables (no per-scope isolation
// exists for accounts/roles), so it is blocked for the sandbox account
// entirely — see requireLiveScope.
router.get(
  "/roles",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (_req, res): Promise<void> => {
    res.json(await listRoles());
  },
);

// Create a new role. Refuses to grant capabilities the actor lacks.
router.post(
  "/roles",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (req, res): Promise<void> => {
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await createRole(
    parsed.data.name,
    parsed.data.capabilities,
    (req.capabilities ?? []) as Capability[],
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json(result.row);
});

// Edit a role's capabilities. Refuses to grant capabilities the actor lacks,
// to strip manage-staff from the manager role, or to strand the last admin.
router.put("/roles/:name", requireLiveScope, requireCapability("manage-staff"), async (req, res): Promise<void> => {
  const name = pathUserId(req.params.name);
  if (!name) {
    res.status(400).json({ error: "Invalid role name" });
    return;
  }
  const parsed = UpdateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await updateRoleCapabilities(
    name,
    parsed.data.capabilities,
    (req.capabilities ?? []) as Capability[],
    parsed.data.name,
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.row);
});

// Delete a role. Refuses to delete built-in roles or roles still assigned.
router.delete(
  "/roles/:name",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (req, res): Promise<void> => {
    const name = pathUserId(req.params.name);
    if (!name) {
      res.status(400).json({ error: "Invalid role name" });
      return;
    }
    const result = await deleteRole(name);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  },
);

// Staff roster — manage-staff only. Lists every account so a manager can
// reassign roles.
router.get("/users", requireLiveScope, requireCapability("manage-staff"), async (_req, res): Promise<void> => {
  res.json(await listStaff());
});

// Change a staff member's role — manage-staff only. Refuses to remove the last
// manage-staff holder so the team can't lock itself out, and refuses to grant a
// role with capabilities the actor lacks.
router.put(
  "/users/:userId/role",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (req, res): Promise<void> => {
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
  const result = await setUserRole(
    targetUserId,
    parsed.data.role,
    (req.capabilities ?? []) as Capability[],
  );
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
  requireLiveScope,
  requireCapability("manage-staff"),
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
    const result = await resetUserPassword(
      targetUserId,
      parsed.data.newPassword,
      (req.capabilities ?? []) as Capability[],
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  },
);

// Pending forgotten-password requests — supervisor or above. These are the
// staff members waiting for approval of a reset and a relay code.
router.get(
  "/password-reset-requests",
  requireLiveScope,
  requireCapability("approve-password-resets"),
  async (req, res): Promise<void> => {
    res.json(await listPendingResetRequests((req.capabilities ?? []) as Capability[]));
  },
);

// Approve a pending reset — supervisor or above. Mints a short-lived single-use
// code and returns it so it can be relayed to the locked-out staff member.
router.post(
  "/password-reset-requests/:id/approve",
  requireLiveScope,
  requireCapability("approve-password-resets"),
  async (req, res): Promise<void> => {
    const id = pathUserId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const result = await approveResetRequest(id, (req.capabilities ?? []) as Capability[]);
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

// Decline a pending reset — supervisor or above. Marks the request declined so
// it drops off the list without ever issuing a code.
router.post(
  "/password-reset-requests/:id/decline",
  requireLiveScope,
  requireCapability("approve-password-resets"),
  async (req, res): Promise<void> => {
    const id = pathUserId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const result = await declineResetRequest(id, (req.capabilities ?? []) as Capability[]);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  },
);

// Remove a staff member — manager only. Refuses to delete the last remaining
// manager so the team can't lock itself out.
router.delete("/users/:userId", requireLiveScope, requireCapability("manage-staff"), async (req, res): Promise<void> => {
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
