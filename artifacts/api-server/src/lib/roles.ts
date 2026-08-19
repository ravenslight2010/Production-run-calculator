import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, rolesTable, userRolesTable, usersTable } from "@workspace/db";
import { updateUserPassword } from "./users";
import { revokeUser, invalidateUserSessions } from "./userValidity";
import { getSandboxCopiedAt, isSandboxCopyStale } from "./sandbox";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------
// Access control is data-driven: a role is a NAME plus a set of capabilities.
// Routes gate on a single capability (see requireCapability middleware) and the
// clients show/hide controls by the same capability. These six are the complete
// set of gated powers in the app.
export const CAPABILITIES = [
  "manage-staff",
  "manage-inventory",
  "edit-production-rules",
  "approve-password-resets",
  "review-incidents",
  "use-ai-tools",
  "manage-factory-settings",
  "manage-profiles",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value as string);
}

// Role names are now free-text (created by managers). Kept as a string alias so
// call sites read clearly; there is no longer a fixed union.
export type Role = string;

// ---------------------------------------------------------------------------
// Seeded roles
// ---------------------------------------------------------------------------
// Two built-in roles (cannot be deleted): manager (all capabilities, the admin
// role) and operator (none, the default for new staff). The remaining five are
// editable starter roles that preserve the powers the old hardcoded roles had.
export type RoleSeed = {
  name: string;
  capabilities: Capability[];
  builtin: boolean;
};

export const ROLE_SEEDS: readonly RoleSeed[] = [
  { name: "manager", capabilities: [...CAPABILITIES], builtin: true },
  { name: "operator", capabilities: [], builtin: true },
  {
    name: "supervisor",
    capabilities: ["review-incidents", "edit-production-rules"],
    builtin: false,
  },
  { name: "qc-operator", capabilities: ["use-ai-tools"], builtin: false },
  {
    name: "qc-manager",
    capabilities: ["use-ai-tools", "review-incidents"],
    builtin: false,
  },
  { name: "warehouse", capabilities: [], builtin: false },
  { name: "inventory", capabilities: ["manage-inventory"], builtin: false },
] as const;

// Seed the roles table additively.
//
// Built-in roles (manager, operator, …) have code-defined capability sets that
// must always stay in sync with the CAPABILITIES array — e.g. when a new
// capability is shipped, the manager row must be updated or its users get 403.
// We therefore upsert built-in roles on conflict (capabilities + builtin cols).
//
// Custom roles (builtin: false) are admin-managed; their capabilities are left
// untouched on conflict so that a manager's later edits are never overwritten.
export async function seedRoles(): Promise<void> {
  // Insert custom roles (skip if already present).
  const customSeeds = ROLE_SEEDS.filter((r) => !r.builtin);
  if (customSeeds.length > 0) {
    await db
      .insert(rolesTable)
      .values(customSeeds.map((r) => ({ name: r.name, capabilities: r.capabilities, builtin: r.builtin })))
      .onConflictDoNothing({ target: rolesTable.name });
  }

  // Upsert built-in roles — always sync capabilities to the code definition.
  const builtinSeeds = ROLE_SEEDS.filter((r) => r.builtin);
  if (builtinSeeds.length > 0) {
    await db
      .insert(rolesTable)
      .values(builtinSeeds.map((r) => ({ name: r.name, capabilities: r.capabilities, builtin: r.builtin })))
      .onConflictDoUpdate({
        target: rolesTable.name,
        set: {
          capabilities: sql`excluded.capabilities`,
          builtin: sql`excluded.builtin`,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------
export type RoleDefinition = {
  name: string;
  capabilities: Capability[];
  builtin: boolean;
};

function toRoleDefinition(row: {
  name: string;
  capabilities: string[];
  builtin: boolean;
}): RoleDefinition {
  return {
    name: row.name,
    capabilities: (row.capabilities ?? []).filter(isCapability),
    builtin: row.builtin,
  };
}

export async function listRoles(): Promise<RoleDefinition[]> {
  const rows = await db
    .select({
      name: rolesTable.name,
      capabilities: rolesTable.capabilities,
      builtin: rolesTable.builtin,
    })
    .from(rolesTable)
    .orderBy(rolesTable.name);
  return rows.map(toRoleDefinition);
}

export async function getRole(name: string): Promise<RoleDefinition | undefined> {
  const [row] = await db
    .select({
      name: rolesTable.name,
      capabilities: rolesTable.capabilities,
      builtin: rolesTable.builtin,
    })
    .from(rolesTable)
    .where(eq(rolesTable.name, name));
  return row ? toRoleDefinition(row) : undefined;
}

async function roleCapabilityMap(): Promise<Map<string, Capability[]>> {
  const rows = await db
    .select({ name: rolesTable.name, capabilities: rolesTable.capabilities })
    .from(rolesTable);
  const map = new Map<string, Capability[]>();
  for (const r of rows) {
    map.set(r.name, (r.capabilities ?? []).filter(isCapability));
  }
  return map;
}

// Every user's (userId, role) assignment.
async function listAssignments(): Promise<{ userId: string; role: string }[]> {
  return db
    .select({ userId: userRolesTable.userId, role: userRolesTable.role })
    .from(userRolesTable);
}

// Resolve a user's capabilities by looking up their role's capability set.
export async function getUserCapabilities(userId: string): Promise<Capability[]> {
  const { role } = await getOrCreateUserRole(userId);
  const def = await getRole(role);
  return def?.capabilities ?? [];
}

// User ids that currently hold a given capability (via their assigned role).
async function userIdsWithCapability(cap: Capability): Promise<string[]> {
  const [assignments, capsByRole] = await Promise.all([
    listAssignments(),
    roleCapabilityMap(),
  ]);
  return assignments
    .filter((a) => (capsByRole.get(a.role) ?? []).includes(cap))
    .map((a) => a.userId);
}

// ---------------------------------------------------------------------------
// Staff identity
// ---------------------------------------------------------------------------
// StaffMember as exposed by the API. `name` carries the username and `email` is
// always null — the shape is kept stable so the OpenAPI contract and both
// roster UIs are unchanged from the Clerk era. `capabilities` is resolved from
// the user's role so clients can gate UI without re-deriving from role names.
export type StaffMember = {
  userId: string;
  role: Role;
  capabilities: Capability[];
  email: string | null;
  name: string | null;
  onboardingSeen: boolean;
  tourCompleted: boolean;
  // Whether Floor Mode (the idle big-numbers monitor) is enabled for this
  // user. Per-user (not device-local) so the preference follows them across
  // devices. Defaults on.
  floorModeEnabled: boolean;
  // Per-alert push-notification preferences: alert kind → enabled. A MISSING
  // key means that alert is ON (default), so newly added alert kinds are
  // automatically enabled. Per-user so the choices follow them across devices.
  notificationPrefs: Record<string, boolean>;
  sandbox: boolean;
  // ISO timestamp of when the sandbox was last re-copied from live, or null when
  // it has never been copied. Only meaningful for the sandbox account; null for
  // everyone else. Clients show it as "Sandbox copied from live at …".
  sandboxCopiedAt: string | null;
  // Whether the sandbox copy is stale and due for an automatic refresh. The
  // client drives the re-copy (reusing the manual reset flow); the server owns
  // the staleness cutoff so web and mobile stay in lockstep. Always false for
  // non-sandbox accounts.
  sandboxStale: boolean;
};

// Whether any NON-SANDBOX user currently holds manage-staff. Used for the
// bootstrap rule (first real user becomes manager) and last-admin guards.
// The sandbox account is always a manager but must never count as the
// "already have an admin" signal — otherwise the first real user can never
// become manager on a fresh database.
async function manageStaffHolders(): Promise<string[]> {
  const all = await userIdsWithCapability("manage-staff");
  if (all.length === 0) return [];
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.sandbox, false));
  const nonSandboxIds = new Set(rows.map((r) => r.id));
  return all.filter((id) => nonSandboxIds.has(id));
}

// Arbitrary fixed key for a Postgres transaction-scoped advisory lock guarding
// the manager-bootstrap decision (see resolveBootstrapRole below). Any two
// distinct 32-bit ints work as a pg_advisory_xact_lock(a, b) pair; the values
// carry no meaning beyond being a stable, collision-free constant.
const BOOTSTRAP_LOCK_KEY: [number, number] = [0x5354_4646, 0x424f_4f54]; // "STFF" "BOOT"

// Whether this newly-created account is the designated first administrator.
// STAFF_SIGNUP_CODE is a shared onboarding secret handed to every ordinary new
// hire, so it must never be the thing that decides who becomes manager —
// anyone who knows (or leaks, or reuses from a former job) that one code could
// otherwise race to sign up first and seize full admin control on a fresh
// deployment. Bootstrap requires TWO separate, narrower facts that only the
// real administrator should have, both configured out of band by the operator
// (e.g. as Replit secrets):
//   - INITIAL_MANAGER_USERNAME: the exact username the administrator will
//     register with.
//   - INITIAL_MANAGER_ACCESS_CODE: a distinct secret code, checked
//     timing-safely against the access code supplied at sign-up.
// A username alone is guessable/predictable (e.g. "admin"), so requiring it in
// isolation would let anyone holding the shared STAFF_SIGNUP_CODE simply
// register that guessed username and still seize manager. Requiring a SEPARATE
// unguessable code closes that gap: knowing the ordinary staff code is never
// sufficient on its own. If either value is unset or doesn't match, bootstrap
// can never grant manager and the operator must promote someone by hand (e.g.
// via the database), which fails closed instead of leaving any exploitable
// path.
function isDesignatedInitialManager(username: string, suppliedAccessCode: string): boolean {
  const expectedUsername = process.env.INITIAL_MANAGER_USERNAME;
  const expectedCode = process.env.INITIAL_MANAGER_ACCESS_CODE;
  if (!expectedUsername || !expectedUsername.trim()) return false;
  if (!expectedCode || !expectedCode.trim()) return false;
  if (username.trim().toLowerCase() !== expectedUsername.trim().toLowerCase()) return false;

  const supplied = Buffer.from(suppliedAccessCode);
  const expected = Buffer.from(expectedCode);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

// Decide + assign a user's role inside one Postgres-transaction-scoped
// advisory lock, so the "is anyone already a manager?" read and the role
// INSERT are atomic across concurrent requests. Without this lock, two
// sign-ups racing on a fresh database can both read zero manage-staff holders
// and both be granted "manager" — a takeover race an attacker can trigger
// deliberately by firing concurrent sign-ups at a brand-new deployment.
// pg_advisory_xact_lock blocks other callers until this transaction commits
// (releasing the lock), so the read here always sees any prior winner's
// committed insert before deciding. Beyond the race guard, the role granted is
// also gated on isDesignatedInitialManager — see its comment for why the
// staff sign-up code alone must never be sufficient to become manager.
async function resolveBootstrapRole(
  userId: string,
  username: string,
  suppliedAccessCode: string,
): Promise<Role> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY[0]}, ${BOOTSTRAP_LOCK_KEY[1]})`,
    );
    const role: Role =
      (await manageStaffHolders()).length === 0 &&
      isDesignatedInitialManager(username, suppliedAccessCode)
        ? "manager"
        : "operator";
    await tx
      .insert(userRolesTable)
      .values({ userId, role })
      .onConflictDoNothing({ target: userRolesTable.userId });
    return role;
  });
}

// Resolve the current user's role, creating their row on first sight.
//
// Bootstrap rule: only the operator-designated INITIAL_MANAGER_USERNAME +
// INITIAL_MANAGER_ACCESS_CODE pair (see isDesignatedInitialManager) can become
// manager on a database with no existing admin; everyone else defaults to
// operator. The role row is normally created at sign-up (where the supplied
// access code is available); this is a race-safe fallback for any user row
// that predates its role row, and can never grant the bootstrap manager role
// itself since there is no access code to check here — it can only ever
// resolve to "operator" once the database already has no path to bootstrap
// (a prior sign-up already decided that, or none did and this path fails
// closed too).
export async function getOrCreateUserRole(userId: string): Promise<{ role: Role }> {
  const [existing] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  if (existing) return { role: existing.role };

  const [user] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const role = await resolveBootstrapRole(userId, user?.username ?? "", "");

  const [row] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  return { role: row?.role ?? role };
}

// Assign a role at account creation. Only the operator-designated
// INITIAL_MANAGER_USERNAME + INITIAL_MANAGER_ACCESS_CODE pair can become the
// bootstrap manager; everyone else defaults to operator. `suppliedAccessCode`
// is the sign-up request's access code (the same field checked against the
// shared STAFF_SIGNUP_CODE) — passing it through lets bootstrap require a
// SEPARATE secret from the ordinary staff code without adding a new sign-up
// field. See resolveBootstrapRole for the race-safety guarantee and
// isDesignatedInitialManager for why the shared staff sign-up code alone can
// never grant this.
export async function createRoleForNewUser(
  userId: string,
  username: string,
  suppliedAccessCode: string,
): Promise<Role> {
  return resolveBootstrapRole(userId, username, suppliedAccessCode);
}

export async function getStaffMember(userId: string): Promise<StaffMember> {
  const { role } = await getOrCreateUserRole(userId);
  const def = await getRole(role);
  const [user] = await db
    .select({
      username: usersTable.username,
      onboardingSeen: usersTable.onboardingSeen,
      tourCompleted: usersTable.tourCompleted,
      floorModeEnabled: usersTable.floorModeEnabled,
      notificationPrefs: usersTable.notificationPrefs,
      sandbox: usersTable.sandbox,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  // The copy timestamp / staleness only matter for the sandbox account, so skip
  // the extra read for everyone else.
  const copiedAt = user?.sandbox ? await getSandboxCopiedAt() : null;
  return {
    userId,
    role,
    capabilities: def?.capabilities ?? [],
    email: null,
    name: user?.username ?? null,
    onboardingSeen: user?.onboardingSeen ?? false,
    tourCompleted: user?.tourCompleted ?? false,
    floorModeEnabled: user?.floorModeEnabled ?? true,
    notificationPrefs: user?.notificationPrefs ?? {},
    sandbox: user?.sandbox ?? false,
    sandboxCopiedAt: copiedAt ? copiedAt.toISOString() : null,
    sandboxStale: user?.sandbox ? isSandboxCopyStale(copiedAt) : false,
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

// Store the user's Floor Mode (idle big-numbers monitor) on/off preference so
// it follows them across devices. Settable in both directions, unlike the
// one-way onboarding/tour flags.
export async function setFloorModeEnabled(
  userId: string,
  enabled: boolean,
): Promise<StaffMember> {
  await db
    .update(usersTable)
    .set({ floorModeEnabled: enabled })
    .where(eq(usersTable.id, userId));
  return getStaffMember(userId);
}

// The alert kinds users may toggle. Must stay in lockstep with the web
// client's NOTIFICATION_KINDS (src/notificationPrefs.ts). Unknown keys in a
// request are silently dropped so the column can never accumulate junk.
export const NOTIFICATION_PREF_KEYS = [
  "fifteenMin",
  "batchDue",
  "warehouseStaging",
  "runComplete",
  "freezerEmpty",
  "slowPace",
] as const;

// Merge the supplied alert toggles into the user's stored preferences.
// Merge (not replace) so a single-switch update from one device never
// clobbers toggles set elsewhere; only known alert kinds are kept. Keys that
// return to the default (enabled) are stored anyway — an explicit true is
// harmless and keeps the merge logic trivial.
export async function setNotificationPrefs(
  userId: string,
  prefs: Record<string, boolean>,
): Promise<StaffMember> {
  const allowed = new Set<string>(NOTIFICATION_PREF_KEYS);
  const sanitized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (allowed.has(key) && typeof value === "boolean") sanitized[key] = value;
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ notificationPrefs: usersTable.notificationPrefs })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    const merged = { ...(row?.notificationPrefs ?? {}), ...sanitized };
    await tx
      .update(usersTable)
      .set({ notificationPrefs: merged })
      .where(eq(usersTable.id, userId));
  });
  return getStaffMember(userId);
}

export async function listStaff(): Promise<StaffMember[]> {
  const [rows, capsByRole] = await Promise.all([
    db
      .select({
        userId: userRolesTable.userId,
        role: userRolesTable.role,
        username: usersTable.username,
        onboardingSeen: usersTable.onboardingSeen,
        tourCompleted: usersTable.tourCompleted,
        floorModeEnabled: usersTable.floorModeEnabled,
        notificationPrefs: usersTable.notificationPrefs,
        sandbox: usersTable.sandbox,
      })
      .from(userRolesTable)
      .innerJoin(usersTable, eq(usersTable.id, userRolesTable.userId))
      .orderBy(usersTable.username),
    roleCapabilityMap(),
  ]);
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    capabilities: capsByRole.get(r.role) ?? [],
    email: null,
    name: r.username,
    onboardingSeen: r.onboardingSeen,
    tourCompleted: r.tourCompleted,
    floorModeEnabled: r.floorModeEnabled,
    notificationPrefs: r.notificationPrefs ?? {},
    sandbox: r.sandbox,
    // The copy timestamp / staleness are only surfaced via the sandbox account's
    // own /me; the roster never needs them, so leave them at their inert values.
    sandboxCopiedAt: null,
    sandboxStale: false,
  }));
}

// ---------------------------------------------------------------------------
// Assigning roles to users
// ---------------------------------------------------------------------------
// Set a user's role. Guards:
//  • the role must exist;
//  • the actor cannot grant a role whose capabilities exceed their own
//    (no privilege escalation);
//  • the change must never strand the team without a manage-staff holder.
export async function setUserRole(
  targetUserId: string,
  role: Role,
  actorCapabilities: Capability[],
): Promise<{ ok: true; row: StaffMember } | { ok: false; status: number; error: string }> {
  const def = await getRole(role);
  if (!def) {
    return { ok: false, status: 400, error: "Unknown role" };
  }

  const missing = def.capabilities.filter((c) => !actorCapabilities.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 403,
      error: `You can't assign a role with capabilities you don't have: ${missing.join(", ")}`,
    };
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }

  // Last-admin guard: if this change would leave nobody with manage-staff,
  // refuse. Compute the holder set after the hypothetical change.
  if (!def.capabilities.includes("manage-staff")) {
    const holders = await manageStaffHolders();
    const remaining = holders.filter((id) => id !== targetUserId);
    if (remaining.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Cannot remove the last staff manager — assign someone else first.",
      };
    }
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
  actorCapabilities: readonly Capability[],
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }
  // A reset is equivalent to taking over the target's account, so it must
  // never let an actor reach past their own privilege — mirrors the
  // "can't grant a capability you don't have" rule for role assignment and
  // the approved-reset-request boundary (canManagePasswordResetFor).
  const allowed = await canManagePasswordResetFor(targetUserId, actorCapabilities);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: "Cannot reset a password for a higher-privileged account",
    };
  }
  await updateUserPassword(targetUserId, newPassword);
  // A password reset is exactly the moment we must assume the old password
  // (and any token minted under it) may be compromised — that's the whole
  // point of a recovery reset. Evict the cache immediately so a session the
  // locked-out user (or whoever locked them out) already holds stops working
  // on its very next request instead of riding out the cache TTL.
  invalidateUserSessions(targetUserId);
  return { ok: true };
}

// A password-reset approver only needs the narrow "approve-password-resets"
// capability, but resetting a user's password is equivalent to fully taking
// over their account — every capability that user holds. Without this check,
// a low-privileged approver could relay a reset code for a manager (or any
// higher-privileged peer) and hand full admin control to whoever redeems it.
// Mirrors the existing "can't grant a capability you don't have" rule for role
// assignment (see setUserRole) — you can never elevate someone (including via
// a password reset) past your own privilege.
export async function canManagePasswordResetFor(
  targetUserId: string,
  actorCapabilities: readonly Capability[],
): Promise<boolean> {
  const targetCapabilities = await getUserCapabilities(targetUserId);
  const actorSet = new Set(actorCapabilities);
  return targetCapabilities.every((cap) => actorSet.has(cap));
}

// Remove a staff member entirely. The role row is removed via the ON DELETE
// CASCADE on user_roles. Mirrors the last-admin guard so deleting the only
// remaining manage-staff holder can never lock the team out.
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

  const holders = await manageStaffHolders();
  if (holders.includes(targetUserId)) {
    const remaining = holders.filter((id) => id !== targetUserId);
    if (remaining.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Cannot remove the last staff manager — assign someone else first.",
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

// ---------------------------------------------------------------------------
// Role administration (create / edit / delete roles)
// ---------------------------------------------------------------------------
function sanitizeCapabilities(input: unknown): Capability[] {
  if (!Array.isArray(input)) return [];
  const out: Capability[] = [];
  for (const c of input) {
    if (isCapability(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

// Create a new role. Guards: name must be non-empty and unique; the actor
// cannot grant capabilities they don't have themselves.
export async function createRole(
  name: string,
  capabilities: unknown,
  actorCapabilities: Capability[],
): Promise<{ ok: true; row: RoleDefinition } | { ok: false; status: number; error: string }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, status: 400, error: "Role name is required" };
  }
  const caps = sanitizeCapabilities(capabilities);
  const missing = caps.filter((c) => !actorCapabilities.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 403,
      error: `You can't grant capabilities you don't have: ${missing.join(", ")}`,
    };
  }
  const existing = await getRole(trimmed);
  if (existing) {
    return { ok: false, status: 409, error: "A role with that name already exists" };
  }
  await db
    .insert(rolesTable)
    .values({ name: trimmed, capabilities: caps, builtin: false })
    .onConflictDoNothing({ target: rolesTable.name });
  const def = await getRole(trimmed);
  return { ok: true, row: def! };
}

// Edit a role's capabilities and, optionally, rename it. Guards: role must
// exist; the actor cannot grant capabilities they lack; the manager role must
// keep manage-staff; the change must never strand the team without a
// manage-staff holder. Rename guards: built-in roles can't be renamed, the new
// name must be non-empty and not collide with another role. Because user_roles
// stores the role NAME (free text, no FK), a rename rewrites both the roles row
// and every staff assignment in one transaction so no one is left pointing at a
// name that no longer exists.
export async function updateRoleCapabilities(
  name: string,
  capabilities: unknown,
  actorCapabilities: Capability[],
  newName?: string,
): Promise<{ ok: true; row: RoleDefinition } | { ok: false; status: number; error: string }> {
  const def = await getRole(name);
  if (!def) {
    return { ok: false, status: 404, error: "Role not found" };
  }
  const caps = sanitizeCapabilities(capabilities);
  const missing = caps.filter((c) => !actorCapabilities.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 403,
      error: `You can't grant capabilities you don't have: ${missing.join(", ")}`,
    };
  }

  // The built-in manager role must always retain manage-staff so the admin
  // surface can never be locked away.
  if (name === "manager" && !caps.includes("manage-staff")) {
    return {
      ok: false,
      status: 400,
      error: "The manager role must keep the Manage staff & roles capability.",
    };
  }

  // Last-admin guard: if removing manage-staff from this role would leave the
  // team with no manage-staff holder, refuse.
  if (def.capabilities.includes("manage-staff") && !caps.includes("manage-staff")) {
    const [assignments, holders] = await Promise.all([
      listAssignments(),
      manageStaffHolders(),
    ]);
    const usersOnThisRole = new Set(
      assignments.filter((a) => a.role === name).map((a) => a.userId),
    );
    const remaining = holders.filter((id) => !usersOnThisRole.has(id));
    if (remaining.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Cannot remove the last staff manager — keep manage-staff on a role someone holds.",
      };
    }
  }

  // Resolve an optional rename. Only act when a new name is supplied that
  // actually differs from the current one.
  const trimmedNew = newName?.trim();
  const isRename = trimmedNew !== undefined && trimmedNew !== "" && trimmedNew !== name;
  if (newName !== undefined && (trimmedNew ?? "") === "") {
    return { ok: false, status: 400, error: "Role name is required" };
  }
  if (isRename) {
    if (def.builtin) {
      return { ok: false, status: 400, error: "Built-in roles can't be renamed." };
    }
    const clash = await getRole(trimmedNew!);
    if (clash) {
      return { ok: false, status: 409, error: "A role with that name already exists" };
    }
  }

  if (isRename) {
    // Rewrite the role row and every staff assignment together so a partial
    // failure can't strand users on the old name.
    await db.transaction(async (tx) => {
      await tx
        .update(rolesTable)
        .set({ name: trimmedNew!, capabilities: caps, updatedAt: new Date() })
        .where(eq(rolesTable.name, name));
      await tx
        .update(userRolesTable)
        .set({ role: trimmedNew!, updatedAt: new Date() })
        .where(eq(userRolesTable.role, name));
    });
    const updated = await getRole(trimmedNew!);
    return { ok: true, row: updated! };
  }

  await db
    .update(rolesTable)
    .set({ capabilities: caps, updatedAt: new Date() })
    .where(eq(rolesTable.name, name));
  const updated = await getRole(name);
  return { ok: true, row: updated! };
}

// Delete a role. Guards: built-in roles can't be deleted; a role currently
// assigned to any user can't be deleted.
export async function deleteRole(
  name: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const def = await getRole(name);
  if (!def) {
    return { ok: false, status: 404, error: "Role not found" };
  }
  if (def.builtin) {
    return { ok: false, status: 400, error: "Built-in roles can't be deleted." };
  }
  const [assigned] = await db
    .select({ id: userRolesTable.userId })
    .from(userRolesTable)
    .where(eq(userRolesTable.role, name))
    .limit(1);
  if (assigned) {
    return {
      ok: false,
      status: 400,
      error: "This role is assigned to staff — reassign them before deleting it.",
    };
  }
  await db.delete(rolesTable).where(eq(rolesTable.name, name));
  return { ok: true };
}

