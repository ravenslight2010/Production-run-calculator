import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  passwordResetRequestsTable,
  usersTable,
  type PasswordResetRequest,
} from "@workspace/db";
import {
  hashResetCode,
  newResetCode,
  newUserId,
  RESET_CODE_TTL_MS,
} from "./auth";
import { findUserByUsername, updateUserPassword } from "./users";
import { invalidateUserSessions } from "./userValidity";
import { canManagePasswordResetFor, type Capability } from "./roles";

// Pending requests older than this are treated as expired: they drop off the
// manager's list automatically so stale, never-actioned asks don't pile up.
export const PENDING_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Shape returned to managers in the pending-requests list.
export type PendingResetRequest = {
  id: string;
  userId: string;
  username: string;
  requestedAt: string;
};

// Record a forgotten-password request. Returns nothing the caller can use to
// tell whether the account exists — the route always responds 200 — so the
// endpoint can't be used to enumerate usernames. When the account does exist we
// keep a single active request per user: any earlier unused request is removed
// first so a manager only ever sees the latest ask.
export async function createResetRequest(username: string): Promise<void> {
  const user = await findUserByUsername(username);
  if (!user) return;

  await db.transaction(async (tx) => {
    await tx
      .delete(passwordResetRequestsTable)
      .where(
        and(
          eq(passwordResetRequestsTable.userId, user.id),
          isNull(passwordResetRequestsTable.usedAt),
        ),
      );
    await tx.insert(passwordResetRequestsTable).values({
      id: newUserId(),
      userId: user.id,
      status: "pending",
    });
  });
}

// Staff waiting for a manager to approve a reset (newest first). Requests older
// than PENDING_REQUEST_TTL_MS are considered expired and excluded.
//
// Filtered down to requests the caller is actually allowed to act on: an
// approver only holding "approve-password-resets" (e.g. a supervisor) must
// never even see — let alone approve — a reset for someone with capabilities
// they don't hold themselves (e.g. a manager), since approving mints a code
// that fully hands over that account. See canManagePasswordResetFor.
export async function listPendingResetRequests(
  actorCapabilities: readonly Capability[],
): Promise<PendingResetRequest[]> {
  const cutoff = new Date(Date.now() - PENDING_REQUEST_TTL_MS);
  const rows = await db
    .select({
      id: passwordResetRequestsTable.id,
      userId: passwordResetRequestsTable.userId,
      username: usersTable.username,
      requestedAt: passwordResetRequestsTable.createdAt,
    })
    .from(passwordResetRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, passwordResetRequestsTable.userId))
    .where(
      and(
        eq(passwordResetRequestsTable.status, "pending"),
        gt(passwordResetRequestsTable.createdAt, cutoff),
      ),
    )
    .orderBy(sql`${passwordResetRequestsTable.createdAt} desc`);
  const allowed = await Promise.all(
    rows.map((r) => canManagePasswordResetFor(r.userId, actorCapabilities)),
  );
  return rows
    .filter((_, i) => allowed[i])
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      requestedAt: r.requestedAt.toISOString(),
    }));
}

export type ApproveResult =
  | { ok: true; username: string; code: string; expiresAt: string }
  | { ok: false; status: number; error: string };

// Approve a pending request: mint a single-use relay code, store only its hash
// plus an expiry, and return the plaintext (the sole time it is ever exposed).
export async function approveResetRequest(
  id: string,
  actorCapabilities: readonly Capability[],
): Promise<ApproveResult> {
  const [request] = await db
    .select()
    .from(passwordResetRequestsTable)
    .where(
      and(
        eq(passwordResetRequestsTable.id, id),
        eq(passwordResetRequestsTable.status, "pending"),
      ),
    );
  if (!request) {
    return { ok: false, status: 404, error: "No pending request with that id" };
  }

  const [user] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, request.userId));
  if (!user) {
    return { ok: false, status: 404, error: "No pending request with that id" };
  }

  // Approving mints a code that fully resets — and thus hands over — the
  // target account. An approver may only act on accounts whose capabilities
  // are entirely covered by their own; otherwise a narrowly-scoped approver
  // could escalate by relaying a manager (or peer) reset code to themselves.
  if (!(await canManagePasswordResetFor(request.userId, actorCapabilities))) {
    return { ok: false, status: 403, error: "Not authorized to reset this account" };
  }

  const code = newResetCode();
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
  await db
    .update(passwordResetRequestsTable)
    .set({
      status: "approved",
      codeHash: hashResetCode(code),
      codeExpiresAt: expiresAt,
      approvedAt: new Date(),
    })
    .where(eq(passwordResetRequestsTable.id, id));

  return {
    ok: true,
    username: user.username,
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

export type DeclineResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

// Decline a pending request: mark it "declined" so it drops off the manager's
// list without ever issuing a code. The update is guarded on status "pending"
// so an already-approved, used, or concurrently-declined request can't be
// declined out from under another action.
export async function declineResetRequest(
  id: string,
  actorCapabilities: readonly Capability[],
): Promise<DeclineResult> {
  const [request] = await db
    .select({ userId: passwordResetRequestsTable.userId })
    .from(passwordResetRequestsTable)
    .where(
      and(
        eq(passwordResetRequestsTable.id, id),
        eq(passwordResetRequestsTable.status, "pending"),
      ),
    );
  if (!request) {
    return { ok: false, status: 404, error: "No pending request with that id" };
  }
  // Declining reveals which accounts have a pending reset; keep it to the same
  // authorization boundary as approving so an approver can't probe/act on
  // accounts outside their own capability scope.
  if (!(await canManagePasswordResetFor(request.userId, actorCapabilities))) {
    return { ok: false, status: 403, error: "Not authorized to reset this account" };
  }

  const declined = await db
    .update(passwordResetRequestsTable)
    .set({ status: "declined" })
    .where(
      and(
        eq(passwordResetRequestsTable.id, id),
        eq(passwordResetRequestsTable.status, "pending"),
      ),
    )
    .returning({ id: passwordResetRequestsTable.id });
  if (declined.length === 0) {
    return { ok: false, status: 404, error: "No pending request with that id" };
  }
  return { ok: true };
}

export type ResetWithCodeResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

// Complete a reset: the code must belong to an approved, unused, unexpired
// request for the named user. On success the password is replaced and the
// request is marked used so the code can never be replayed. The update is
// guarded on `used_at IS NULL` so two concurrent submissions can't both win.
export async function resetPasswordWithCode(
  username: string,
  code: string,
  newPassword: string,
): Promise<ResetWithCodeResult> {
  const invalid: ResetWithCodeResult = {
    ok: false,
    status: 401,
    error: "That reset code is invalid or has expired.",
  };

  const user = await findUserByUsername(username);
  if (!user) return invalid;

  const [request] = await db
    .select()
    .from(passwordResetRequestsTable)
    .where(
      and(
        eq(passwordResetRequestsTable.userId, user.id),
        eq(passwordResetRequestsTable.status, "approved"),
        eq(passwordResetRequestsTable.codeHash, hashResetCode(code)),
        isNull(passwordResetRequestsTable.usedAt),
      ),
    );
  if (!request) return invalid;
  if (
    !request.codeExpiresAt ||
    request.codeExpiresAt.getTime() <= Date.now()
  ) {
    return invalid;
  }

  const claimed = await db
    .update(passwordResetRequestsTable)
    .set({ status: "used", usedAt: new Date() })
    .where(
      and(
        eq(passwordResetRequestsTable.id, request.id),
        isNull(passwordResetRequestsTable.usedAt),
      ),
    )
    .returning({ id: passwordResetRequestsTable.id });
  if (claimed.length === 0) return invalid;

  await updateUserPassword(user.id, newPassword);
  // Same rationale as resetUserPassword: this reset is the recovery moment
  // itself, so evict the cache immediately rather than waiting out the TTL.
  invalidateUserSessions(user.id);
  return { ok: true };
}

export type { PasswordResetRequest };
