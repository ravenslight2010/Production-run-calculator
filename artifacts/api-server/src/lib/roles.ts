import { clerkClient } from "@clerk/express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, userRolesTable, type UserRole } from "@workspace/db";

export type Role = "manager" | "operator";

export const ROLES: readonly Role[] = ["manager", "operator"] as const;

export function isRole(value: unknown): value is Role {
  return value === "manager" || value === "operator";
}

// Best-effort identity snapshot from Clerk so the staff roster can show a
// human-readable name/email without a Clerk call per render. Never throws —
// roles must keep working even if the Clerk lookup fails.
async function fetchClerkIdentity(
  userId: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.username ||
      null;
    return { email, name };
  } catch {
    return { email: null, name: null };
  }
}

async function managerCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(userRolesTable)
    .where(eq(userRolesTable.role, "manager"));
  return row?.count ?? 0;
}

// Resolve the current user's role, creating their row on first sight.
//
// Bootstrap rule: the very first signed-in user (when no manager exists yet)
// becomes the manager, so a fresh install has an admin without any out-of-band
// setup. Everyone after that defaults to operator; a manager promotes them via
// PUT /users/{id}/role. Creation is race-safe via onConflictDoNothing.
export async function getOrCreateUserRole(userId: string): Promise<UserRole> {
  const [existing] = await db
    .select()
    .from(userRolesTable)
    .where(eq(userRolesTable.clerkUserId, userId));
  if (existing) return existing;

  const role: Role = (await managerCount()) === 0 ? "manager" : "operator";
  const identity = await fetchClerkIdentity(userId);
  await db
    .insert(userRolesTable)
    .values({ clerkUserId: userId, role, email: identity.email, name: identity.name })
    .onConflictDoNothing({ target: userRolesTable.clerkUserId });

  const [row] = await db
    .select()
    .from(userRolesTable)
    .where(eq(userRolesTable.clerkUserId, userId));
  return row;
}

export async function listUserRoles(): Promise<UserRole[]> {
  return db.select().from(userRolesTable).orderBy(userRolesTable.email);
}

// Set a user's role, ensuring at least one manager always remains so the team
// can never lock itself out of the manager-only controls.
export async function setUserRole(
  targetUserId: string,
  role: Role,
): Promise<{ ok: true; row: UserRole } | { ok: false; status: number; error: string }> {
  if (role === "operator") {
    const [other] = await db
      .select({ id: userRolesTable.clerkUserId })
      .from(userRolesTable)
      .where(
        and(eq(userRolesTable.role, "manager"), ne(userRolesTable.clerkUserId, targetUserId)),
      )
      .limit(1);
    if (!other) {
      return {
        ok: false,
        status: 400,
        error: "Cannot remove the last manager — promote someone else first.",
      };
    }
  }
  // Ensure the target exists (a manager may set the role of a user we have not
  // seen issue a request yet); pull identity if we are creating the row.
  const [existing] = await db
    .select()
    .from(userRolesTable)
    .where(eq(userRolesTable.clerkUserId, targetUserId));
  if (!existing) {
    const identity = await fetchClerkIdentity(targetUserId);
    const [created] = await db
      .insert(userRolesTable)
      .values({ clerkUserId: targetUserId, role, email: identity.email, name: identity.name })
      .onConflictDoUpdate({
        target: userRolesTable.clerkUserId,
        set: { role, updatedAt: new Date() },
      })
      .returning();
    return { ok: true, row: created };
  }
  const [updated] = await db
    .update(userRolesTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(userRolesTable.clerkUserId, targetUserId))
    .returning();
  return { ok: true, row: updated };
}
