import { authSessionsTable, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { currentActorId, currentAuthExecutionContext, type Scope } from "./requestScope";
import type { MasterDataTransaction } from "./masterDataWriteFence";

export class MasterDataOperationAuthorizationError extends Error {
  constructor() { super("Your permissions, scope or session changed. Sign in again and reopen shared history; no action was confirmed."); }
}
/** Recheck after waiting for canonical locks; hold authorization through commit. */
export async function assertMasterDataOperationActor(tx: MasterDataTransaction, scope: Scope, mutation: boolean): Promise<void> {
  const actor = currentActorId(), auth = currentAuthExecutionContext();
  if (!auth?.sessionTokenHash) throw new MasterDataOperationAuthorizationError();
  const [account] = await tx.select({ disabled: usersTable.disabled, sandbox: usersTable.sandbox,
    passwordChangedAt: usersTable.passwordChangedAt, sessionRevokedAt: usersTable.sessionRevokedAt })
    .from(usersTable).where(eq(usersTable.id, actor)).for("share");
  const [membership] = await tx.select({ role: userRolesTable.role }).from(userRolesTable)
    .where(eq(userRolesTable.userId, actor)).for("share");
  const [role] = membership ? await tx.select({ capabilities: rolesTable.capabilities }).from(rolesTable)
    .where(eq(rolesTable.name, membership.role)).for("share") : [];
  const [session] = await tx.select({ expiresAt: authSessionsTable.expiresAt, revokedAt: authSessionsTable.revokedAt })
    .from(authSessionsTable).where(and(eq(authSessionsTable.tokenHash, auth.sessionTokenHash), eq(authSessionsTable.userId, actor))).for("share");
  const cutoff = (auth.issuedAt + 1) * 1000;
  const capabilities = mutation ? ["manage-factory-settings", "manage-inventory", "manage-profiles"] : ["manage-factory-settings"];
  if (!account || account.disabled || (account.sandbox ? "sandbox" : "live") !== scope || membership?.role !== "manager"
    || !role || capabilities.some((capability) => !role.capabilities.includes(capability))
    || !session || session.revokedAt || session.expiresAt.getTime() <= Date.now()
    || (account.passwordChangedAt && cutoff <= account.passwordChangedAt.getTime())
    || (account.sessionRevokedAt && cutoff <= account.sessionRevokedAt.getTime())) {
    throw new MasterDataOperationAuthorizationError();
  }
}
