import type { CheeseRecipe } from "@workspace/cheese-recipes";
import {
  applyCheeseRepairItem,
  reconcileCheeseRecipes,
  type CheeseRepairDiscrepancy,
  type CheeseRepairItem,
} from "@workspace/cheese-reconcile";
import { fetchCheeseRecipes, saveCheeseRecipes } from "./cheeseRecipes";
import { fetchSavedCheeseSheets } from "./savedCheeseSheets";

export type CheeseReconcileView = {
  source: "cheese";
  label: string;
  discrepancies: CheeseRepairDiscrepancy[];
  items: CheeseRepairItem[];
  generatedAt: number;
};

export async function reconcileCheeseSheet(
  sheetId: number,
  label: string,
): Promise<CheeseReconcileView> {
  const [currentRecipes, sheets] = await Promise.all([
    fetchCheeseRecipes(),
    fetchSavedCheeseSheets(),
  ]);
  const sheet = sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) throw new Error("That retained cheese source is no longer available.");
  const result = reconcileCheeseRecipes({
    currentRecipes,
    sourceRecipes: sheet.data,
  });
  return { source: "cheese", label, ...result, generatedAt: Date.now() };
}

export async function applyCheeseReconcileItem(item: CheeseRepairItem): Promise<CheeseRecipe[]> {
  const current = await fetchCheeseRecipes();
  const next = applyCheeseRepairItem(current, item);
  return saveCheeseRecipes(next);
}