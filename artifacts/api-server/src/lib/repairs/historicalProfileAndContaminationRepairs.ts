import { and, eq, gte, sql } from "drizzle-orm";
import {
  aiCorrectionsTable,
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  doughRecipesTable,
  incidentsTable,
  mixesTable,
  sauceRecipesTable,
  savedSpecSheetsTable,
  specImportAliasesTable,
} from "@workspace/db";
import { sanitizeSpecAliases, type SpecImportAlias as SpecAliasEntry } from "@workspace/spec-import";
import { findFanTarget, healFanPoisonedValues, type DoughPoolRow } from "../brandFanHeal";
import { BRAND_DRIFT_RENAMES, brandDriftTargetFor, planBrandAliasRepoints } from "../brandDriftHeal";
import type { RepairDefinition, RepairResult, RepairTransaction } from "../repairRegistry";

type Values = Record<string, unknown>;
const definition = (id: string, execute: (tx: RepairTransaction) => Promise<RepairResult>): RepairDefinition<RepairTransaction> =>
  Object.freeze({
    id, owner: "historical-data-repair", dependencies: Object.freeze([]),
    eligibility: "Only the released repair's explicit, row-level predicates are mutated.",
    mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker",
    managerAllowed: false,
    safety: Object.freeze({
      affectedScope: "The released repair's audited rows.",
      excludedScope: "Rows which do not match the repair's explicit predicate.",
      rollback: "Marker result records the released mutation counts; restoration requires reviewed source data.",
      evidence: "Released legacy repair body and marker id.",
    }),
    execute,
  });

export const BOBO_CROSS_FAMILY_ALIAS_UNDO_REPAIR_ID = "bobo-cross-family-alias-undo-v1";
const BOBO_POISONED_CANONICAL = "bobo's breakfast cheese mix";
const BOBO_VERBATIM_EXTERNAL = "Bobo Breakfast Mix";
export function healBoboApplicatorsInParse(data: { profiles?: Array<{ applicators?: Array<{ type?: unknown }> }> }): boolean {
  let changed = false;
  for (const profile of data?.profiles ?? []) for (const a of profile?.applicators ?? []) {
    if (typeof a?.type === "string" && a.type.trim().toLowerCase() === BOBO_POISONED_CANONICAL) {
      a.type = BOBO_VERBATIM_EXTERNAL; changed = true;
    }
  }
  return changed;
}
export const boboCrossFamilyAliasUndoRepair = definition(BOBO_CROSS_FAMILY_ALIAS_UNDO_REPAIR_ID, async (tx) => {
  const rows = await tx.select().from(specImportAliasesTable).for("update");
  const byScope = new Map<string, typeof rows>();
  for (const row of rows) byScope.set(row.scope, [...(byScope.get(row.scope) ?? []), row]);
  const dropIds: number[] = [];
  for (const scopeRows of byScope.values()) {
    const entries: SpecAliasEntry[] = scopeRows.map((r) => ({ kind: r.kind as SpecAliasEntry["kind"], externalName: r.externalName, canonicalName: r.canonicalName, context: r.context }));
    const kept = new Set(sanitizeSpecAliases(entries));
    entries.forEach((entry, index) => { if (!kept.has(entry)) dropIds.push(scopeRows[index].id); });
  }
  let deletedAliases = 0;
  for (const id of dropIds) deletedAliases += (await tx.delete(specImportAliasesTable).where(eq(specImportAliasesTable.id, id)).returning({ id: specImportAliasesTable.id })).length;
  const corrections = await tx.delete(aiCorrectionsTable).where(and(eq(sql`lower(trim(${aiCorrectionsTable.fromText}))`, "bobo breakfast mix"), eq(sql`lower(trim(${aiCorrectionsTable.toText}))`, BOBO_POISONED_CANONICAL))).returning({ id: aiCorrectionsTable.id });
  let healedSheets = 0;
  const sheets = await tx.select().from(savedSpecSheetsTable).where(sql`${savedSpecSheetsTable.data}::text ilike ${"%bobo's breakfast cheese mix%"}`).for("update");
  for (const sheet of sheets) {
    const data = sheet.data as Parameters<typeof healBoboApplicatorsInParse>[0] | null;
    if (data && healBoboApplicatorsInParse(data)) { await tx.update(savedSpecSheetsTable).set({ data }).where(eq(savedSpecSheetsTable.id, sheet.id)); healedSheets++; }
  }
  return { scannedAliases: rows.length, deletedAliases, deletedCorrections: corrections.length, healedSheets };
});

export const LOWES_NATURAL_PEP_NAME_REPAIR_ID = "lowes-natural-pep-name-v1";
const NATURAL_PEP_CANONICAL = "Pepperoni Stick - NATURAL";
const isBareNatural = (value: unknown) => typeof value === "string" && /^natural(\s*\(.*\))?$/i.test(value.trim());
const pepFields = ["pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB"] as const;
export function healNaturalPepInValues(values: Values): boolean {
  let changed = false; for (const key of pepFields) if (isBareNatural(values[key])) { values[key] = NATURAL_PEP_CANONICAL; changed = true; } return changed;
}
export function healNaturalPepList(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  let changed = false; const seen = new Set<string>(); const out: string[] = [];
  for (const item of list) if (typeof item === "string") { const next = isBareNatural(item) ? NATURAL_PEP_CANONICAL : item; changed ||= next !== item; if (seen.has(next.toLowerCase())) changed = true; else { seen.add(next.toLowerCase()); out.push(next); } }
  return changed ? out : null;
}
export const lowesNaturalPepNameRepair = definition(LOWES_NATURAL_PEP_NAME_REPAIR_ID, async (tx) => {
  let healedSheets = 0, healedProfiles = 0, healedDays = 0;
  const sheets = await tx.select().from(savedSpecSheetsTable).where(sql`${savedSpecSheetsTable.data}::text ~* ${'"natural'}`).for("update");
  for (const sheet of sheets) {
    const data = sheet.data as { profiles?: Array<{ pepperonis?: Array<{ type?: unknown }> }> } | null; let changed = false;
    for (const p of data?.profiles ?? []) for (const pep of p?.pepperonis ?? []) if (isBareNatural(pep?.type)) { pep.type = NATURAL_PEP_CANONICAL; changed = true; }
    if (changed) { await tx.update(savedSpecSheetsTable).set({ data }).where(eq(savedSpecSheetsTable.id, sheet.id)); healedSheets++; }
  }
  const profiles = await tx.select().from(brandProfilesTable).for("update");
  for (const p of profiles) { const values = { ...(p.values ?? {}) } as Values; if (!healNaturalPepInValues(values)) continue; await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); healedProfiles++; }
  const days = await tx.select().from(dailySyncTable).where(gte(dailySyncTable.date, "2026-07-20")).for("update");
  for (const day of days) {
    const data = day.data as Values | null; if (!data || typeof data !== "object") continue; let changed = false;
    const list = healNaturalPepList(data.pepTypes); if (list) { data.pepTypes = list; changed = true; }
    for (const values of Object.values(data.runValues ?? {})) if (values && typeof values === "object" && healNaturalPepInValues(values as Values)) { (values as Values).valuesUpdatedAtMs = Math.max(Number((values as Values).valuesUpdatedAtMs ?? 0) + 1, Date.now()); changed = true; }
    if (changed) { await tx.update(dailySyncTable).set({ data }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope))); healedDays++; }
  }
  return { healedSheets, healedProfiles, healedDays };
});

export const BRAND_FAN_DOUGH_DEPOISON_REPAIR_ID = "brand-fan-dough-depoison-v1";
export const brandFanDoughDepoisonRepair = definition(BRAND_FAN_DOUGH_DEPOISON_REPAIR_ID, async (tx) => {
  const doughs = await tx.select().from(doughRecipesTable); const pool = new Map<string, DoughPoolRow[]>();
  for (const dough of doughs) {
    const components = Array.isArray(dough.components)
      ? (dough.components as { ingredient?: unknown; lbs?: unknown }[])
          .filter((component) => component && typeof component === "object")
          .map((component) => ({
            ingredient: String(component.ingredient ?? ""),
            lbs: Number(component.lbs ?? 0),
          }))
      : [];
    pool.set(dough.scope, [...(pool.get(dough.scope) ?? []), { name: dough.name, components }]);
  }
  let healedProfiles = 0, healedDays = 0, healedRuns = 0;
  const profiles = await tx.select().from(brandProfilesTable).for("update");
  for (const p of profiles) {
    const separator = p.key.indexOf("__");
    if (separator < 0) continue;
    const target = findFanTarget(p.key.slice(0, separator), p.key.slice(separator + 2));
    const values = target && healFanPoisonedValues((p.values ?? {}) as Values, target, pool.get(p.scope) ?? []);
    if (!values) continue;
    await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope)));
    healedProfiles++;
  }
  const days = await tx.select().from(dailySyncTable).where(gte(dailySyncTable.date, "2026-07-23")).for("update");
  for (const day of days) { const data = (day.data ?? {}) as Values; const runs = Array.isArray((data.dayState as Values)?.runs) ? (data.dayState as Values).runs as Values[] : []; const runValues = data.runValues as Record<string, Values>; let changed = false;
    for (const run of runs) { const target = findFanTarget(String(run.brand ?? ""), String(run.flavor ?? "")); const id = String(run.id ?? ""); const values = target && runValues?.[id] && healFanPoisonedValues(runValues[id], target, pool.get(day.scope) ?? []); if (values) { values.valuesUpdatedAtMs = Math.max(Number(values.valuesUpdatedAtMs ?? 0) + 1, Date.now()); runValues[id] = values; changed = true; healedRuns++; } }
    if (changed) { await tx.update(dailySyncTable).set({ data: { ...data } }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope))); healedDays++; } }
  return { healedProfiles, healedDays, healedRuns };
});

export const BRAND_DRIFT_RENAME_REPAIR_ID = "brand-drift-rename-v1";
export const brandDriftRenameRepair = definition(BRAND_DRIFT_RENAME_REPAIR_ID, async (tx) => {
  const scopes = new Set<string>(["live"]); let renamedRows = 0;
  for (const table of [cheeseRecipesTable, mixesTable, doughRecipesTable, sauceRecipesTable] as const) for (const row of await tx.select({ id: table.id, scope: table.scope, brand: table.brand }).from(table).for("update")) { scopes.add(row.scope); const target = brandDriftTargetFor(row.brand ?? ""); if (target) { await tx.update(table).set({ brand: target, updatedAt: new Date() }).where(and(eq(table.id, row.id), eq(table.scope, row.scope))); renamedRows++; } }
  const aliases = await tx.select().from(specImportAliasesTable).for("update"); let repointedAliases = 0, learnedAliases = 0;
  for (const [from, to] of BRAND_DRIFT_RENAMES) for (const plan of planBrandAliasRepoints(aliases, from, to)) { if (plan.action === "delete") await tx.delete(specImportAliasesTable).where(eq(specImportAliasesTable.id, plan.row.id)); else await tx.update(specImportAliasesTable).set({ ...plan.set, updatedAt: new Date() }).where(eq(specImportAliasesTable.id, plan.row.id)); repointedAliases++; }
  for (const scope of scopes) for (const [from, to] of BRAND_DRIFT_RENAMES) {
    const existing = aliases.filter((a) => a.scope === scope && a.kind === "brand" && a.externalName.trim().toLowerCase() === from.trim().toLowerCase() && (a.context ?? null) === null);
    if (existing.length) {
      for (const row of existing) if (row.canonicalName !== to) {
        await tx.update(specImportAliasesTable).set({ canonicalName: to, updatedAt: new Date() }).where(eq(specImportAliasesTable.id, row.id));
        learnedAliases++;
      }
    } else {
      await tx.insert(specImportAliasesTable).values({ scope, kind: "brand", externalName: from, canonicalName: to, context: null });
      learnedAliases++;
    }
  }
  return { renamedRows, repointedAliases, learnedAliases };
});

export const APPLICATOR_CONTAMINATION_DEPOISON_REPAIR_ID = "applicator-contamination-depoison-v1";
export const applicatorContaminationDepoisonRepair = definition(APPLICATOR_CONTAMINATION_DEPOISON_REPAIR_ID, async (tx) => {
  const profiles = await tx.select().from(brandProfilesTable).for("update"); const owners = new Map<string, Set<string>>();
  for (const p of profiles) for (const field of ["app1CheeseRecipeName", "app2CheeseRecipeName"]) { const name = String((p.values as Values)[field] ?? "").trim(); if (name) owners.set(name, new Set([...(owners.get(name) ?? []), `${p.brand.toLowerCase()}__${p.flavor.toLowerCase()}`])); }
  let healedProfiles = 0; const details: Array<{ profileKey: string; field: string; cleared: string }> = [];
  for (const p of profiles) { const values = { ...(p.values as Values) }; const key = `${p.brand.toLowerCase()}__${p.flavor.toLowerCase()}`; const own = new Set(["app1CheeseRecipeName", "app2CheeseRecipeName"].map((f) => String(values[f] ?? "").trim())); let changed = false;
    for (const [recipe, type] of [["app3CheeseRecipeName", "app3Type"], ["app4CheeseRecipeName", "app4Type"]]) {
      const name = String(values[recipe] ?? "").trim(), set = owners.get(name);
      if (!name || own.has(name) || !set) continue;
      if (!set.has(key) && [...set].some((candidate) => candidate !== key)) {
        details.push({ profileKey: p.key, field: recipe, cleared: name }); values[recipe] = ""; values[type] = ""; changed = true;
      }
    }
    if (changed) { await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); healedProfiles++; } }
  return { healedProfiles, details };
});

export const BRAND_DUPLICATE_PURGE_REPAIR_ID = "brand-duplicate-purge-v1";
export const brandDuplicatePurgeRepair = definition(BRAND_DUPLICATE_PURGE_REPAIR_ID, async (tx) => {
  let healedRows = 0;
  for (const row of await tx.select().from(dailySyncTable)) {
    const data = (row.data ?? {}) as Values;
    const brands = Array.isArray(data.brands) ? data.brands.filter((v): v is string => typeof v === "string") : [];
    if (!brands.length) continue;
    const seen = new Map<string, string>();
    for (const brand of [...brands].sort((a, b) => a.localeCompare(b))) {
      const key = brand.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, brand.trim());
    }
    const deduped = [...seen.values()].sort((a, b) => a.localeCompare(b));
    if (brands.length !== deduped.length) {
      await tx.update(dailySyncTable).set({ data: { ...data, brands: deduped } }).where(and(eq(dailySyncTable.date, row.date), eq(dailySyncTable.scope, row.scope)));
      healedRows++;
    }
  }
  return { healedRows };
});

export const TUNNEL_PRE_POST_DEFAULT_REPAIR_ID = "tunnel-pre-post-default-v1";
export const tunnelPrePostDefaultRepair = definition(TUNNEL_PRE_POST_DEFAULT_REPAIR_ID, async (tx) => {
  const profiles = await tx.select().from(brandProfilesTable).for("update"); let updated = 0;
  for (const p of profiles) { const values = { ...(p.values as Values) }; const pre = Number(values.preTunnelMin ?? 0), post = Number(values.postTunnelMin ?? 0); if (pre > 0 && post > 0) continue; if (!(pre > 0)) values.preTunnelMin = 2.5; if (!(post > 0)) values.postTunnelMin = 2.5; await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); updated++; }
  return { scanned: profiles.length, updated };
});

export const RESOLVED_INCIDENT_WORKFLOW_RECONCILIATION_REPAIR_ID = "incident-resolved-workflow-reconciliation-v1";
export const resolvedIncidentWorkflowReconciliationRepair = definition(RESOLVED_INCIDENT_WORKFLOW_RECONCILIATION_REPAIR_ID, async (tx) => {
  const rows = await tx.select({ id: incidentsTable.id }).from(incidentsTable).where(and(eq(incidentsTable.status, "resolved"), sql`${incidentsTable.workflowState} <> 'resolved'`)).for("update"); let reconciled = 0;
  for (const row of rows) reconciled += (await tx.update(incidentsTable).set({ workflowState: "resolved" }).where(eq(incidentsTable.id, row.id)).returning({ id: incidentsTable.id })).length;
  return { reconciled };
});

type ProfileRule = (brand: string, flavor: string, values: Values) => boolean;
async function repairProfiles(tx: RepairTransaction, rule: ProfileRule) {
  let healedProfiles = 0;
  for (const p of await tx.select().from(brandProfilesTable).for("update")) {
    const values = { ...(p.values ?? {}) } as Values;
    if (!rule(p.brand.toLowerCase(), p.flavor.toLowerCase(), values)) continue;
    await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope)));
    healedProfiles++;
  }
  return healedProfiles;
}

export const JULY_2026_PROFILE_CORRECTIONS_REPAIR_ID = "july-2026-profile-corrections-v1";
export const july2026ProfileCorrectionsRepair = definition(JULY_2026_PROFILE_CORRECTIONS_REPAIR_ID, async (tx) => {
  const healedProfiles = await repairProfiles(tx, (brand, flavor, v) => {
    let changed = false, weight = Number(v.targetDoughballWeight ?? 0);
    const setWeight = (from: number, to: number) => { if (Math.abs(weight - from) < .05) { v.targetDoughballWeight = to; weight = to; changed = true; } };
    const setSauce = (name: string) => { if (!String(v.frontlineRecipeName ?? "").trim()) { v.frontlineRecipeName = name; changed = true; } };
    if (brand === '11" hannaford' && flavor === "chicken tikka masala" && String(v.doughRecipeName ?? "").trim() === "Naan recipe") { v.doughRecipeName = "Naan Dough"; changed = true; }
    if (brand === "brand" && flavor === "mr07ch24") setWeight(14.2, 6.2);
    if (brand === "basha's ultra thin crust") setWeight(5.7, 7.8);
    if (brand === "lowe's" && flavor === "spinach & mushroom") { setWeight(5.7, 13); setSauce("Lucia Pizza Sauce"); }
    if (brand === "nob hill craft pizzas" && flavor === "caribbean") { setWeight(5.7, 12.1); setSauce("Sweet n Sour Sauce"); }
    if (brand === "lowe's" && flavor === "bacon cheeseburger") setSauce("Cheeseburger Sauce");
    if (brand === "lowe's" && flavor === "caribbean") setSauce("Sweet n Sour Sauce");
    if (brand === "lowe's" && flavor === "red hot chicken") setSauce("Four Hands Red Hot Recipe");
    if (brand === "hannaford" && flavor === "four cheese with sweet & spicy chili sauce") setWeight(5.7, 12);
    if (brand === "lucia's craft" && flavor === "house dlux") setWeight(5.7, 12);
    return changed;
  });
  const deletedAliases = await tx.delete(specImportAliasesTable).where(and(eq(specImportAliasesTable.kind, "recipeName"), eq(sql`lower(${specImportAliasesTable.externalName})`, "masa recipe"), eq(sql`lower(${specImportAliasesTable.canonicalName})`, "masa recipe natural"))).returning({ id: specImportAliasesTable.id });
  const existing = await tx.select({ id: specImportAliasesTable.id }).from(specImportAliasesTable).where(and(eq(specImportAliasesTable.kind, "recipeName"), eq(sql`lower(${specImportAliasesTable.externalName})`, "naan recipe")));
  let addedAliases = 0;
  if (!existing.length) { await tx.insert(specImportAliasesTable).values({ scope: "live", kind: "recipeName", externalName: "Naan recipe", canonicalName: "Naan Dough", context: "dough" }); addedAliases = 1; }
  return { healedProfiles, deletedAliases: deletedAliases.length, addedAliases };
});

export const JULY_2026_AUDIT_CORRECTIONS_V2_REPAIR_ID = "july-2026-audit-corrections-v2";
export const july2026AuditCorrectionsV2Repair = definition(JULY_2026_AUDIT_CORRECTIONS_V2_REPAIR_ID, async (tx) => {
  const deletedAliases = await tx.delete(specImportAliasesTable).where(and(eq(specImportAliasesTable.kind, "recipeName"), eq(sql`lower(${specImportAliasesTable.externalName})`, "al pastor sauce"), eq(sql`lower(${specImportAliasesTable.canonicalName})`, "tikka masala sauce"))).returning({ id: specImportAliasesTable.id });
  const healedProfiles = await repairProfiles(tx, (brand, flavor, v) => {
    let changed = false; const set = (value: unknown) => { v.targetDoughballWeight = value; changed = true; };
    if (brand === "brand" && flavor === "mr07ch24" && Math.abs(Number(v.targetDoughballWeight ?? 0) - 5) < .05) set(6.2);
    if (brand === "brand" && flavor === "mr12ch14" && Math.abs(Number(v.targetDoughballWeight ?? 0) - 5) < .05) set(14.2);
    if (brand === "hannaford" && flavor === "chicken tikka masala" && !(Number(v.targetDoughballWeight ?? 0) > 0)) set(11.5);
    if (brand === "lowe's" && flavor === "red hot chicken" && String(v.frontlineRecipeName ?? "").trim() === "Four Hands Red Hot Recipe") { v.frontlineRecipeName = "Four Hands Red Hot Pizza Sauce"; changed = true; }
    if (brand === "lowe's" && flavor === "buffalo chicken" && !String(v.frontlineRecipeName ?? "").trim()) { v.frontlineRecipeName = "Buffalo Sauce"; changed = true; }
    if (brand === "lowe's" && flavor === "margherita" && !String(v.frontlineRecipeName ?? "").trim()) { v.frontlineRecipeName = "Lucia Pizza Sauce"; changed = true; }
    if (brand === "lucia's pinsa (proof)" && flavor === "chicken tikka masala" && String(v.frontlineRecipeName ?? "").toLowerCase().includes("masala sauce (rasoi)")) { v.frontlineRecipeName = "Tikka Masala Sauce"; changed = true; }
    return changed;
  });
  const existing = await tx.select({ id: sauceRecipesTable.id }).from(sauceRecipesTable).where(eq(sql`lower(${sauceRecipesTable.name})`, "al pastor sauce")); let addedSauces = 0;
  if (!existing.length) { await tx.insert(sauceRecipesTable).values({ id: "al-pastor-sauce", scope: "live", name: "Al Pastor Sauce", notes: "", components: [], enabled: true, brand: "", flavors: [] }); addedSauces = 1; }
  return { healedProfiles, deletedAliases: deletedAliases.length, addedSauces };
});

export const JULY_2026_AUDIT_CORRECTIONS_V3_REPAIR_ID = "july-2026-audit-corrections-v3";
export const july2026AuditCorrectionsV3Repair = definition(JULY_2026_AUDIT_CORRECTIONS_V3_REPAIR_ID, async (tx) => ({
  healedProfiles: await repairProfiles(tx, (brand, flavor, v) => {
    if (String(v.doughRecipeName ?? "").trim() === "Thick Malted Barley recipe" && !(Number(v.targetDoughballWeight ?? 0) > 0)) { v.targetDoughballWeight = 13.8; return true; }
    if (brand === "lowe's" && flavor === "spinach & mushroom" && !String(v.frontlineRecipeName ?? "").trim()) { v.frontlineRecipeName = "Lucia's Sauce"; return true; }
    return false;
  }),
}));

export const SYNC_ROW_NAME_REGISTRY_RESTORE_REPAIR_ID = "sync-row-name-registry-restore-v1";
export const syncRowNameRegistryRestoreRepair = definition(SYNC_ROW_NAME_REGISTRY_RESTORE_REPAIR_ID, async (tx) => {
  const date = new Date(); const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const [row] = await tx.select().from(dailySyncTable).where(and(eq(dailySyncTable.date, today), eq(dailySyncTable.scope, "live")));
  if (!row) return { skipped: "no live sync row for today" };
  const data = (row.data ?? {}) as Values;
  if (Array.isArray(data.brands) && data.brands.length) return { skipped: "brands already populated" };
  const profiles = await tx.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, "live"));
  const cheese = await tx.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, "live"));
  const mixes = await tx.select().from(mixesTable).where(eq(mixesTable.scope, "live"));
  const dough = await tx.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, "live"));
  const sauces = await tx.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, "live"));
  const brandFlavors: Record<string, string[]> = {}; const brands = new Set<string>();
  for (const p of profiles) if (p.brand) { brands.add(p.brand); if (p.flavor) brandFlavors[p.brand] = [...(brandFlavors[p.brand] ?? []), p.flavor]; }
  for (const flavors of Object.values(brandFlavors)) flavors.sort((a, b) => a.localeCompare(b));
  const names = (rows: Array<{ name: string }>) => [...new Set(rows.map((r) => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const result = { brands: [...brands].sort((a, b) => a.localeCompare(b)), cheeseRecipeNames: names(cheese), mixRecipeNames: names(mixes), doughRecipeNames: names(dough), frontlineRecipeNames: names(sauces) };
  await tx.update(dailySyncTable).set({ data: { ...data, ...result, brandFlavors }, updatedAt: new Date() }).where(and(eq(dailySyncTable.date, today), eq(dailySyncTable.scope, "live")));
  return { brands: result.brands.length, cheeseRecipeNames: result.cheeseRecipeNames.length, mixRecipeNames: result.mixRecipeNames.length, doughRecipeNames: result.doughRecipeNames.length, frontlineRecipeNames: result.frontlineRecipeNames.length };
});

export const FRESH_DEVICE_RUN_CONTAMINATION_REPAIR_ID = "fresh-device-run-contamination-v1";
const isRecord = (value: unknown): value is Values => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : isRecord(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value) ?? "null";
export function findVerifiedFreshDeviceCopiedRunIds(data: unknown): { duplicateRunIds: string[]; ambiguousCandidates: number } {
  if (!isRecord(data) || !isRecord(data.dayState) || !Array.isArray(data.dayState.runs) || !isRecord(data.runValues)) return { duplicateRunIds: [], ambiguousCandidates: 0 };
  const named = new Map<string, string[]>(), unnamed = new Map<string, string[]>();
  for (const run of data.dayState.runs) if (isRecord(run) && typeof run.id === "string" && isRecord(data.runValues[run.id])) {
    const v = data.runValues[run.id] as Values;
    const material = !!finite(v.casesNeeded) && (
      (finite(v.pizzasPerCase) ?? 0) > 0 ||
      ["doughRecipe", "frontlineRecipe", "app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe"].some((key) => Array.isArray(v[key]) && v[key].length > 0) ||
      ["doughRecipeName", "frontlineRecipeName", "app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"].some((key) => typeof v[key] === "string" && String(v[key]).trim())
    );
    if (!material) continue; const target = !String(run.brand ?? "").trim() && !String(run.flavor ?? "").trim() && !String(run.notes ?? "").trim() && run.startedAt == null && run.endedAt == null && run.pausedAt == null && run.actualCases == null && run.wasteLbs == null && (!Array.isArray(run.stoppages) || !run.stoppages.length) ? unnamed : (String(run.brand ?? "").trim() || String(run.flavor ?? "").trim() ? named : undefined);
    if (target) target.set(stable(v), [...(target.get(stable(v)) ?? []), run.id]);
  }
  const duplicateRunIds: string[] = []; let ambiguousCandidates = 0;
  for (const [signature, ids] of unnamed) { const sources = named.get(signature) ?? []; if (ids.length === 1 && sources.length === 1) duplicateRunIds.push(ids[0]); else ambiguousCandidates += ids.length; }
  return { duplicateRunIds, ambiguousCandidates };
}
export const freshDeviceRunContaminationRepair = definition(FRESH_DEVICE_RUN_CONTAMINATION_REPAIR_ID, async (tx) => {
  const days = await tx.select().from(dailySyncTable).where(gte(dailySyncTable.date, "2026-08-20")).for("update"); let healedDays = 0, removedRuns = 0, ambiguousCandidates = 0; const now = Date.now();
  for (const day of days) { const data = day.data as Values; const found = findVerifiedFreshDeviceCopiedRunIds(data); ambiguousCandidates += found.ambiguousCandidates; if (!found.duplicateRunIds.length || !isRecord(data?.dayState) || !Array.isArray(data.dayState.runs)) continue;
    const removed = new Set(found.duplicateRunIds), runValues = { ...(isRecord(data.runValues) ? data.runValues : {}) }, runValuesUpdatedAt = { ...(isRecord(data.runValuesUpdatedAt) ? data.runValuesUpdatedAt : {}) }, deletedItems = { ...(isRecord(data.deletedItems) ? data.deletedItems : {}) }, deletedStamps = { ...(isRecord(data.deletedStamps) ? data.deletedStamps : {}) }, stamps = { ...(isRecord(deletedStamps.runs) ? deletedStamps.runs : {}) };
    for (const id of removed) { delete runValues[id]; delete runValuesUpdatedAt[id]; stamps[id.toLowerCase()] = Math.max(finite(stamps[id.toLowerCase()]) ?? 0, now) + 1; }
    deletedItems.runs = [...new Set([...(Array.isArray(deletedItems.runs) ? deletedItems.runs.filter((id): id is string => typeof id === "string") : []), ...found.duplicateRunIds.map((id) => id.toLowerCase())])]; deletedStamps.runs = stamps;
    await tx.update(dailySyncTable).set({ data: { ...data, dayState: { ...data.dayState, runs: data.dayState.runs.filter((run) => !isRecord(run) || typeof run.id !== "string" || !removed.has(run.id)) }, runValues, runValuesUpdatedAt, deletedItems, deletedStamps }, updatedAt: new Date() }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope))); healedDays++; removedRuns += found.duplicateRunIds.length;
  }
  return { scannedDays: days.length, healedDays, removedRuns, ambiguousCandidates };
});