import { and, eq, ne, sql } from "drizzle-orm";
import { db, userRolesTable, usersTable } from "@workspace/db";
import { updateUserPassword } from "./users";

export type Role = "manager" | "operator";

export const ROLES: readonly Role[] = ["manager", "operator"] as const;

export function isRole(value: unknown): value is Role {
  return value === "manager" || value === "operator";
}

// StaffMember as exposed by the API. `name` carries the username and `email` is
// always null — the shape is kept stable so the OpenAPI contract and both
// roster UIs are unchanged from the Clerk era.
export type StaffMember = {
  userId: string;
  role: Role;
  email: string | null;
  name: string | null;
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
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return { userId, role, email: null, name: user?.username ?? null };
}

export async function listStaff(): Promise<StaffMember[]> {
  const rows = await db
    .select({
      userId: userRolesTable.userId,
      role: userRolesTable.role,
      username: usersTable.username,
    })
    .from(userRolesTable)
    .innerJoin(usersTable, eq(usersTable.id, userRolesTable.userId))
    .orderBy(usersTable.username);
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role as Role,
    email: null,
    name: r.username,
  }));
}

// Set a user's role, ensuring at least one manager always remains so the team
// can never lock itself out of the manager-only controls.
export async function setUserRole(
  targetUserId: string,
  role: Role,
): Promise<{ ok: true; row: StaffMember } | { ok: false; status: number; error: string }> {
  if (role === "operator") {
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
  return { ok: true };
}
