import {
  DEFAULT_VALUES,
  MACHINE_TIME_DEFAULTS,
  INGREDIENT_RENAMES,
  PEP_TYPE_RENAMES,
  canonicalDieTypeName,
  RUN_KEY,
  type FormValues,
} from "../types";
import { browserRecordStore, recordCodec } from "./browserRecordStore";

/** Browser-only cache adapter. Domain conflict policy deliberately lives elsewhere. */
const UPDATED_KEY = "run-calc-runvalues-updated";
const WRITE_EVENT = "run-calculator:run-values-written";

function normalize(values: Record<string, unknown>, raw: Record<string, unknown>): FormValues {
  for (const key of Object.keys(MACHINE_TIME_DEFAULTS) as Array<keyof typeof MACHINE_TIME_DEFAULTS>) {
    const value = Number(values[key]);
    if (!Number.isFinite(value) || value <= 0) values[key] = MACHINE_TIME_DEFAULTS[key];
  }
  if (typeof raw.pep1Combined !== "boolean") values.pep1Combined = !(typeof values.pep2Type === "string" && values.pep2Type.trim());
  for (const key of ["pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB"]) {
    if (typeof values[key] === "string" && PEP_TYPE_RENAMES[values[key] as string]) values[key] = PEP_TYPE_RENAMES[values[key] as string];
  }
  if (typeof values.dieType === "string") values.dieType = canonicalDieTypeName(values.dieType);
  for (const key of ["app1Type", "app2Type", "app3Type", "app4Type"]) {
    if (typeof values[key] === "string" && INGREDIENT_RENAMES[values[key] as string]) values[key] = INGREDIENT_RENAMES[values[key] as string];
  }
  for (const key of ["doughRecipe", "app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe", "frontlineRecipe"]) {
    if (!Array.isArray(values[key])) continue;
    for (const row of values[key] as Array<Record<string, unknown>>) {
      if (typeof row?.ingredient === "string" && INGREDIENT_RENAMES[row.ingredient]) row.ingredient = INGREDIENT_RENAMES[row.ingredient];
    }
  }
  const packaging = values.cartoned;
  if (typeof packaging === "string") {
    if (packaging.trim().toLowerCase() === "yes") values.cartoned = "cartoned";
    if (packaging.trim().toLowerCase() === "no") values.cartoned = "labeled";
  }
  return values as FormValues;
}

export function loadRunValues(id: string): FormValues {
  const parsed = browserRecordStore.record(
    RUN_KEY(id),
    () => null,
    { decode: (value) => value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null },
  ).read();
  return parsed
    ? normalize({ ...DEFAULT_VALUES, ...parsed } as Record<string, unknown>, parsed)
    : DEFAULT_VALUES;
}
export function saveRunValues(id: string, values: FormValues): void {
  browserRecordStore.record(RUN_KEY(id), () => values, { decode: () => null }).write(values);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { id } }));
}
export function subscribeRunValuesWrites(listener: (id: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<{ id?: string }>).detail?.id ?? "");
  window.addEventListener(WRITE_EVENT, handler);
  return () => window.removeEventListener(WRITE_EVENT, handler);
}
export function loadRunValuesUpdated(): Record<string, number> {
  return browserRecordStore.record(UPDATED_KEY, () => ({}), recordCodec(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  )).read();
}
export function saveRunValuesUpdated(values: Record<string, number>): void {
  browserRecordStore.record(UPDATED_KEY, () => ({}), recordCodec(
    (value): value is number => typeof value === "number",
  )).write(values);
}
export function markRunValuesUpdated(id: string, timestamp = Date.now()): void {
  const values = loadRunValuesUpdated();
  values[id] = timestamp;
  saveRunValuesUpdated(values);
}