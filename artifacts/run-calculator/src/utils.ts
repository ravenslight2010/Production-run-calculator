import type { FormValues, RunMeta } from "./types";
import { DEFAULT_PEP_TYPES } from "./types";

export function fmtElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtTime(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtNum(n: number, dec = 2): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toFixed(dec);
}

export function fmtComma(n: number, dec = 0): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function runLabel(r: RunMeta): string {
  if (r.brand && r.flavor) return `${r.brand} – ${r.flavor}`;
  if (r.brand) return r.brand;
  if (r.flavor) return r.flavor;
  return "Unnamed Run";
}

export function computeSummaryStats(vals: FormValues) {
  const totalPizzas = vals.casesNeeded * vals.pizzasPerCase;
  const totalPizzasForSauce = totalPizzas + vals.casesPerLayer * vals.pizzasPerCase;
  const frontlineRecipeLbs = (vals.frontlineRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const sauceEffBarrel = frontlineRecipeLbs > 0 ? frontlineRecipeLbs : vals.sauceBarrelLbs;
  const sauceLbs = (totalPizzasForSauce * vals.sauceOzPerPizza) / 16 + 30;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  const app1RecipeLbs = (vals.app1CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app1Lbs = (totalPizzasForSauce * vals.app1OzPerPizza) / 16 + 20;
  const app1IsMix = vals.app1Type.trim().toLowerCase().includes("mix");
  const app1EffBatch = app1RecipeLbs > 0 ? app1RecipeLbs : vals.app1BatchLbs;
  const app1Batches = !app1IsMix && app1EffBatch > 0 ? app1Lbs / app1EffBatch : 0;
  const app2RecipeLbs = (vals.app2CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app2Lbs = (totalPizzasForSauce * vals.app2OzPerPizza) / 16 + 20;
  const app2IsMix = vals.app2Type.trim().toLowerCase().includes("mix");
  const app2EffBatch = app2RecipeLbs > 0 ? app2RecipeLbs : vals.app2BatchLbs;
  const app2Batches = !app2IsMix && app2EffBatch > 0 ? app2Lbs / app2EffBatch : 0;
  const app3RecipeLbs = (vals.app3CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app3Lbs = (totalPizzasForSauce * vals.app3OzPerPizza) / 16 + 20;
  const app3IsMix = vals.app3Type.trim().toLowerCase().includes("mix");
  const app3EffBatch = app3RecipeLbs > 0 ? app3RecipeLbs : vals.app3BatchLbs;
  const app3Batches = !app3IsMix && app3EffBatch > 0 ? app3Lbs / app3EffBatch : 0;
  const app4RecipeLbs = (vals.app4CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app4Lbs = (totalPizzasForSauce * vals.app4OzPerPizza) / 16 + 20;
  const app4IsMix = vals.app4Type.trim().toLowerCase().includes("mix");
  const app4EffBatch = app4RecipeLbs > 0 ? app4RecipeLbs : vals.app4BatchLbs;
  const app4Batches = !app4IsMix && app4EffBatch > 0 ? app4Lbs / app4EffBatch : 0;
  const pep1Lbs = (totalPizzasForSauce * vals.pep1OzPerPizza) / 16 + vals.pep1Sticks;
  const pep1Batches =
    !DEFAULT_PEP_TYPES.includes(vals.pep1Type ?? "") && vals.pep1BatchLbs > 0
      ? pep1Lbs / vals.pep1BatchLbs
      : 0;
  const pep2Lbs = (totalPizzasForSauce * vals.pep2OzPerPizza) / 16 + vals.pep2Sticks;
  const pep2Batches =
    !DEFAULT_PEP_TYPES.includes(vals.pep2Type ?? "") && vals.pep2BatchLbs > 0
      ? pep2Lbs / vals.pep2BatchLbs
      : 0;
  const ppm = vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment;
  const estimatedTimeSec = ppm > 0 ? (totalPizzas * 60) / ppm : 0;
  return {
    totalCases: vals.casesNeeded,
    totalPizzas,
    estimatedTimeSec,
    sauceBatches,
    sauceEffBarrel,
    app1Lbs, app1Batches, app1Type: vals.app1Type,
    app2Lbs, app2Batches, app2Type: vals.app2Type,
    app3Lbs, app3Batches, app3Type: vals.app3Type,
    app4Lbs, app4Batches, app4Type: vals.app4Type,
    pep1Lbs, pep1Batches, pep1Type: vals.pep1Type ?? "",
    pep2Lbs, pep2Batches, pep2Type: vals.pep2Type ?? "",
  };
}

export function sauceBarrelBreakdown(
  sauceBatches: number,
  effBarrelLbs: number,
): { batchesPerBarrel: number; totalBarrels: number } | null {
  if (effBarrelLbs <= 0 || effBarrelLbs >= 450 || sauceBatches <= 0) return null;
  const batchesPerBarrel = Math.floor(450 / effBarrelLbs);
  if (batchesPerBarrel < 2) return null;
  const totalBarrels = Math.ceil(sauceBatches / batchesPerBarrel);
  return { batchesPerBarrel, totalBarrels };
}
