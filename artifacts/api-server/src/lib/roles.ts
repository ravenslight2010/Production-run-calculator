import { and, eq, ne, sql } from "drizzle-orm";
import { db, userRolesTable, usersTable } from "@workspace/db";
import { updateUserPassword } from "./users";
import { revokeUser } from "./userValidity";

// All staff roles. Two tracks share one free-text column (user_roles.role):
//   • Main ladder: operator < supervisor < manager.
//   • QC track:    qc-operator < qc-manager.
// QC roles sit at operator level on the MAIN ladder for now (no new powers yet);
// their dedicated rank lets a future QC-only gate admit them without touching
// the main-ladder gates.
export type Role = "operator" | "supervisor" | "manager" | "qc-operator" | "qc-manager";

// The three main-ladder levels a route can require. QC roles are never used as a
// main-ladder minimum (they rank as operators there); a future QC gate uses the
// separate qcRank below.
export type MainRole = "operator" | "supervisor" | "manager";

export const ROLES: readonly Role[] = [
  "operator",
  "supervisor",
  "manager",
  "qc-operator",
  "qc-manager",
] as const;

export function isRole(value: unknown): value is Role {
  return (ROLES as readonly string[]).includes(value as string);
}

// Main-ladder rank: operator < supervisor < manager. QC roles are pinned at
// operator level here so they get operator-level access until QC powers exist.
const MAIN_RANK: Record<Role, number> = {
  operator: 1,
  "qc-operator": 1,
  "qc-manager": 1,
  supervisor: 2,
  manager: 3,
};

export function mainRank(role: Role): number {
  return MAIN_RANK[role] ?? 0;
}

// QC-track rank: qc-operator < qc-manager. Non-QC roles are 0 (off the track),
// so a QC-track gate admits only the QC roles. Plumbing only — no route gates on
// this yet.
const QC_RANK: Record<Role, number> = {
  operator: 0,
  supervisor: 0,
  manager: 0,
  "qc-operator": 1,
  "qc-manager": 2,
};

export function qcRank(role: Role): number {
  return QC_RANK[role] ?? 0;
}

// StaffMember as exposed by the API. `name` carries the username and `email` is
// always null — the shape is kept stable so the OpenAPI contract and both
// roster UIs are unchanged from the Clerk era.
export type StaffMember = {
  userId: string;
  role: Role;
  email: string | null;
  name: string | null;
  // Whether the user has dismissed the first-login "Get Started" overview.
  onboardingSeen: boolean;
  // Whether the user has finished the guided tour (reached its final step).
  tourCompleted: boolean;
  // Whether this is the seeded sandbox account (operates in the isolated
  // "sandbox" data scope). Clients use it to show the persistent sandbox banner.
  sandbox: boolean;
};

async function managerCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(userRolesTable)
    .where(eq(userRolesTable.role, "manager"));
  return row?.count ?? 0;
}

// Resolve the current user's role, creating their row on first sight.
//
// Bootstrap rule: the very first user (when no manager exists yet) becomes the
// manager so a fresh install has an admin without any out-of-band setup. The
// role row is normally created at sign-up, but this keeps a race-safe fallback
// for any user row that predates its role row.
export async function getOrCreateUserRole(userId: string): Promise<{ role: Role }> {
  const [existing] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  if (existing) return { role: existing.role as Role };

  const role: Role = (await managerCount()) === 0 ? "manager" : "operator";
  await db
    .insert(userRolesTable)
    .values({ userId, role })
    .onConflictDoNothing({ target: userRolesTable.userId });

  const [row] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  return { role: (row?.role as Role) ?? role };
}

// Assign a role at account creation. First account (no managers yet) becomes the
// manager; everyone after defaults to operator.
export async function createRoleForNewUser(userId: string): Promise<Role> {
  const role: Role = (await managerCount()) === 0 ? "manager" : "operator";
  await db
    .insert(userRolesTable)
    .values({ userId, role })
    .onConflictDoNothing({ target: userRolesTable.userId });
  return role;
}

export async function getStaffMember(userId: string): Promise<StaffMember> {
  const { role } = await getOrCreateUserRole(userId);
  const [user] = await db
    .select({
      username: usersTable.username,
      onboardingSeen: usersTable.onboardingSeen,
      tourCompleted: usersTable.tourCompleted,
      sandbox: usersTable.sandbox,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return {
    userId,
    role,
    email: null,
    name: user?.username ?? null,
    onboardingSeen: user?.onboardingSeen ?? false,
    tourCompleted: user?.tourCompleted ?? false,
    sandbox: user?.sandbox ?? false,
  };
}

// Mark the first-login "Get Started" overview as seen for this user so it never
// auto-opens again on any of their devices. Idempotent.
export async function markOnboardingSeen(userId: string): Promise<StaffMember> {
  await db
    .update(usersTable)
    .set({ onboardingSeen: true })
    .where(eq(usersTable.id, userId));
  return getStaffMember(userId);
}

// Mark the guided tour as completed for this user once they reach its final
// step, so the app can tell a brand-new user from one who already finished the
// tour. Idempotent.
export async function markTourCompleted(userId: string): Promise<StaffMember> {
  await db
    .update(usersTable)
    .set({ tourCompleted: true })
    .where(eq(usersTable.id, userId));
  return getStaffMember(userId);
}

export async function listStaff(): Promise<StaffMember[]> {
  const rows = await db
    .select({
      userId: userRolesTable.userId,
      role: userRolesTable.role,
      username: usersTable.username,
      onboardingSeen: usersTable.onboardingSeen,
      tourCompleted: usersTable.tourCompleted,
      sandbox: usersTable.sandbox,
    })
    .from(userRolesTable)
    .innerJoin(usersTable, eq(usersTable.id, userRolesTable.userId))
    .orderBy(usersTable.username);
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role as Role,
    email: null,
    name: r.username,
    onboardingSeen: r.onboardingSeen,
    tourCompleted: r.tourCompleted,
    sandbox: r.sandbox,
  }));
}

// Set a user's role, ensuring at least one manager always remains so the team
// can never lock itself out of the manager-only controls.
export async function setUserRole(
  targetUserId: string,
  role: Role,
): Promise<{ ok: true; row: StaffMember } | { ok: false; status: number; error: string }> {
  // Demoting to ANY non-manager role (operator, supervisor, or either QC role)
  // must never strand the team without a manager.
  if (role !== "manager") {
    const [other] = await db
      .select({ id: userRolesTable.userId })
      .from(userRolesTable)
      .where(and(eq(userRolesTable.role, "manager"), ne(userRolesTable.userId, targetUserId)))
      .limit(1);
    if (!other) {
      return {
        ok: false,
        status: 400,
        error: "Cannot remove the last manager — promote someone else first.",
      };
    }
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }

  await db
    .insert(userRolesTable)
    .values({ userId: targetUserId, role })
    .onConflictDoUpdate({
      target: userRolesTable.userId,
      set: { role, updatedAt: new Date() },
    });

  return { ok: true, row: await getStaffMember(targetUserId) };
}

// Reset a staff member's password to a manager-supplied value. Unlike the
// self-service change-password flow this requires no current password — it is
// the recovery path for a locked-out operator and is gated to managers.
export async function resetUserPassword(
  targetUserId: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }
  await updateUserPassword(targetUserId, newPassword);
  return { ok: true };
}

// Remove a staff member entirely. The role row is removed via the ON DELETE
// CASCADE on user_roles. Mirrors the last-manager guard so deleting the only
// remaining manager can never lock the team out of the manager-only controls.
export async function deleteUser(
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }

  const [targetRole] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, targetUserId));
  if (targetRole?.role === "manager") {
    const [other] = await db
      .select({ id: userRolesTable.userId })
      .from(userRolesTable)
      .where(and(eq(userRolesTable.role, "manager"), ne(userRolesTable.userId, targetUserId)))
      .limit(1);
    if (!other) {
      return {
        ok: false,
        status: 400,
        error: "Cannot remove the last manager — promote someone else first.",
      };
    }
  }

  await db.delete(usersTable).where(eq(usersTable.id, targetUserId));
  // Revoke any still-valid stateless session token for this user immediately, so
  // their browser/app is cut off on its very next request rather than lingering
  // until the token's natural expiry.
  revokeUser(targetUserId);
  return { ok: true };
}
