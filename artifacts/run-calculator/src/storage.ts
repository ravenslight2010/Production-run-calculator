import {
  DEFAULT_VALUES,
  CRUST_FIELDS,
  PROGRESS_FIELDS,
  RUN_KEY,
  PROFILE_KEY,
  CRUST_PROFILE_KEY,
  DAY_KEY,
  HISTORY_KEY,
  TEMPLATES_KEY,
  BRAND_FLAVORS_KEY,
  BRANDS_KEY,
  FLAVORS_KEY,
  DOUGH_RECIPE_PRESETS_KEY,
  FRONTLINE_RECIPE_PRESETS_KEY,
  CHEESE_RECIPE_PRESETS_KEY,
  MAX_HISTORY_DAYS,
  type FormValues,
  type DayState,
  type RunMeta,
  type HistoryDay,
  type RunTemplate,
  type DoughRecipePreset,
  type RecipeRow,
  type CrustField,
} from "./types";
import { genId, todayStr } from "./utils";

export function loadList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as string[];
  } catch {}
  return fallback;
}

export function saveList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

export function loadBrandFlavors(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(BRAND_FLAVORS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
    const oldFlavors = loadList(FLAVORS_KEY, []);
    if (oldFlavors.length > 0) {
      const brands = loadList(BRANDS_KEY, []);
      const seeded: Record<string, string[]> = {};
      brands.forEach(b => { seeded[b] = [...oldFlavors]; });
      return seeded;
    }
  } catch {}
  return {};
}

export function saveBrandFlavors(bf: Record<string, string[]>): void {
  try { localStorage.setItem(BRAND_FLAVORS_KEY, JSON.stringify(bf)); } catch {}
}

export function loadProfile(brand: string, flavor: string): FormValues | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return null;
    const doughVals: Partial<FormValues> = JSON.parse(raw);
    let crustVals: Partial<FormValues> = {};
    try {
      const crustRaw = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
      if (crustRaw) crustVals = JSON.parse(crustRaw);
    } catch {}
    return { ...DEFAULT_VALUES, ...doughVals, ...crustVals };
  } catch {}
  return null;
}

export function saveProfile(brand: string, flavor: string, values: FormValues): void {
  if (!brand && !flavor) return;
  const doughVals = { ...values } as Record<string, unknown>;
  CRUST_FIELDS.forEach((f) => delete doughVals[f]);
  PROGRESS_FIELDS.forEach((f) => delete doughVals[f]);
  try { localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(doughVals)); } catch {}
  const crustVals: Partial<Record<CrustField, unknown>> = {};
  CRUST_FIELDS.forEach((f) => { crustVals[f] = values[f]; });
  try { localStorage.setItem(CRUST_PROFILE_KEY(brand, flavor), JSON.stringify(crustVals)); } catch {}
}

export function freshDayState(): DayState {
  return { runs: [{ id: genId(), brand: "", flavor: "" }], currentIndex: 0, date: todayStr() };
}

export function loadDayState(): DayState {
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DayState;
      if (!parsed.date || parsed.date !== todayStr()) return freshDayState();
      const runs = parsed.runs.map((r: any) => ({
        ...r,
        brand: r.brand ?? (r.label ?? ""),
        flavor: r.flavor ?? "",
      }));
      return { ...parsed, runs, date: parsed.date ?? todayStr() };
    }
  } catch {}
  return freshDayState();
}

export function saveDayState(ds: DayState): void {
  try { localStorage.setItem(DAY_KEY, JSON.stringify({ ...ds, date: todayStr() })); } catch {}
}

export function loadHistory(): HistoryDay[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as HistoryDay[];
  } catch {}
  return [];
}

export function archiveDayToHistory(ds: DayState, date: string): void {
  try {
    const history = loadHistory().filter(h => h.date !== date);
    const runValues: Record<string, FormValues> = {};
    for (const run of ds.runs) {
      const raw = localStorage.getItem(RUN_KEY(run.id));
      if (raw) runValues[run.id] = JSON.parse(raw);
    }
    const entry: HistoryDay = { date, runs: ds.runs, runValues };
    const trimmed = [entry, ...history].slice(0, MAX_HISTORY_DAYS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function loadRunValues(id: string): FormValues {
  try {
    const raw = localStorage.getItem(RUN_KEY(id));
    if (raw) return { ...DEFAULT_VALUES, ...JSON.parse(raw) };
    const legacy = localStorage.getItem("run-calc-v1");
    if (legacy) {
      const vals = { ...DEFAULT_VALUES, ...JSON.parse(legacy) };
      localStorage.setItem(RUN_KEY(id), JSON.stringify(vals));
      return vals;
    }
  } catch {}
  return DEFAULT_VALUES;
}

export function saveRunValues(id: string, values: FormValues): void {
  try { localStorage.setItem(RUN_KEY(id), JSON.stringify(values)); } catch {}
}

export function loadTemplates(): RunTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) return JSON.parse(raw) as RunTemplate[];
  } catch {}
  return [];
}

export function saveTemplates(t: RunTemplate[]): void {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)); } catch {}
}

export function loadDoughRecipePresets(): Record<string, DoughRecipePreset> {
  try { return JSON.parse(localStorage.getItem(DOUGH_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, DoughRecipePreset>; } catch { return {}; }
}
export function saveDoughRecipePresets(p: Record<string, DoughRecipePreset>): void {
  try { localStorage.setItem(DOUGH_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
}

export function loadFrontlineRecipePresets(): Record<string, RecipeRow[]> {
  try { return JSON.parse(localStorage.getItem(FRONTLINE_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, RecipeRow[]>; } catch { return {}; }
}
export function saveFrontlineRecipePresets(p: Record<string, RecipeRow[]>): void {
  try { localStorage.setItem(FRONTLINE_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
}

export function loadCheeseRecipePresets(): Record<string, RecipeRow[]> {
  try { return JSON.parse(localStorage.getItem(CHEESE_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, RecipeRow[]>; } catch { return {}; }
}
export function saveCheeseRecipePresets(p: Record<string, RecipeRow[]>): void {
  try { localStorage.setItem(CHEESE_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
}
