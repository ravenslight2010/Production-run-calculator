import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, staffInvitationsTable } from "@workspace/db";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const genericError = { status: 400, error: "Invitation is invalid or unavailable." } as const;
const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

export async function createInvitation(
  invitedBy: string,
  role: string,
  inviterCapabilities: readonly string[],
) {
  const { getRole } = await import("./roles");
  const definition = await getRole(role);
  if (!definition || !definition.capabilities.every((capability) => inviterCapabilities.includes(capability))) {
    return { ok: false as const, status: 400, error: "Invalid invitation role." };
  }
  const secret = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(staffInvitationsTable).values({
    id,
    tokenHash: digest(secret),
    invitedBy,
    role,
    expiresAt,
  });
  return { ok: true as const, id, secret, role, expiresAt: expiresAt.toISOString() };
}

export async function listInvitations() {
  return db.select({
    id: staffInvitationsTable.id,
    role: staffInvitationsTable.role,
    createdAt: staffInvitationsTable.createdAt,
    expiresAt: staffInvitationsTable.expiresAt,
    consumedAt: staffInvitationsTable.consumedAt,
    revokedAt: staffInvitationsTable.revokedAt,
  }).from(staffInvitationsTable).orderBy(staffInvitationsTable.createdAt);
}

export async function consumeInvitation(secret: string, executor: Pick<typeof db, "select" | "update"> = db) {
  const [invite] = await executor.select().from(staffInvitationsTable).where(and(
    eq(staffInvitationsTable.tokenHash, digest(secret)),
    isNull(staffInvitationsTable.consumedAt),
    isNull(staffInvitationsTable.revokedAt),
  ));
  if (!invite || invite.expiresAt.getTime() <= Date.now()) return { ok: false as const, ...genericError };
  const [claimed] = await executor.update(staffInvitationsTable).set({ consumedAt: new Date() })
    .where(and(eq(staffInvitationsTable.id, invite.id), isNull(staffInvitationsTable.consumedAt), isNull(staffInvitationsTable.revokedAt)))
    .returning();
  if (!claimed) return { ok: false as const, ...genericError };
  return { ok: true as const, role: invite.role };
}

export async function revokeInvitation(id: string): Promise<boolean> {
  const result = await db.update(staffInvitationsTable).set({ revokedAt: new Date() })
    .where(and(eq(staffInvitationsTable.id, id), isNull(staffInvitationsTable.consumedAt), isNull(staffInvitationsTable.revokedAt)))
    .returning({ id: staffInvitationsTable.id });
  return result.length > 0;
}

export const STAFF_INVITATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const STAFF_INVITATION_RETENTION_DELETE_LIMIT = 1_000;

export async function purgeRetainedInvitations(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - STAFF_INVITATION_RETENTION_MS);
  const candidates = await db.select({ id: staffInvitationsTable.id })
    .from(staffInvitationsTable)
    .where(or(
      lt(staffInvitationsTable.expiresAt, cutoff),
      and(
        isNotNull(staffInvitationsTable.consumedAt),
        lt(staffInvitationsTable.consumedAt, cutoff),
      ),
      and(
        isNotNull(staffInvitationsTable.revokedAt),
        lt(staffInvitationsTable.revokedAt, cutoff),
      ),
    ))
    .limit(STAFF_INVITATION_RETENTION_DELETE_LIMIT);
  if (candidates.length === 0) return 0;
  const deleted = await db.delete(staffInvitationsTable)
    .where(inArray(staffInvitationsTable.id, candidates.map(({ id }) => id)))
    .returning({ id: staffInvitationsTable.id });
  return deleted.length;
}