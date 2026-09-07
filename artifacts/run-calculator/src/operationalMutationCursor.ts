import { readOperationalIntentOutbox } from "./operationalIntentOutbox";

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
): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  if (readOperationalIntentOutbox().some((item) => ["pending", "sending"].includes(item.state))) return;
  let after = readCursor(identity);
  for (;;) {
    const response = await fetch(`/api/sync/operational-intents/cursor?after=${after}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { cursor?: unknown; hasMore?: unknown; mutations?: unknown };
    if (!Array.isArray(body.mutations) || !Number.isSafeInteger(body.cursor) || Number(body.cursor) < after) return;
    for (const item of body.mutations as Mutation[]) {
      if (!item || !Number.isSafeInteger(item.cursor) || item.cursor <= after) return;
      // Conflicted/review-required receipts intentionally carry no snapshot.
      // They still advance the durable cursor so every wake does not refetch
      // the same non-applicable outcome forever.
      if (item.snapshot !== null && item.snapshot !== undefined) {
        if (typeof item.snapshot !== "object") return;
        adopt(item.snapshot);
      }
      after = item.cursor;
      writeCursor(identity, after);
    }
    if (body.mutations.length === 0 || body.hasMore !== true) return;
  }
}