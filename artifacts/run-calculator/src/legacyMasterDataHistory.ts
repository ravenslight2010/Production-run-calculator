import { CHANGE_HISTORY_KEY, MAX_CHANGE_HISTORY, type MasterDataChange } from "./types";

export type LegacyHistoryRead = {
  items: MasterDataChange[];
  problem: string | null;
};

const changeTypes = new Set(["add", "remove", "rename", "move", "merge"]);
const MAX_LEGACY_CHARS = 4 * 1024 * 1024;

/** Only call after explicit review/discard confirmation and online manager authorization. */
export function resolveLegacyMasterDataHistory(): void {
  if (typeof localStorage === "undefined") throw new Error("Browser storage is unavailable. Legacy evidence was not resolved.");
  localStorage.removeItem(CHANGE_HISTORY_KEY);
  if (localStorage.getItem(CHANGE_HISTORY_KEY) !== null) {
    throw new Error("Legacy evidence deletion could not be confirmed. Reopen device-only history to review it.");
  }
}

/**
 * A read-only, bounded projection of old device-only evidence. Never expose the
 * snapshot to React, upload it, infer ownership, or use it as mutation input.
 * Oversized/malformed evidence remains byte-for-byte in its original location.
 */
export function readLegacyMasterDataHistory(): LegacyHistoryRead {
  try {
    // The compatibility adapter deliberately maps storage errors to null.
    // Evidence review must distinguish unreadable from absent, so use the raw
    // browser boundary here, with explicit failure handling and no writes.
    if (typeof localStorage === "undefined") throw new Error("Browser storage unavailable");
    const raw = localStorage.getItem(CHANGE_HISTORY_KEY);
    if (raw === null) return { items: [], problem: null };
    if (raw.length > MAX_LEGACY_CHARS) {
      return {
        items: [],
        problem: "Legacy change history is too large to display safely. Its original data is retained on this device for manager review.",
      };
    }
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Invalid legacy history");
    const items: MasterDataChange[] = [];
    let malformed = false;
    for (const item of value.slice(0, MAX_CHANGE_HISTORY)) {
      if (
        !item || typeof item !== "object"
        || typeof item.id !== "string" || item.id.length === 0 || item.id.length > 200
        || typeof item.description !== "string"
        || typeof item.ts !== "number" || !Number.isFinite(item.ts) || item.ts < 0 || item.ts > 8.64e15
        || !changeTypes.has(item.type)
      ) {
        malformed = true;
        continue;
      }
      items.push({
        id: item.id,
        ts: item.ts,
        type: item.type,
        description: item.description.slice(0, 500),
        before: {},
        evidence: "legacy-only",
      });
    }
    return {
      items,
      problem: malformed
        ? "Some legacy change history cannot be displayed. All original evidence is retained on this device for manager review."
        : null,
    };
  } catch {
    return {
      items: [],
      problem: "Legacy change history is unavailable. Stored evidence has not been changed; keep this device's browser data for manager review.",
    };
  }
}
