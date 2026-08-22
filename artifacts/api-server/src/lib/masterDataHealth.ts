import { and, eq, gt } from "drizzle-orm";
import {
  db,
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  doughRecipesTable,
  ingredientsTable,
  importAliasesTable,
  masterDataHealthScansTable,
  mergeAliasesTable,
  mixesTable,
  sauceRecipesTable,
  specImportAliasesTable,
} from "@workspace/db";

type Executor = Pick<typeof db, "select">;
export type HealthSeverity = "error" | "warning" | "info";
export type HealthCategory = "profiles" | "dough" | "sauce" | "cheese" | "mixes" | "ingredients" | "aliases" | "scheduled-runs";

export type MasterDataHealthFinding = {
  id: string;
  category: HealthCategory;
  severity: HealthSeverity;
  stableKey: string;
  message: string;
  repairable: boolean;
  protectedValue: boolean;
  scope: string;
};

export type MasterDataHealthReport = {
  scanId: string;
  scope: string;
  environment: "development" | "live";
  scannedAt: string;
  findings: MasterDataHealthFinding[];
  groups: Record<HealthSeverity, MasterDataHealthFinding[]>;
  summary: Record<HealthCategory | HealthSeverity | "total", number>;
  repairs: Array<{ findingId: string; action: "delete-alias"; category: "aliases"; source: "import" | "spec" | "merge"; rowId: number }>;
};

const key = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const asRows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
  : [];
const scanId = (scope: string, at: Date) => `master-data:${scope}:${at.toISOString()}`;

function finding(scope: string, category: HealthCategory, severity: HealthSeverity, stableKey: string, message: string, repairable = false, protectedValue = true): MasterDataHealthFinding {
  return { id: `${category}:${stableKey}`, category, severity, stableKey, message, repairable, protectedValue, scope };
}

function duplicateFindings<T>(rows: T[], nameOf: (row: T) => string, make: (name: string, index: number) => MasterDataHealthFinding): MasterDataHealthFinding[] {
  const seen = new Map<string, number>();
  const out: MasterDataHealthFinding[] = [];
  rows.forEach((row, index) => {
    const name = key(nameOf(row));
    if (!name) return;
    const first = seen.get(name);
    if (first !== undefined) out.push(make(name, index));
    else seen.set(name, index);
  });
  return out;
}

export async function buildMasterDataHealthReport(executor: Executor, scope: string, at = new Date()): Promise<MasterDataHealthReport> {
  const [profiles, dough, sauce, cheese, mixes, ingredients, importAliases, specAliases, mergeAliases, days] = await Promise.all([
    executor.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, scope)),
    executor.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
    executor.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
    executor.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)),
    executor.select().from(mixesTable).where(eq(mixesTable.scope, scope)),
    executor.select().from(ingredientsTable).where(eq(ingredientsTable.scope, scope)),
    executor.select().from(importAliasesTable).where(eq(importAliasesTable.scope, scope)),
    executor.select().from(specImportAliasesTable).where(eq(specImportAliasesTable.scope, scope)),
    executor.select().from(mergeAliasesTable).where(eq(mergeAliasesTable.scope, scope)),
    executor.select().from(dailySyncTable).where(and(eq(dailySyncTable.scope, scope), gt(dailySyncTable.date, at.toISOString().slice(0, 10)))),
  ]);
  const out: MasterDataHealthFinding[] = [];
  const profileKeys = new Set(profiles.map((p) => `${key(p.brand)}\u0000${key(p.flavor)}`));
  const recipeNames = new Set([...dough, ...sauce, ...cheese, ...mixes].map((r) => key(r.name)));

  profiles.forEach((p) => {
    const stable = key(p.key || `${p.brand}__${p.flavor}`);
    if (!key(p.brand) || !key(p.flavor)) out.push(finding(scope, "profiles", "error", stable || `row:${p.key}`, "Profile has no usable brand and flavor identity."));
    const values = p.values && typeof p.values === "object" ? p.values as Record<string, unknown> : {};
    for (const field of ["doughRecipeName", "frontlineRecipeName"]) {
      const name = key(values[field]);
      if (name && !recipeNames.has(name)) out.push(finding(scope, "profiles", "error", `${stable}:${field}:${name}`, `Profile references missing ${field} "${String(values[field])}".`));
    }
  });

  const inspectRecipes = (category: "dough" | "sauce" | "cheese" | "mixes", rows: Array<{ id: string; name: string; components: unknown; enabled: boolean }>) => {
    rows.forEach((row) => {
      const components = asRows(row.components);
      const hasPositive = components.some((component) => positive(component.lbs) || positive(component.perPizza));
      if (row.enabled && (!components.length || !hasPositive)) out.push(finding(scope, category, "error", `${key(row.name)}:${row.id}`, `Enabled ${category} recipe "${row.name}" has no positive component values.`));
    });
    out.push(...duplicateFindings(rows, (row) => row.name, (name) => finding(scope, category, "warning", `duplicate:${name}`, `Multiple ${category} pool rows use the name "${name}".`)));
  };
  inspectRecipes("dough", dough);
  inspectRecipes("sauce", sauce);
  inspectRecipes("cheese", cheese);
  inspectRecipes("mixes", mixes);
  dough.forEach((row) => asRows(row.doughballVariants).forEach((variant, index) => {
    if (!key(variant.label) || (!positive(variant.weightOz) && !positive(variant.perTray))) {
      out.push(finding(scope, "dough", "warning", `variant:${row.id}:${index}`, `Dough recipe "${row.name}" contains an unusable variant.`, false, true));
    }
  }));

  ingredients.forEach((row) => {
    if (!key(row.name)) out.push(finding(scope, "ingredients", "error", `blank:${row.id}`, "Ingredient has no usable name."));
    if (row.mergedInto && row.mergedInto === row.id) out.push(finding(scope, "ingredients", "error", `self-merge:${row.id}`, "Ingredient points to itself as its merge target."));
  });
  out.push(...duplicateFindings(ingredients, (row) => row.name, (name) => finding(scope, "ingredients", "warning", `duplicate:${name}`, `Multiple ingredient rows use the name "${name}".`)));

  const repairs: MasterDataHealthReport["repairs"] = [];
  for (const [source, aliases] of [
    ["import", importAliases], ["spec", specAliases], ["merge", mergeAliases],
  ] as const) {
    aliases.forEach((alias) => {
      const external = key("externalName" in alias ? alias.externalName : "");
      const canonical = key("canonicalName" in alias ? alias.canonicalName : "");
      if (!external || !canonical || external === canonical) {
        const id = `${source}:${alias.id}`;
        out.push(finding(scope, "aliases", "warning", id, "Alias is blank or maps a name to itself.", true, false));
        repairs.push({ findingId: `aliases:${id}`, action: "delete-alias", category: "aliases", source, rowId: alias.id });
      }
    });
  }
  for (const day of days) {
    const data = day.data && typeof day.data === "object" ? day.data as Record<string, unknown> : {};
    const state = data.dayState && typeof data.dayState === "object" ? data.dayState as Record<string, unknown> : {};
    const runs = Array.isArray(state.runs) ? state.runs : [];
    runs.forEach((raw, index) => {
      const run = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const brand = key(run.brand), flavor = key(run.flavor);
      if (!brand || !flavor || !profileKeys.has(`${brand}\u0000${flavor}`)) {
        out.push(finding(scope, "scheduled-runs", "error", `${day.date}:${String(run.id ?? index)}`, `Scheduled run on ${day.date} has no matching setup profile.`, false, true));
      }
    });
  }

  const environment = scope === "live" ? "live" : "development";
  const groups: MasterDataHealthReport["groups"] = { error: [], warning: [], info: [] };
  out.sort((a, b) => a.id.localeCompare(b.id)).forEach((item) => groups[item.severity].push(item));
  const summary = { total: out.length, error: groups.error.length, warning: groups.warning.length, info: groups.info.length } as MasterDataHealthReport["summary"];
  for (const category of ["profiles", "dough", "sauce", "cheese", "mixes", "ingredients", "aliases", "scheduled-runs"] as const) summary[category] = out.filter((item) => item.category === category).length;
  return { scanId: scanId(scope, at), scope, environment, scannedAt: at.toISOString(), findings: out, groups, summary, repairs };
}

export async function runMasterDataHealthScan(scope: string): Promise<MasterDataHealthReport> {
  const startedAt = new Date();
  const report = await buildMasterDataHealthReport(db, scope, startedAt);
  await db.insert(masterDataHealthScansTable).values({
    id: report.scanId,
    scope,
    environment: report.environment,
    startedAt,
    completedAt: new Date(),
    status: "completed",
    report,
  });
  return report;
}
