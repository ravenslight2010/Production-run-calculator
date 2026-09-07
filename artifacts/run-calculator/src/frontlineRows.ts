import type { FormValues } from "./types";

export type FrontlineQuantitySource = {
  productionNeedsAvailable?: boolean;
  sauceLbs: number;
  sauceBatches: number;
  app1Lbs: number; app1Batches: number;
  app2Lbs: number; app2Batches: number;
  app3Lbs: number; app3Batches: number;
  app4Lbs: number; app4Batches: number;
  pep1Lbs: number; pep1Batches: number;
  pep2Lbs: number; pep2Batches: number;
  pep1LbsB: number; pep1BatchesB: number;
  pep2LbsB: number; pep2BatchesB: number;
};

export type FrontlineNeedRow = {
  key: string;
  station: "sauce" | "app1" | "app2" | "pep1" | "pep2" | "app3" | "app4";
  label: string;
  amount: number;
  unit: "batches" | "lbs";
  totalLbs: number;
  recipeName?: string;
  batchProgressField?: "app1BatchesMade" | "app2BatchesMade" | "app3BatchesMade" | "app4BatchesMade";
};

/**
 * One presentation model for every Frontline operator surface.
 * A configured item with positive demand is always retained. Batches are used
 * only when the calculation has an effective batch weight; otherwise pounds
 * are the honest fallback.
 */
export function deriveFrontlineNeedRows(
  v: FormValues,
  q: FrontlineQuantitySource,
): FrontlineNeedRow[] {
  if (q.productionNeedsAvailable === false) return [];
  const rows: FrontlineNeedRow[] = [];
  if (v.sauceOzPerPizza > 0 && q.sauceLbs > 0) {
    rows.push({
      key: "sauce", station: "sauce", label: "Sauce",
      amount: q.sauceBatches > 0 ? q.sauceBatches : q.sauceLbs,
      unit: q.sauceBatches > 0 ? "batches" : "lbs",
      totalLbs: q.sauceLbs,
      recipeName: v.frontlineRecipeName?.trim() || undefined,
    });
  }

  const addApp = (slot: 1 | 2 | 3 | 4) => {
    const type = v[`app${slot}Type`].trim();
    const lbs = q[`app${slot}Lbs`];
    const batches = q[`app${slot}Batches`];
    if (!type || !(lbs > 0)) return;
    const useBatches = batches > 0;
    rows.push({
      key: `app${slot}`,
      station: `app${slot}` as FrontlineNeedRow["station"],
      label: `App ${slot} — ${type}`,
      amount: useBatches ? batches : lbs,
      unit: useBatches ? "batches" : "lbs",
      totalLbs: lbs,
      recipeName: v[`app${slot}CheeseRecipeName`]?.trim() || undefined,
      ...(useBatches ? { batchProgressField: `app${slot}BatchesMade` as FrontlineNeedRow["batchProgressField"] } : {}),
    });
  };

  const addPep = (
    station: "pep1" | "pep2",
    suffix: "" | "B",
    label: string,
  ) => {
    const type = v[`${station}Type${suffix}` as keyof FormValues];
    const typeText = typeof type === "string" ? type.trim() : "";
    const lbs = q[`${station}Lbs${suffix}` as keyof FrontlineQuantitySource] as number;
    const batches = q[`${station}Batches${suffix}` as keyof FrontlineQuantitySource] as number;
    if (!typeText || !(lbs > 0)) return;
    rows.push({
      key: `${station}${suffix.toLowerCase()}`,
      station,
      label: `${label} — ${typeText}`,
      amount: batches > 0 ? batches : lbs,
      unit: batches > 0 ? "batches" : "lbs",
      totalLbs: lbs,
    });
  };

  addApp(1);
  addApp(2);
  const pep1Label = v.pep1Combined === true ? "Pep 1 & 2" : "Pep 1";
  addPep("pep1", "", pep1Label);
  addPep("pep1", "B", pep1Label);
  if (v.pep1Combined !== true) {
    addPep("pep2", "", "Pep 2");
    addPep("pep2", "B", "Pep 2");
  }
  addApp(3);
  addApp(4);
  return rows;
}