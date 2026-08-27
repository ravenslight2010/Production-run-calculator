import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { inventoryClientId } from "./inventoryShared";
import { deriveSourceKey } from "./savedSpecSheets";

export { deriveSourceKey };

export type SavedCheeseSheet = {
  id: number;
  label: string;
  sourceKey?: string | null;
  createdAt: number;
  data: CheeseRecipe[];
};

export type SavedCheeseSheetSaveResult = {
  snapshotId: number;
  cheeseSheets: SavedCheeseSheet[];
};

function headers(json = false): Record<string, string> {
  const out: Record<string, string> = { "x-client-id": inventoryClientId() };
  if (json) out["Content-Type"] = "application/json";
  return out;
}

export async function fetchSavedCheeseSheets(): Promise<SavedCheeseSheet[]> {
  const res = await fetch("/api/cheese-sheets", { headers: headers() });
  if (!res.ok) throw new Error(`List saved cheese sheets failed (${res.status})`);
  const out = await res.json() as { cheeseSheets?: SavedCheeseSheet[] };
  return out.cheeseSheets ?? [];
}

export async function saveCheeseSheet(
  label: string,
  data: CheeseRecipe[],
  sourceKey?: string,
): Promise<SavedCheeseSheetSaveResult> {
  const res = await fetch("/api/cheese-sheets", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ label, data, ...(sourceKey ? { sourceKey } : {}) }),
  });
  if (!res.ok) throw new Error(`Save cheese sheet failed (${res.status})`);
  const out = await res.json() as SavedCheeseSheetSaveResult;
  if (!Number.isInteger(out.snapshotId)) throw new Error("Cheese snapshot response did not include an id");
  return { snapshotId: out.snapshotId, cheeseSheets: out.cheeseSheets ?? [] };
}

export async function deleteCheeseSheet(id: number): Promise<SavedCheeseSheet[]> {
  const res = await fetch(`/api/cheese-sheets/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Delete saved cheese sheet failed (${res.status})`);
  const out = await res.json() as { cheeseSheets?: SavedCheeseSheet[] };
  return out.cheeseSheets ?? [];
}

export function buildCheeseSheetLabel(
  recipes: ReadonlyArray<CheeseRecipe>,
  sourceNames?: ReadonlyArray<string>,
): string {
  const names = (sourceNames ?? []).map((name) => name.trim()).filter(Boolean).join(", ");
  const summary = `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`;
  const when = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${names ? `${names} · ` : ""}${summary} — ${when}`;
}