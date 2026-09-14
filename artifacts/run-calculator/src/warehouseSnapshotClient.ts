// Server-authority warehouse snapshot client (web).
//
// When online the server is boss: /inventory/warehouse-snapshot pre-computes
// the reorder / use-first / transfer lists from canonical sync data + inventory
// once per request instead of every device recomputing them on every inventory
// refresh (battery + CPU win, and identical numbers across devices). When the
// fetch fails (offline / endpoint down) the snapshot is dropped so the cards
// fall back to their own local computation — "online = server, offline = local".
//
// The cache + listener set are module-global so ReorderCard, UseFirstCard, and
// InventoryTab share ONE fetch (deduped in flight) and all update together.

import { useSyncExternalStore } from "react";
import {
  fetchWarehouseSnapshot,
  type WarehouseSnapshot,
} from "./inventoryShared";

let cached: WarehouseSnapshot | null = null;

// Only adopt responses that actually carry all three server-computed lists. A
// partial/foreign payload (e.g. a stale offline cache or a test double) must
// never shadow the local fallback with "undefined" lists.
function isValidSnap(s: unknown): s is WarehouseSnapshot {
  if (!s || typeof s !== "object") return false;
  const snap = s as WarehouseSnapshot;
  return (
    Array.isArray(snap.reorder)
    && Array.isArray(snap.useFirst)
    && Array.isArray(snap.transfer)
  );
}
let loadInFlight: Promise<void> | null = null;
let lastLoadedAt = 0;
const listeners = new Set<() => void>();

// Don't re-fetch more often than this on rapid inventory-event bursts.
const MIN_REFRESH_MS = 5_000;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

async function refresh(): Promise<void> {
  if (loadInFlight) return loadInFlight;
  if (cached && Date.now() - lastLoadedAt < MIN_REFRESH_MS) return;
  loadInFlight = (async () => {
    try {
      const snap = await fetchWarehouseSnapshot();
      cached = isValidSnap(snap) ? snap : null;
      if (cached) lastLoadedAt = Date.now();
    } catch {
      // Offline / endpoint unavailable: drop the server copy so consumers
      // recompute locally instead of showing stale server numbers.
      cached = null;
    }
  })().finally(() => {
    loadInFlight = null;
  });
  await loadInFlight;
  notify();
}

/** Re-fetch the shared server snapshot (also called from inventory SSE ticks). */
export function refreshWarehouseSnapshot(): Promise<void> {
  return refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void refresh();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WarehouseSnapshot | null {
  return cached;
}

/** Subscribe to the shared server snapshot; starts/refreshes it on first use. */
export function useWarehouseSnapshot(): WarehouseSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
