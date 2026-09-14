// Server-authority mix plan snapshot client (web).
//
// When online the server is boss: /inventory/mix-plan-snapshot pre-computes the
// make-day plan (buildMixPlan over canonical live + scheduled runs and the mix
// pool) once per request instead of every device recomputing it. When the fetch
// fails (offline) the snapshot is dropped for the requested make-day so the
// Mixes tab falls back to its own buildMixPlan call — "online = server,
// offline = local".
//
// Snapshots are keyed by make-day so switching the planner's date cannot show a
// stale plan from another day, and in-flight fetches are deduped per day.

import { useEffect, useState } from "react";
import {
  fetchMixPlanSnapshot,
  type MixPlanSnapshot,
} from "./inventoryShared";

const snapshots = new Map<string, MixPlanSnapshot>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function isValidSnap(s: unknown): s is MixPlanSnapshot {
  return !!s && typeof s === "object"
    && Array.isArray((s as MixPlanSnapshot).plan);
}

function notify(): void {
  for (const l of [...listeners]) l();
}

async function refresh(makeDay: string): Promise<void> {
  if (inflight.has(makeDay)) return inflight.get(makeDay);
  const p = (async () => {
    try {
      const snap = await fetchMixPlanSnapshot(makeDay);
      if (isValidSnap(snap)) snapshots.set(makeDay, snap);
      else snapshots.delete(makeDay);
    } catch {
      // Offline / endpoint unavailable: drop the server copy so the tab
      // recomputes locally instead of showing a stale server plan.
      snapshots.delete(makeDay);
    }
  })().finally(() => {
    inflight.delete(makeDay);
  });
  inflight.set(makeDay, p);
  await p;
  notify();
}

/** Re-fetch the shared server plan for a make-day (call on data-change events). */
export function refreshMixPlanSnapshot(makeDay: string): Promise<void> {
  return refresh(makeDay);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Latest server plan for `makeDay` (null = offline / not loaded → use local). */
export function useMixPlanSnapshot(makeDay: string): MixPlanSnapshot | null {
  const [snap, setSnap] = useState<MixPlanSnapshot | null>(
    () => snapshots.get(makeDay) ?? null,
  );
  useEffect(() => {
    let active = true;
    setSnap(snapshots.get(makeDay) ?? null);
    const unsubscribe = subscribe(() => {
      if (active) setSnap(snapshots.get(makeDay) ?? null);
    });
    void refresh(makeDay);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [makeDay]);
  return snap;
}
