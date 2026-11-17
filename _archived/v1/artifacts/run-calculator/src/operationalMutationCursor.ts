import { captureOperationalIdentityFence, readOperationalIntentOutbox } from "./operationalIntentOutbox";
import { getStoredResetEpoch } from "./adapters/browserResetPersistence";

type Identity = { scope: "live" | "sandbox"; userId: string };
type Mutation = { cursor: number; snapshot?: unknown };
const PREFIX = "run-calculator:operational-mutation-cursor:v1:";

function key(identity: Identity): string {
  return `${PREFIX}${identity.scope}:${identity.userId}`;
}

function readCursor(identity: Identity): number {
  try {
    const value = Number(localStorage.getItem(key(identity)) ?? "0");
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

function writeCursor(identity: Identity, cursor: number): void {
  try { localStorage.setItem(key(identity), String(cursor)); } catch { /* retry next wake */ }
}

/**
 * Adopts server-materialized mutation snapshots in cursor order. It never
 * replays a command locally and waits for the bounded offline outbox to settle,
 * so an optimistic lifecycle action is not overwritten before its own canonical
 * response arrives.
 */
export async function consumeOperationalMutationCursor(
  identity: Identity,
  adopt: (snapshot: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const ownsIdentity = captureOperationalIdentityFence(identity);
  const resetEpoch = getStoredResetEpoch();
  const canAdopt = () => !signal?.aborted && ownsIdentity()
    && navigator.onLine && getStoredResetEpoch() === resetEpoch
    && !readOperationalIntentOutbox().some((item) => ["pending", "sending"].includes(item.state));
  if (!canAdopt()) return;
  let after = readCursor(identity);
  for (;;) {
    // A second wake may have completed this page while this request was queued.
    if (!canAdopt() || readCursor(identity) !== after) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = window.setTimeout(abort, 25_000);
    let body: { cursor?: unknown; hasMore?: unknown; mutations?: unknown };
    try {
      const response = await fetch(`/api/sync/operational-intents/cursor?after=${after}`, {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok || !canAdopt() || readCursor(identity) !== after) return;
      body = await response.json();
    } catch {
      // This is read-only recovery. Keep the last adopted cursor and retry on
      // the next wake; never turn an outage or cancellation into an ack.
      return;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    if (!canAdopt() || readCursor(identity) !== after || !body
      || !Array.isArray(body.mutations) || body.mutations.length > 200
      || !Number.isSafeInteger(body.cursor) || Number(body.cursor) < after) return;
    // Validate the whole page before adopting any of it.
    let previous = after;
    for (const item of body.mutations as Mutation[]) {
      if (!item || !Number.isSafeInteger(item.cursor) || item.cursor <= previous
        || item.cursor > Number(body.cursor)
        || (item.snapshot != null && (typeof item.snapshot !== "object" || Array.isArray(item.snapshot)))) return;
      previous = item.cursor;
    }
    for (const item of body.mutations as Mutation[]) {
      if (!canAdopt() || readCursor(identity) !== after) return;
      // Conflicted/review-required receipts intentionally carry no snapshot.
      // They still advance the durable cursor so every wake does not refetch
      // the same non-applicable outcome forever.
      if (item.snapshot !== null && item.snapshot !== undefined) {
        if (typeof item.snapshot !== "object") return;
        adopt(item.snapshot);
      }
      if (!canAdopt()) return;
      after = item.cursor;
      writeCursor(identity, after);
    }
    if (body.mutations.length === 0 || body.hasMore !== true) return;
  }
}