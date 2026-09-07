import { and, eq, gte, sql } from "drizzle-orm";
import {
  brandProfilesTable,
  dailySyncTable,
  savedSpecSheetsTable,
} from "@workspace/db";
import type { RepairDefinition, RepairResult, RepairTransaction } from "../repairRegistry";

export const AUG19_SAVED_SPEC_PROFILE_REPAIR_ID = "aug19-saved-spec-profile-repair-v1";
const AUG19_SAVED_SPEC_START = new Date("2026-08-19T00:00:00.000Z");
const AUG20_SAVED_SPEC_START = new Date("2026-08-20T00:00:00.000Z");
const AUG19_PROFILE_REPAIR_FROM_DATE = "2026-08-20";

type SavedParsedProfile = Record<string, unknown>;

const ciName = (value: unknown): string => String(value ?? "").trim().toLowerCase();

const finiteNumber = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/**
 * Apply only profile fields that a server-side repair can faithfully reproduce.
 * Recipe/applicator links stay client-owned because applySpecImport resolves
 * cheese/mix names against live pool and merge-alias state. Likewise, a parsed
 * dough/sauce name must not replace a profile's existing mixed rows: the normal
 * import keeps that recipe-owned link until it can tie the rows correctly.
 */
export function applySavedSpecProfileFields(
  current: Record<string, unknown>,
  parsed: SavedParsedProfile,
): { values: Record<string, unknown>; changedFields: string[] } {
  const values = { ...current };
  const changed = new Set<string>();
  const set = (field: string, value: unknown) => {
    if (values[field] === value) return;
    values[field] = value;
    changed.add(field);
  };
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const hasMixedRows = (value: unknown): boolean =>
    Array.isArray(value) &&
    value.some(
      (row) =>
        !!row &&
        typeof row === "object" &&
        (finiteNumber((row as Record<string, unknown>).lbs) ?? 0) > 0,
    );

  for (const [parsedField, storedField] of [
    ["dieType", "dieType"],
    ["allergen", "allergen"],
  ] as const) {
    const value = text(parsed[parsedField]);
    if (value) set(storedField, value);
  }
  const sauceName = text(parsed.sauceName);
  if (sauceName && !hasMixedRows(values.frontlineRecipe)) {
    set("frontlineRecipeName", sauceName);
  }
  const doughName = text(parsed.doughName);
  if (doughName && !hasMixedRows(values.doughRecipe)) {
    set("doughRecipeName", doughName);
  }
  const sauceOz = finiteNumber(parsed.sauceOzPerPizza);
  if (sauceOz !== undefined) set("sauceOzPerPizza", sauceOz);
  const casePack = finiteNumber(parsed.pizzasPerCase);
  if (casePack !== undefined && casePack > 0) set("pizzasPerCase", casePack);
  const barrelLbs = finiteNumber(parsed.sauceBarrelLbs);
  if (barrelLbs !== undefined && barrelLbs > 0) set("sauceBarrelLbs", barrelLbs);

  return { values, changedFields: [...changed] };
}

async function executeAug19SavedSpecProfileRepair(
  tx: RepairTransaction,
): Promise<RepairResult> {
  const sheets = await tx
    .select()
    .from(savedSpecSheetsTable)
    .where(
      and(
        gte(savedSpecSheetsTable.createdAt, AUG19_SAVED_SPEC_START),
        sql`${savedSpecSheetsTable.createdAt} < ${AUG20_SAVED_SPEC_START}`,
      ),
    )
    .orderBy(sql`${savedSpecSheetsTable.createdAt} DESC, ${savedSpecSheetsTable.id} DESC`);

  // Newest applicable parse wins for each profile. It is important that this
  // map records the whole parsed object, rather than a pre-filled default,
  // because absence means "preserve the existing field".
  const parsedByProfile = new Map<string, SavedParsedProfile>();
  for (const sheet of sheets) {
    const data = sheet.data as { profiles?: unknown } | null;
    if (!Array.isArray(data?.profiles)) continue;
    for (const entry of data.profiles) {
      if (!entry || typeof entry !== "object") continue;
      const parsed = entry as SavedParsedProfile;
      const brand = ciName(parsed.brand);
      const flavor = ciName(parsed.flavor);
      if (!brand || !flavor) continue;
      const key = `${sheet.scope}\u0000${brand}\u0000${flavor}`;
      if (!parsedByProfile.has(key)) parsedByProfile.set(key, parsed);
    }
  }

  const profiles = await tx.select().from(brandProfilesTable).for("update");
  const repairedByProfile = new Map<string, { values: Record<string, unknown>; fields: string[] }>();
  let repairedProfiles = 0;
  const now = Date.now();
  for (const profile of profiles) {
    const profileKey = `${profile.scope}\u0000${ciName(profile.brand)}\u0000${ciName(profile.flavor)}`;
    const parsed = parsedByProfile.get(profileKey);
    if (!parsed) continue;
    const repair = applySavedSpecProfileFields(
      { ...(profile.values as Record<string, unknown>) },
      parsed,
    );
    if (repair.changedFields.length === 0) continue;
    const stamp = Math.max(profile.updatedAtMs ?? 0, now) + 1;
    await tx
      .update(brandProfilesTable)
      .set({ values: repair.values, updatedAtMs: stamp })
      .where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, profile.scope)));
    repairedByProfile.set(profileKey, { values: repair.values, fields: repair.changedFields });
    repairedProfiles++;
  }

  // Keep unstarted scheduled copies consistent with the repaired setup while
  // preserving started and historical runs as an immutable record of what ran.
  let repairedRuns = 0;
  const days = await tx
    .select()
    .from(dailySyncTable)
    .where(gte(dailySyncTable.date, AUG19_PROFILE_REPAIR_FROM_DATE))
    .for("update");
  for (const day of days) {
    const data = day.data as Record<string, unknown> | null;
    const dayState = data?.dayState as Record<string, unknown> | undefined;
    const runs = Array.isArray(dayState?.runs) ? dayState.runs : [];
    const runValues = data?.runValues;
    if (!runValues || typeof runValues !== "object" || Array.isArray(runValues)) continue;
    const nextValues = { ...(runValues as Record<string, unknown>) };
    const oldStamps =
      data?.runValuesUpdatedAt && typeof data.runValuesUpdatedAt === "object"
        ? (data.runValuesUpdatedAt as Record<string, unknown>)
        : {};
    const nextStamps = { ...oldStamps };
    let changed = false;
    for (const run of runs) {
      if (!run || typeof run !== "object") continue;
      const meta = run as Record<string, unknown>;
      if (meta.startedAt != null || typeof meta.id !== "string") continue;
      const repair = repairedByProfile.get(
        `${day.scope}\u0000${ciName(meta.brand)}\u0000${ciName(meta.flavor)}`,
      );
      if (!repair) continue;
      const current = nextValues[meta.id];
      if (!current || typeof current !== "object" || Array.isArray(current)) continue;
      const next = { ...(current as Record<string, unknown>) };
      for (const field of repair.fields) next[field] = repair.values[field];
      nextValues[meta.id] = next;
      const previous = finiteNumber(nextStamps[meta.id]) ?? 0;
      nextStamps[meta.id] = Math.max(previous, now) + 1;
      repairedRuns++;
      changed = true;
    }
    if (!changed) continue;
    await tx
      .update(dailySyncTable)
      .set({
        data: { ...data, runValues: nextValues, runValuesUpdatedAt: nextStamps },
        updatedAt: new Date(),
      })
      .where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope)));
  }

  return {
    sheetsScanned: sheets.length,
    parsedProfiles: parsedByProfile.size,
    repairedProfiles,
    repairedRuns,
  };
}

export const aug19SavedSpecProfileRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: AUG19_SAVED_SPEC_PROFILE_REPAIR_ID,
  owner: "historical-data-repair",
  dependencies: Object.freeze([]),
  eligibility: "Saved spec sheets created on 2026-08-19 with matching stored brand profiles; only unstarted runs from 2026-08-20 onward.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "Matching profiles in every scope and their unstarted scheduled runs dated 2026-08-20 or later.",
    excludedScope: "Profiles without an August 19 saved parse, absent parse fields, started runs, and runs before 2026-08-20.",
    rollback: "Marker result records counts; restoration requires the reviewed pre-repair saved values.",
    evidence: "Released aug19-saved-spec-profile-repair-v1 body and saved-spec timestamp window.",
  }),
  execute: executeAug19SavedSpecProfileRepair,
});