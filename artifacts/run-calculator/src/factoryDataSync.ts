// Factory KV sync glue (web).
//
// Migrated master-data keys (name lists, presets, tombstones) are replicated
// to the server's factory_kv table.  localStorage stays the read cache for
// those "cached" keys — hydrated on startup from the server and kept in sync
// via fire-and-forget write-through PUTs on every local mutation.
//
// Stop reasons and packaging option lists (circles/shipper/skidStacking/
// gripSheets) are "server-only" — they have no localStorage copy after
// migration.  On startup their values land in module-level state (getters
// below); React state is updated after the startup fetch completes.
//
// Pattern (follows profileServerSync.ts):
//   1. fetchFactoryData()  — GET /api/factory-data → full keyed map
//   2. hydrateFromServer() — per-key stamp compare; write cached keys into
//      localStorage, populate server-only module state
//   3. putFactoryKey()     — fire-and-forget PUT for every local mutation
//
// Everything is fail-safe: storage / network errors are swallowed so the app
// keeps working fully offline.

import { inventoryClientId } from "./inventoryShared";
import {
  BRANDS_KEY,
  BRAND_FLAVORS_KEY,
  INGREDIENT_TYPES_KEY,
  PEP_TYPES_KEY,
  DIE_TYPES_KEY,
  CIRCLES_KEY,
  SHIPPER_KEY,
  SKID_STACKING_KEY,
  GRIP_SHEETS_KEY,
  CHEESE_INGREDIENTS_KEY,
  DOUGH_INGREDIENTS_KEY,
  FRONTLINE_INGREDIENTS_KEY,
  MIX_INGREDIENTS_KEY,
  DOUGH_RECIPE_NAMES_KEY,
  DOUGH_RECIPE_PRESETS_KEY,
  FRONTLINE_RECIPE_NAMES_KEY,
  FRONTLINE_RECIPE_PRESETS_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  CHEESE_RECIPE_PRESETS_KEY,
  MIX_RECIPE_NAMES_KEY,
  MERGED_AWAY_KEY,
  DELETED_ITEMS_KEY,
  DELETED_STAMPS_KEY,
  UNDELETED_STAMPS_KEY,
  STOP_REASONS_KEY,
  DEFAULT_STOP_REASONS,
  DEFAULT_CIRCLES,
  DEFAULT_SHIPPERS,
  DEFAULT_SKID_STACKING,
  DEFAULT_GRIP_SHEETS,
} from "./types";

// ── Key classification ───────────────────────────────────────────────────────

/** Keys that keep localStorage as a read cache (hydrated from server). */
export const FACTORY_KV_CACHED_KEYS: ReadonlySet<string> = new Set([
  BRANDS_KEY,
  BRAND_FLAVORS_KEY,
  INGREDIENT_TYPES_KEY,
  PEP_TYPES_KEY,
  DIE_TYPES_KEY,
  CHEESE_INGREDIENTS_KEY,
  DOUGH_INGREDIENTS_KEY,
  FRONTLINE_INGREDIENTS_KEY,
  MIX_INGREDIENTS_KEY,
  DOUGH_RECIPE_NAMES_KEY,
  DOUGH_RECIPE_PRESETS_KEY,
  FRONTLINE_RECIPE_NAMES_KEY,
  FRONTLINE_RECIPE_PRESETS_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  CHEESE_RECIPE_PRESETS_KEY,
  MIX_RECIPE_NAMES_KEY,
  MERGED_AWAY_KEY,
  DELETED_ITEMS_KEY,
  DELETED_STAMPS_KEY,
  UNDELETED_STAMPS_KEY,
]);

/** Keys that are server-only — never written to localStorage after migration. */
const FACTORY_KV_SERVER_ONLY_KEYS: ReadonlySet<string> = new Set([
  STOP_REASONS_KEY,
  CIRCLES_KEY,
  SHIPPER_KEY,
  SKID_STACKING_KEY,
  GRIP_SHEETS_KEY,
]);

// ── Stamp tracking ───────────────────────────────────────────────────────────
// For each cached key we store the server's updatedAt (ms) alongside it in
// localStorage.  On hydrate: local stamp > server → schedule write-through;
// server stamp > local → overwrite local.

const STAMP_KEY_PREFIX = "run-calc-fkv-stamp-";

function getLocalStamp(key: string): number {
  try {
    const v = localStorage.getItem(STAMP_KEY_PREFIX + key);
    if (v === null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setLocalStamp(key: string, ts: number): void {
  try {
    localStorage.setItem(STAMP_KEY_PREFIX + key, String(ts));
  } catch {}
}

/** Call after a local write-through PUT succeeds to record our edit time. */
export function stampLocalWrite(key: string): void {
  const now = Date.now();
  const cur = getLocalStamp(key);
  setLocalStamp(key, Math.max(now, cur + 1));
}

// ── Module-level state for server-only keys ──────────────────────────────────

let _stopReasons: string[] | null = null;
let _packagingSettings: {
  circles: string[];
  shipper: string[];
  skidStacking: string[];
  gripSheets: string[];
} | null = null;

export function getStopReasons(): string[] {
  return _stopReasons ?? DEFAULT_STOP_REASONS;
}

export function setStopReasonsModuleState(list: string[]): void {
  _stopReasons = list;
}

export interface PackagingSettings {
  circles: string[];
  shipper: string[];
  skidStacking: string[];
  gripSheets: string[];
}

export function getPackagingSettings(): PackagingSettings {
  return (
    _packagingSettings ?? {
      circles: DEFAULT_CIRCLES,
      shipper: DEFAULT_SHIPPERS,
      skidStacking: DEFAULT_SKID_STACKING,
      gripSheets: DEFAULT_GRIP_SHEETS,
    }
  );
}

export function setPackagingSettingsModuleState(s: PackagingSettings): void {
  _packagingSettings = s;
}

// ── API calls ────────────────────────────────────────────────────────────────

export type FactoryDataEntry = { value: unknown; updatedAt: string };
export type FactoryDataMap = Record<string, FactoryDataEntry>;

/** GET /api/factory-data — returns the full keyed map. */
export async function fetchFactoryData(): Promise<FactoryDataMap> {
  const res = await fetch("/api/factory-data", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`fetchFactoryData failed (${res.status})`);
  const body = (await res.json()) as { data?: FactoryDataMap };
  return body.data ?? {};
}

/** PUT /api/factory-data — fire-and-forget, retry once on failure. */
export function putFactoryKey(key: string, value: unknown): void {
  void (async () => {
    const body = JSON.stringify({ key, value });
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
        const res = await fetch("/api/factory-data", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-client-id": inventoryClientId(),
          },
          body,
        });
        ok = res.ok;
      } catch {
        // network error — retry
      }
    }
  })();
}

// ── hydrateFromServer ────────────────────────────────────────────────────────

/**
 * Apply the result of fetchFactoryData():
 *
 *   Cached keys (name lists, presets, tombstones):
 *     server newer  → overwrite localStorage + update stamp
 *     local newer   → schedule a write-through PUT (self-heal)
 *     equal / missing → no-op
 *
 *   Server-only keys (stop reasons + packaging):
 *     populate module-level state, delete any stale localStorage copy,
 *     and if local had a value that is newer than the server copy, PUT it up.
 */
export function hydrateFromServer(data: FactoryDataMap): void {
  // ── Cached keys ──────────────────────────────────────────────────────────
  for (const key of FACTORY_KV_CACHED_KEYS) {
    const entry = data[key];
    const localTs = getLocalStamp(key);

    if (!entry) {
      // Server has no value for this key.  If we have a local value, push it up.
      try {
        const local = localStorage.getItem(key);
        if (local !== null) putFactoryKey(key, JSON.parse(local));
      } catch {}
      continue;
    }

    const serverTs = new Date(entry.updatedAt).getTime();

    if (localTs > serverTs) {
      // Local is newer — push our value up.
      try {
        const local = localStorage.getItem(key);
        if (local !== null) putFactoryKey(key, JSON.parse(local));
      } catch {}
    } else if (serverTs > localTs) {
      // Server is newer — overwrite local.
      try {
        localStorage.setItem(key, JSON.stringify(entry.value));
        setLocalStamp(key, serverTs);
      } catch {}
    }
    // Equal stamps: no-op (already in sync).
  }

  // ── Server-only keys ─────────────────────────────────────────────────────
  // Stop reasons
  {
    const entry = data[STOP_REASONS_KEY];
    const localRaw = (() => {
      try { return localStorage.getItem(STOP_REASONS_KEY); } catch { return null; }
    })();
    const localTs = getLocalStamp(STOP_REASONS_KEY);

    if (entry) {
      const serverTs = new Date(entry.updatedAt).getTime();
      if (localTs > serverTs && localRaw !== null) {
        // Local copy is newer — push it up.
        try { putFactoryKey(STOP_REASONS_KEY, JSON.parse(localRaw)); } catch {}
        _stopReasons = (() => {
          try { const v = JSON.parse(localRaw); return Array.isArray(v) ? v : null; } catch { return null; }
        })();
      } else {
        _stopReasons = Array.isArray(entry.value) ? (entry.value as string[]) : null;
      }
    } else if (localRaw !== null) {
      // Server has nothing — push our local value.
      try { putFactoryKey(STOP_REASONS_KEY, JSON.parse(localRaw)); } catch {}
      _stopReasons = (() => {
        try { const v = JSON.parse(localRaw); return Array.isArray(v) ? v : null; } catch { return null; }
      })();
    }
    // Remove stale localStorage copy.
    try { localStorage.removeItem(STOP_REASONS_KEY); } catch {}
  }

  // Packaging settings (4 separate keys)
  const pkgKeys = [CIRCLES_KEY, SHIPPER_KEY, SKID_STACKING_KEY, GRIP_SHEETS_KEY] as const;
  const pkgDefaults: PackagingSettings = {
    circles: DEFAULT_CIRCLES,
    shipper: DEFAULT_SHIPPERS,
    skidStacking: DEFAULT_SKID_STACKING,
    gripSheets: DEFAULT_GRIP_SHEETS,
  };
  const pkgFieldMap: Record<string, keyof PackagingSettings> = {
    [CIRCLES_KEY]: "circles",
    [SHIPPER_KEY]: "shipper",
    [SKID_STACKING_KEY]: "skidStacking",
    [GRIP_SHEETS_KEY]: "gripSheets",
  };
  const pkg: PackagingSettings = { ...pkgDefaults };
  for (const key of pkgKeys) {
    const field = pkgFieldMap[key];
    const entry = data[key];
    const localRaw = (() => {
      try { return localStorage.getItem(key); } catch { return null; }
    })();
    const localTs = getLocalStamp(key);

    if (entry) {
      const serverTs = new Date(entry.updatedAt).getTime();
      if (localTs > serverTs && localRaw !== null) {
        try { putFactoryKey(key, JSON.parse(localRaw)); } catch {}
        try {
          const v = JSON.parse(localRaw);
          if (Array.isArray(v)) pkg[field] = v as string[];
        } catch {}
      } else {
        if (Array.isArray(entry.value)) pkg[field] = entry.value as string[];
      }
    } else if (localRaw !== null) {
      try { putFactoryKey(key, JSON.parse(localRaw)); } catch {}
      try {
        const v = JSON.parse(localRaw);
        if (Array.isArray(v)) pkg[field] = v as string[];
      } catch {}
    }
    // Remove stale localStorage copy.
    try { localStorage.removeItem(key); } catch {}
  }
  _packagingSettings = pkg;
}

/** Test-only: reset module state between test cases. */
export function resetFactoryDataSyncForTests(): void {
  _stopReasons = null;
  _packagingSettings = null;
}

// ── One-time migration heals ──────────────────────────────────────────────────

/**
 * runFactoryKvMigration — marker-guarded one-time heal.
 * Marker: "run-calc-factory-kv-migrated-v1"
 *
 * For each of the 20 cached factory-KV keys: if the server already has a
 * value, skip; otherwise read from localStorage and PUT to the server.
 * For the 5 server-only keys (stop reasons + packaging settings): same push
 * logic, then remove the stale localStorage copy.
 *
 * Call this AFTER fetchFactoryData() + hydrateFromServer() so serverData
 * reflects the true server state.
 */
const FACTORY_KV_MIGRATION_MARKER = "run-calc-factory-kv-migrated-v1";

export async function runFactoryKvMigration(serverData: FactoryDataMap): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(FACTORY_KV_MIGRATION_MARKER)) return;

    // Cached keys (name lists, presets, tombstones): push if server lacks them.
    for (const key of FACTORY_KV_CACHED_KEYS) {
      if (serverData[key]) continue; // server already has a value — skip
      try {
        const local = localStorage.getItem(key);
        if (local !== null) putFactoryKey(key, JSON.parse(local));
      } catch {}
    }

    // Server-only keys (stop reasons + packaging settings): push if absent,
    // then always remove the stale localStorage copy.
    const serverOnlyEntries: string[] = [
      STOP_REASONS_KEY,
      CIRCLES_KEY,
      SHIPPER_KEY,
      SKID_STACKING_KEY,
      GRIP_SHEETS_KEY,
    ];
    for (const key of serverOnlyEntries) {
      if (!serverData[key]) {
        try {
          const local = localStorage.getItem(key);
          if (local !== null) putFactoryKey(key, JSON.parse(local));
        } catch {}
      }
      // Remove stale localStorage copy whether or not we pushed.
      try { localStorage.removeItem(key); } catch {}
    }

    localStorage.setItem(FACTORY_KV_MIGRATION_MARKER, "1");
  } catch {
    // Fail safely — marker left unset so the heal retries next load.
  }
}

/**
 * runTemplatesMigration — marker-guarded one-time heal.
 * Marker: "run-calc-run-templates-migrated-v1"
 *
 * GETs /api/run-templates; if the server list is empty, reads the
 * TEMPLATES_KEY localStorage value and POSTs each template to the API.
 * Writes the marker on success so the heal never repeats.
 *
 * Guard: re-checks the GET response before pushing — if another device
 * already seeded the server list, skips the push to avoid duplicates.
 */
const TEMPLATES_MIGRATION_MARKER = "run-calc-run-templates-migrated-v1";
// Inline constant to avoid importing types.ts here (would create a circular
// dependency chain via storage.ts).
const TEMPLATES_LOCAL_KEY = "run-calc-templates";

export async function runTemplatesMigration(): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(TEMPLATES_MIGRATION_MARKER)) return;

    // Check if the server already has templates.
    const res = await fetch("/api/run-templates");
    if (!res.ok) return; // Don't mark; retry on next load.

    const body = (await res.json()) as { templates?: unknown[] };
    const serverTemplates = body.templates ?? [];

    // Guard: server already has templates — no push needed.
    if (serverTemplates.length > 0) {
      localStorage.setItem(TEMPLATES_MIGRATION_MARKER, "1");
      return;
    }

    // Read local templates.
    const localRaw = localStorage.getItem(TEMPLATES_LOCAL_KEY);
    if (!localRaw) {
      localStorage.setItem(TEMPLATES_MIGRATION_MARKER, "1");
      return;
    }

    let localTemplates: unknown[];
    try {
      const parsed = JSON.parse(localRaw);
      localTemplates = Array.isArray(parsed) ? parsed : [];
    } catch {
      localTemplates = [];
    }

    if (localTemplates.length > 0) {
      const pushRes = await fetch("/api/run-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: localTemplates }),
      });
      if (!pushRes.ok) return; // Don't mark; retry on next load.
    }

    localStorage.setItem(TEMPLATES_MIGRATION_MARKER, "1");
  } catch {
    // Fail safely — marker left unset so the heal retries next load.
  }
}
