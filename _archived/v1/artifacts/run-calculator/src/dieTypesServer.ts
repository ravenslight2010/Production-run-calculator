// Die types — server master-data glue (web).
//
// The die-type master list used to live only in localStorage and ride the
// day-state sync payload, so a factory data reset or a cleared browser could
// lose custom dies. It is now a factory-wide server pool (NOT part of the
// per-day sync payload), so it survives resets and fresh devices. The local
// list (DIE_TYPES_KEY) remains an offline cache; local deletion tombstones
// (deletedItems "dieTypes") are still honored so a die the user removed is
// never resurrected by the server list, and add/rename/delete flows push to
// the server best-effort so every device converges.

import { canonicalDieTypeName } from "./types";
import { inventoryClientId } from "./inventoryShared";

export const DIE_TYPES_SERVER_MIGRATED_KEY = "run-calc-die-types-server-migrated-v1";

export async function fetchServerDieTypes(): Promise<string[]> {
  const res = await fetch("/api/die-types", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List die types failed (${res.status})`);
  const data = (await res.json()) as { names: unknown };
  return Array.isArray(data.names) ? data.names.filter((n): n is string => typeof n === "string") : [];
}

/** Best-effort upsert; failures are swallowed (local list still works offline). */
export async function pushDieTypesToServer(names: string[]): Promise<boolean> {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length === 0) return true;
  try {
    const res = await fetch("/api/die-types", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": inventoryClientId() },
      body: JSON.stringify({ names: clean }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Best-effort server delete; failures are swallowed (tombstone still hides it locally). */
export async function deleteDieTypesOnServer(names: string[]): Promise<boolean> {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length === 0) return true;
  try {
    const res = await fetch("/api/die-types/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": inventoryClientId() },
      body: JSON.stringify({ names: clean }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pure reconcile of the server pool with the local (already tombstone-filtered)
 * list. Returns the effective display list plus the local-only names that must
 * be pushed up so other devices see them. Server names are folded through the
 * canonical rename map and de-duped case-insensitively (first spelling wins,
 * local spelling preferred), and locally deleted names are dropped.
 */
export function reconcileDieTypes(
  serverNames: string[],
  localNames: string[],
  isLocallyDeleted: (name: string) => boolean,
): { effective: string[]; toPush: string[] } {
  const seen = new Set<string>();
  const effective: string[] = [];
  const add = (name: string) => {
    const canon = canonicalDieTypeName(name);
    const lower = canon.toLowerCase();
    if (!lower || seen.has(lower) || isLocallyDeleted(canon)) return;
    seen.add(lower);
    effective.push(canon);
  };
  // Local first so an existing local spelling wins over the server's.
  for (const n of localNames) add(n);
  for (const n of serverNames) add(n);
  effective.sort((a, b) => a.localeCompare(b));

  const serverLower = new Set(serverNames.map(n => canonicalDieTypeName(n).toLowerCase()));
  const toPush = effective.filter(n => !serverLower.has(n.toLowerCase()));
  return { effective, toPush };
}
