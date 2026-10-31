import { fetchWithTimeout } from "./fetchWithTimeout";
import { getProfileCacheGeneration } from "./profileCache";
import type { MasterDataCommand, MasterDataOperationReceipt } from "@workspace/api-client-react";

export type SharedMasterDataCategory = MasterDataCommand["category"];
export type SharedMasterDataCommand = MasterDataCommand;
export type SharedMasterDataOperation = MasterDataOperationReceipt;
type PreparedOperation = {
  id: string; generation: number; command: SharedMasterDataCommand; expectedStateHash?: string;
  description?: string; eligible?: boolean; unavailableReason?: string | null;
};
const pending = new Map<string, PreparedOperation>();
let pendingGeneration = -1;
export class SharedMasterDataError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new SharedMasterDataError("Shared history and Undo require an online server confirmation. Reconnect and retry; nothing has been confirmed.");
  }
  const generation = getProfileCacheGeneration();
  let response: Response;
  try {
    response = await fetchWithTimeout(`/api/master-data-operations${path}`, {
      cache: "no-store",
      ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }, 30_000);
  } catch {
    throw new SharedMasterDataError("The server did not confirm the result. Reconnect and retry the same action; do not assume it succeeded.");
  }
  if (generation !== getProfileCacheGeneration()) throw new SharedMasterDataError("The signed-in identity changed. Reopen shared history in the current account.");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new SharedMasterDataError("The server confirmation could not be read. Retry the same action.", response.status); }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error.slice(0, 1200) : "Shared history is unavailable. Refresh and retry.";
    throw new SharedMasterDataError(message, response.status);
  }
  return payload as T;
}
function checkOperation(value: SharedMasterDataOperation): SharedMasterDataOperation {
  if (!value || typeof value.id !== "string" || !Number.isSafeInteger(value.sequence)
    || typeof value.description !== "string" || !["applied", "conflicting", "unavailable", "undone"].includes(value.status)
    || typeof value.eligible !== "boolean" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new SharedMasterDataError("The server returned an incomplete operation receipt. Retry the same action.");
  }
  return value;
}
export async function prepareSharedMasterDataChange(command: SharedMasterDataCommand): Promise<PreparedOperation> {
  const generation = getProfileCacheGeneration();
  if (generation !== pendingGeneration) { pending.clear(); pendingGeneration = generation; }
  const key = JSON.stringify(command);
  let operation = pending.get(key);
  if (!operation) {
    operation = { id: crypto.randomUUID(), generation, command };
    // Bounded metadata only, never row facts or before-snapshots.
    if (pending.size >= 50) throw new SharedMasterDataError("Too many unresolved actions in this session. Review shared history before starting another change.");
    pending.set(key, operation);
  }
  if (!operation.expectedStateHash) {
    const preview = await request<{ expectedStateHash: string; description: string; eligible: boolean; unavailableReason: string | null }>(
      `/${encodeURIComponent(operation.id)}/preview`, command);
    if (!/^[a-f0-9]{64}$/u.test(preview.expectedStateHash) || typeof preview.eligible !== "boolean") {
      throw new SharedMasterDataError("A complete canonical preview is required before this change.");
    }
    if (generation !== getProfileCacheGeneration()) throw new SharedMasterDataError("The signed-in identity changed.");
    Object.assign(operation, preview);
  }
  return operation;
}
export async function commitSharedMasterDataChange(operation: PreparedOperation): Promise<SharedMasterDataOperation> {
  if (operation.generation !== getProfileCacheGeneration()) throw new SharedMasterDataError("The signed-in identity changed. Reopen the action in the current account.");
  let result: SharedMasterDataOperation;
  try {
    result = checkOperation(await request<SharedMasterDataOperation>(`/${encodeURIComponent(operation.id)}/apply`, {
      command: operation.command, expectedStateHash: operation.expectedStateHash,
    }));
  } catch (error) {
    // A canonical conflict explicitly confirms no mutation. Keep the stable
    // ID, but require a fresh preview and confirmation on the next user action.
    if (error instanceof SharedMasterDataError && error.status === 409) delete operation.expectedStateHash;
    throw error;
  }
  pending.delete(JSON.stringify(operation.command));
  return result;
}
export async function fetchSharedMasterDataHistory(before?: number): Promise<{ items: SharedMasterDataOperation[]; nextCursor: number | null }> {
  const page = await request<{ items: SharedMasterDataOperation[]; nextCursor: number | null }>(`?limit=20${before === undefined ? "" : `&before=${before}`}`);
  if (!Array.isArray(page.items) || page.items.length > 20
    || (page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor < 1))) {
    throw new SharedMasterDataError("The shared history page is incomplete. Retry online.");
  }
  return { items: page.items.map(checkOperation), nextCursor: page.nextCursor };
}
export async function undoSharedMasterDataChange(id: string): Promise<SharedMasterDataOperation> {
  const result = checkOperation(await request<SharedMasterDataOperation>(`/${encodeURIComponent(id)}/undo`, {}));
  if (result.status !== "undone") throw new SharedMasterDataError("The server did not confirm Undo. Refresh shared history.");
  return result;
}
