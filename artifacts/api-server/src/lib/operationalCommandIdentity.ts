import { canonicalSyncJson } from "@workspace/sync-contract";

type CommandIdentity = {
  actorId: string;
  deviceId: string;
  baseRevision: number;
  actionData: unknown;
};

/**
 * An idempotency key identifies one immutable operation, not an authorization
 * to retrieve another actor's receipt or to substitute a new payload.
 */
export function isExactOperationalCommandRetry(
  stored: CommandIdentity & { commandType: string },
  incoming: CommandIdentity & { commandType?: string },
): boolean {
  return stored.commandType === (incoming.commandType ?? "operational-intent")
    && stored.actorId === incoming.actorId
    && stored.deviceId === incoming.deviceId
    && stored.baseRevision === incoming.baseRevision
    && canonicalSyncJson(stored.actionData) === canonicalSyncJson(incoming.actionData);
}
