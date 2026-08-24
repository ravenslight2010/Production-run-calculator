import { and, desc, eq, gt } from "drizzle-orm";
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
  savedSpecSheetsTable,
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
  disposition: "valid" | "stale" | "defect";
  owner: "master-data" | "inventory" | "import-review";
  dispositionReason: string;
};

export type MasterDataHealthReport = {
  scanId: string;
  scope: string;
  environment: "development" | "live";
  scannedAt: string;
  findings: MasterDataHealthFinding[];
  groups: Record<HealthSeverity, MasterDataHealthFinding[]>;
  summary: Record<HealthCategory | HealthSeverity | "total", number>;
  repairs: Array<
    | { findingId: string; action: "delete-alias"; category: "aliases"; source: "import" | "spec" | "merge"; rowId: number }
    | { findingId: string; action: "update-profile-recipe-link"; category: "profiles"; profileKey: string; field: string; from: string; to: string; source: "saved-spec" | "spec-alias" }
  >;
};

const key = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const asRows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
  : [];
const scanId = (scope: string, at: Date) => `master-data:${scope}:${at.toISOString()}`;

function finding(
  scope: string,
  category: HealthCategory,
  severity: HealthSeverity,
  stableKey: string,
  message: string,
  repairable = false,
  protectedValue = true,
  disposition: MasterDataHealthFinding["disposition"] = "defect",
  owner: MasterDataHealthFinding["owner"] = "master-data",
  dispositionReason = "Requires manager review before any value is changed.",
): MasterDataHealthFinding {
  return {
    id: `${category}:${stableKey}`,
    category,
    severity,
    stableKey,
    message,
    repairable,
    protectedValue,
    scope,
    disposition,
    owner,
    dispositionReason,
  };
}

function duplicateFindings<T>(rows: T[], nameOf: (row: T) => string, make: (name: string, index: number) => MasterDataHealthFinding): MasterDataHealthFinding[] {
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const name = key(nameOf(row));
    if (!name) return;
    const first = seen.get(name);
    // One finding represents one duplicate-name group. Emitting one finding
    // for every extra row produced repeated IDs and inflated the health count.
    if (first !== undefined) return;
    else seen.set(name, index);
  });
  return Array.from(seen.entries())
    .filter(([name]) => rows.filter((row) => key(nameOf(row)) === name).length > 1)
    .map(([name, index]) => make(name, index));
}

export async function buildMasterDataHealthReport(executor: Executor, scope: string, at = new Date()): Promise<MasterDataHealthReport> {
  const [profiles, dough, sauce, cheese, mixes, ingredients, importAliases, specAliases, mergeAliases, sheets, days] = await Promise.all([
    executor.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, scope)),
    executor.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
    executor.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
    executor.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)),
    executor.select().from(mixesTable).where(eq(mixesTable.scope, scope)),
    executor.select().from(ingredientsTable).where(eq(ingredientsTable.scope, scope)),
    executor.select().from(importAliasesTable).where(eq(importAliasesTable.scope, scope)),
    executor.select().from(specImportAliasesTable).where(eq(specImportAliasesTable.scope, scope)),
    executor.select().from(mergeAliasesTable).where(eq(mergeAliasesTable.scope, scope)),
    executor.select().from(savedSpecSheetsTable).where(eq(savedSpecSheetsTable.scope, scope)).orderBy(desc(savedSpecSheetsTable.createdAt)),
    executor.select().from(dailySyncTable).where(and(eq(dailySyncTable.scope, scope), gt(dailySyncTable.date, at.toISOString().slice(0, 10)))),
  ]);
  const out: MasterDataHealthFinding[] = [];
  const profileKeys = new Set(profiles.map((p) => `${key(p.brand)}\u0000${key(p.flavor)}`));
  const recipeNames = new Set([...dough, ...sauce, ...cheese, ...mixes].map((r) => key(r.name)));
  const savedProfileNames = new Map<string, { dough?: string; sauce?: string }>();
  for (const sheet of sheets) {
    const data = sheet.data && typeof sheet.data === "object" ? sheet.data as Record<string, unknown> : {};
    const parsed = Array.isArray(data.profiles) ? data.profiles : [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const profileKey = `${key(item.brand)}\u0000${key(item.flavor)}`;
      if (savedProfileNames.has(profileKey)) continue;
      savedProfileNames.set(profileKey, {
        dough: typeof item.doughName === "string" ? item.doughName.trim() : undefined,
        sauce: typeof item.sauceName === "string" ? item.sauceName.trim() : undefined,
      });
    }
  }
  const profileRepairs: MasterDataHealthReport["repairs"] = [];
  const confirmedLinks = new Map<string, { to: string; source: "saved-spec" | "spec-alias" }>([
    ["aldo's__sausage\u0000frontlineRecipeName\u0000aldo's sauce (made in house)", { to: "Aldo's Sauce", source: "saved-spec" as const }],
    ...["5 cheese", "bbq chicken", "hawaiian", "ultimate pepperoni"].map((flavor) => [
      `basha's ultra thin crust\u0000${flavor}\u0000doughRecipeName\u000011" crb recipe`,
      { to: "CRB Dough", source: "spec-alias" as const },
    ] as const),
  ]);

  profiles.forEach((p) => {
    const stable = key(p.key || `${p.brand}__${p.flavor}`);
    if (!key(p.brand) || !key(p.flavor)) out.push(finding(scope, "profiles", "error", stable || `row:${p.key}`, "Profile has no usable brand and flavor identity."));
    const values = p.values && typeof p.values === "object" ? p.values as Record<string, unknown> : {};
    for (const field of ["doughRecipeName", "frontlineRecipeName"]) {
      const name = key(values[field]);
      if (name && !recipeNames.has(name)) {
        const findingId = `${stable}:${field}:${name}`;
        const confirmed = confirmedLinks.get(`${key(p.brand)}\u0000${key(p.flavor)}\u0000${field}\u0000${name}`);
        const saved = savedProfileNames.get(`${key(p.brand)}\u0000${key(p.flavor)}`);
        const savedName = field === "doughRecipeName" ? saved?.dough : saved?.sauce;
        const sourceConfirmed = confirmed && (
          confirmed.source === "spec-alias" ||
          key(savedName) === key(confirmed.to) ||
          (confirmed.source === "saved-spec" && key(savedName) === "aldo's sauce")
        );
        if (sourceConfirmed && recipeNames.has(key(confirmed.to))) {
          out.push(finding(scope, "profiles", "warning", findingId, `Profile references missing ${field} "${String(values[field])}"; confirmed source resolves it to "${confirmed.to}".`, true, true, "stale", "import-review", "A saved import or confirmed alias provides the replacement; a manager must explicitly apply the selected repair."));
          profileRepairs.push({ findingId, action: "update-profile-recipe-link", category: "profiles", profileKey: p.key, field, from: String(values[field]), to: confirmed.to, source: confirmed.source });
        } else {
          out.push(finding(scope, "profiles", "error", findingId, `Profile references missing ${field} "${String(values[field])}".`, false, true, "stale", "import-review", "The stored link predates or differs from the current recipe pool; preserve it until the source import or manager confirms the replacement."));
        }
      }
    }
  });

  const inspectRecipes = (category: "dough" | "sauce" | "cheese" | "mixes", rows: Array<{ id: string; name: string; components: unknown; enabled: boolean }>) => {
    rows.forEach((row) => {
      const components = asRows(row.components);
      const hasPositive = components.some((component) => positive(component.lbs) || positive(component.perPizza));
      // Sauce rows with no formula are bought as-is. Cheese recipes imported
      // from regular spec sheets intentionally store ratio shares while lbs
      // remains zero; neither is a missing formula.
      const hasPositiveShare = components.some((component) => positive(component.sharePct));
      const isValidEmpty = category === "sauce" && !components.length
        || category === "cheese" && hasPositiveShare;
      if (row.enabled && (!components.length || !hasPositive) && !isValidEmpty) {
        out.push(finding(scope, category, "error", `${key(row.name)}:${row.id}`, `Enabled ${category} recipe "${row.name}" has no positive component values.`, false, true, "defect", "master-data", "The enabled recipe has neither a usable formula nor the documented buy-as-is/ratio representation."));
       }
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
  return { scanId: scanId(scope, at), scope, environment, scannedAt: at.toISOString(), findings: out, groups, summary, repairs: [...profileRepairs, ...repairs] };
}

export async function runMasterDataHealthScan(
  scope: string,
  options: { maxAgeMs?: number } = {},
): Promise<MasterDataHealthReport> {
  if (options.maxAgeMs !== undefined) {
    const [latest] = await db.select().from(masterDataHealthScansTable)
      .where(eq(masterDataHealthScansTable.scope, scope))
      .orderBy(desc(masterDataHealthScansTable.completedAt)).limit(1);
    if (latest?.completedAt && Date.now() - latest.completedAt.getTime() < options.maxAgeMs) {
      return latest.report as MasterDataHealthReport;
    }
  }
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
