import { and, desc, eq, gte, lte } from "drizzle-orm";
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
  importHistoryTable,
} from "@workspace/db";

type Executor = Pick<typeof db, "select">;
export type HealthSeverity = "error" | "warning" | "info";
export type HealthCategory = "profiles" | "dough" | "sauce" | "cheese" | "mixes" | "ingredients" | "aliases" | "scheduled-runs";
export type HealthClassification = "exact" | "canonical" | "ambiguous" | "orphaned";

export type MasterDataHealthCoverage = {
  dateWindow: { from: string; to: string };
  limits: {
    maxRowsPerTable: number;
    maxFindings: number;
    maxComponentRowsPerRecipe: number;
    maxJsonBytesPerDocument: number;
  };
  tables: Record<string, { scanned: number; truncated: boolean }>;
  payloadsTruncated: boolean;
  findingsTruncated: boolean;
  protectedHistory: {
    source: "import-history";
    scanned: number;
    truncated: boolean;
  };
};

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
  classification: HealthClassification;
  followUpDate?: string;
};

export type MasterDataHealthReport = {
  scanId: string;
  scope: string;
  environment: "development" | "live";
  scannedAt: string;
  findings: MasterDataHealthFinding[];
  groups: Record<HealthSeverity, MasterDataHealthFinding[]>;
  summary: Record<HealthCategory | HealthSeverity | "total", number>;
  coverage: MasterDataHealthCoverage;
  repairs: Array<
    | {
      findingId: string;
      action: "delete-alias";
      category: "aliases";
      source: "import" | "spec" | "merge";
      rowId: number;
      externalName: string;
      canonicalName: string;
      context: string | null;
      fingerprint: string;
      owner: "import-review";
      preview: { before: string; after: string };
      undo: "data-health-repair-batch";
    }
    | {
      findingId: string;
      action: "update-profile-recipe-link";
      category: "profiles";
      profileKey: string;
      field: string;
      from: string;
      to: string;
      source: "saved-spec" | "spec-alias";
      fingerprint: string;
      owner: "import-review";
      preview: { before: string; after: string };
      undo: "data-health-repair-batch";
    }
  >;
};

const key = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const MAX_ROWS_PER_TABLE = 2_000;
const MAX_FINDINGS = 2_000;
const MAX_COMPONENT_ROWS_PER_RECIPE = 500;
const MAX_JSON_BYTES_PER_DOCUMENT = 256 * 1024;
const AUDIT_HISTORY_DAYS = 365;
const FUTURE_AUDIT_DAYS = 30;
const asRows = (value: unknown, onTruncated?: () => void): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_COMPONENT_ROWS_PER_RECIPE) onTruncated?.();
  return value
    .slice(0, MAX_COMPONENT_ROWS_PER_RECIPE)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
};
const scanId = (scope: string, at: Date) => `master-data:${scope}:${at.toISOString()}`;
const HEALTH_REVIEW_DATE = "2026-09-30";
const ACCEPTED_EMPTY_RECIPES = new Set([
  "dough:aldo's recipe",
  "dough:bonici 12\"",
  "dough:bonici 9\"",
  "dough:brand recipe",
  // Purchased crusts intentionally have no in-house formula. Keep these
  // visible for periodic setup review without treating them as defects.
  "dough:pedone crust 7\"x12\" oval",
  "dough:pinsa 12\" crust - pedone (wbf-1200-r)",
  "cheese:bbq chicken cheese mix",
  "cheese:lowe's/hannaford 5cheese mix",
  "mixes:bobo breakfast mix",
  "mixes:bobo's deluxe vegetable mix",
]);
const REVIEW_EMPTY_RECIPES = new Set([
  "dough:lucia's dough recipe",
]);

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
  classification: HealthClassification = disposition === "valid"
    ? "exact"
    : "orphaned",
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
    classification,
  };
}

function withFollowUp(
  item: MasterDataHealthFinding,
  followUpDate = HEALTH_REVIEW_DATE,
): MasterDataHealthFinding {
  return { ...item, followUpDate };
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

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateWindow(at: Date): { from: string; to: string } {
  const from = new Date(at.getTime() - AUDIT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const to = new Date(at.getTime() + FUTURE_AUDIT_DAYS * 24 * 60 * 60 * 1000);
  return { from: dateOnly(from), to: dateOnly(to) };
}

function boundedRecord(value: unknown, onTruncated: () => void): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_JSON_BYTES_PER_DOCUMENT) {
      onTruncated();
      return {};
    }
  } catch {
    onTruncated();
    return {};
  }
  return value as Record<string, unknown>;
}

function boundedRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, MAX_ROWS_PER_TABLE), truncated: rows.length > MAX_ROWS_PER_TABLE };
}

export function masterDataRepairFingerprint(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

type AliasCandidate = {
  id: number;
  externalName: string;
  canonicalName: string;
  context: string | null;
  namespace: string;
  source: "import" | "spec" | "merge";
};

function aliasResolution(
  alias: AliasCandidate,
  aliases: AliasCandidate[],
  names: Set<string>,
): HealthClassification | "stale" {
  const sameNamespace = aliases.filter((candidate) =>
    candidate.namespace === alias.namespace
    && key(candidate.context) === key(alias.context),
  );
  const nextByExternal = new Map<string, Set<string>>();
  for (const candidate of sameNamespace) {
    const external = key(candidate.externalName);
    const values = nextByExternal.get(external) ?? new Set<string>();
    values.add(key(candidate.canonicalName));
    nextByExternal.set(external, values);
  }
  const seen = new Set<string>();
  let current = key(alias.canonicalName);
  while (current && !seen.has(current)) {
    if (names.has(current)) return current === key(alias.canonicalName) ? "canonical" : "exact";
    seen.add(current);
    const next = nextByExternal.get(current);
    if (!next || next.size !== 1) return next && next.size > 1 ? "ambiguous" : "stale";
    current = [...next][0];
  }
  return "ambiguous";
}

export async function buildMasterDataHealthReport(executor: Executor, scope: string, at = new Date()): Promise<MasterDataHealthReport> {
  if (scope !== "live" && scope !== "sandbox") {
    throw new Error("Master-data health scans require a recognized data scope");
  }
  const window = dateWindow(at);
  const [profiles, dough, sauce, cheese, mixes, ingredients, importAliases, specAliases, mergeAliases, sheets, days] = await Promise.all([
    executor.select({
      key: brandProfilesTable.key, scope: brandProfilesTable.scope, brand: brandProfilesTable.brand,
      flavor: brandProfilesTable.flavor, values: brandProfilesTable.values, updatedAtMs: brandProfilesTable.updatedAtMs,
    }).from(brandProfilesTable).where(eq(brandProfilesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: doughRecipesTable.id, name: doughRecipesTable.name, components: doughRecipesTable.components,
      doughballVariants: doughRecipesTable.doughballVariants,
      enabled: doughRecipesTable.enabled,
    }).from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: sauceRecipesTable.id, name: sauceRecipesTable.name, components: sauceRecipesTable.components,
      enabled: sauceRecipesTable.enabled,
    }).from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: cheeseRecipesTable.id, name: cheeseRecipesTable.name, components: cheeseRecipesTable.components,
      enabled: cheeseRecipesTable.enabled,
    }).from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: mixesTable.id, name: mixesTable.name, components: mixesTable.components,
      enabled: mixesTable.enabled,
    }).from(mixesTable).where(eq(mixesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: ingredientsTable.id, name: ingredientsTable.name, enabled: ingredientsTable.enabled,
      mergedInto: ingredientsTable.mergedInto,
    }).from(ingredientsTable).where(eq(ingredientsTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: importAliasesTable.id, type: importAliasesTable.type, externalName: importAliasesTable.externalName,
      canonicalName: importAliasesTable.canonicalName, brandContext: importAliasesTable.brandContext,
    }).from(importAliasesTable).where(eq(importAliasesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: specImportAliasesTable.id, kind: specImportAliasesTable.kind, externalName: specImportAliasesTable.externalName,
      canonicalName: specImportAliasesTable.canonicalName, context: specImportAliasesTable.context,
    }).from(specImportAliasesTable).where(eq(specImportAliasesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({
      id: mergeAliasesTable.id, category: mergeAliasesTable.category, brand: mergeAliasesTable.brand,
      externalName: mergeAliasesTable.externalName, canonicalName: mergeAliasesTable.canonicalName,
    }).from(mergeAliasesTable).where(eq(mergeAliasesTable.scope, scope)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({ data: savedSpecSheetsTable.data, createdAt: savedSpecSheetsTable.createdAt })
      .from(savedSpecSheetsTable).where(eq(savedSpecSheetsTable.scope, scope))
      .orderBy(desc(savedSpecSheetsTable.createdAt)).limit(MAX_ROWS_PER_TABLE + 1),
    executor.select({ date: dailySyncTable.date, data: dailySyncTable.data })
      .from(dailySyncTable).where(and(
        eq(dailySyncTable.scope, scope),
        gte(dailySyncTable.date, window.from),
        lte(dailySyncTable.date, window.to),
      )).orderBy(desc(dailySyncTable.date)).limit(MAX_ROWS_PER_TABLE + 1),
  ]);
  const [history] = await Promise.all([
    executor.select({
      id: importHistoryTable.id, createdAt: importHistoryTable.createdAt,
      importType: importHistoryTable.importType, status: importHistoryTable.status,
    }).from(importHistoryTable).where(and(
      eq(importHistoryTable.scope, scope),
      gte(importHistoryTable.createdAt, new Date(`${window.from}T00:00:00.000Z`)),
      lte(importHistoryTable.createdAt, new Date(`${window.to}T23:59:59.999Z`)),
    )).orderBy(desc(importHistoryTable.createdAt)).limit(MAX_ROWS_PER_TABLE + 1),
  ]);
  const limited = {
    profiles: boundedRows(profiles), dough: boundedRows(dough), sauce: boundedRows(sauce),
    cheese: boundedRows(cheese), mixes: boundedRows(mixes), ingredients: boundedRows(ingredients),
    importAliases: boundedRows(importAliases), specAliases: boundedRows(specAliases),
    mergeAliases: boundedRows(mergeAliases), sheets: boundedRows(sheets), days: boundedRows(days),
    history: boundedRows(history),
  };
  const payloadState = { truncated: false };
  const coverage: MasterDataHealthCoverage = {
    dateWindow: window,
    limits: {
      maxRowsPerTable: MAX_ROWS_PER_TABLE,
      maxFindings: MAX_FINDINGS,
      maxComponentRowsPerRecipe: MAX_COMPONENT_ROWS_PER_RECIPE,
      maxJsonBytesPerDocument: MAX_JSON_BYTES_PER_DOCUMENT,
    },
    tables: Object.fromEntries(Object.entries(limited).map(([name, value]) => [
      name, { scanned: value.rows.length, truncated: value.truncated },
    ])),
    payloadsTruncated: false,
    findingsTruncated: false,
    protectedHistory: {
      source: "import-history",
      scanned: limited.history.rows.length,
      truncated: limited.history.truncated,
    },
  };
  const boundedData = (value: unknown) => boundedRecord(value, () => { payloadState.truncated = true; });
  const boundedComponents = (value: unknown) => asRows(value, () => { payloadState.truncated = true; });
  const profilesRows = limited.profiles.rows;
  const doughRows = limited.dough.rows;
  const sauceRows = limited.sauce.rows;
  const cheeseRows = limited.cheese.rows;
  const mixesRows = limited.mixes.rows;
  const ingredientsRows = limited.ingredients.rows;
  const importAliasRows = limited.importAliases.rows;
  const specAliasRows = limited.specAliases.rows;
  const mergeAliasRows = limited.mergeAliases.rows;
  const sheetRows = limited.sheets.rows;
  const dayRows = limited.days.rows;
  const out: MasterDataHealthFinding[] = [];
  const profileKeys = new Set(profilesRows.map((p) => `${key(p.brand)}\u0000${key(p.flavor)}`));
  const recipeNamesByKind = {
    dough: new Set(doughRows.map((r) => key(r.name))),
    sauce: new Set(sauceRows.map((r) => key(r.name))),
    cheese: new Set(cheeseRows.map((r) => key(r.name))),
    mixes: new Set(mixesRows.map((r) => key(r.name))),
  };
  const ingredientNames = new Set(ingredientsRows.map((row) => key(row.name)).filter(Boolean));
  const brandNames = new Set(profilesRows.map((profile) => key(profile.brand)).filter(Boolean));
  const flavorNames = new Set(profilesRows.map((profile) => key(profile.flavor)).filter(Boolean));
  const savedProfileNames = new Map<string, { dough?: string; sauce?: string }>();
  for (const sheet of sheetRows) {
    const data = boundedData(sheet.data);
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

  profilesRows.forEach((p) => {
    const stable = key(p.key || `${p.brand}__${p.flavor}`);
    if (!key(p.brand) || !key(p.flavor)) out.push(withFollowUp(finding(
      scope,
      "profiles",
      "warning",
      stable || `row:${p.key}`,
      "Profile has no usable brand and flavor identity.",
      false,
      true,
      "stale",
      "import-review",
      "This legacy brand-level setup record is retained for its operational defaults; an import-review owner must assign a product identity before it is used for a scheduled run.",
    )));
    const values = boundedData(p.values);
    for (const field of ["doughRecipeName", "frontlineRecipeName"]) {
      const name = key(values[field]);
      const recipeKind = field === "doughRecipeName" ? "dough" : "sauce";
      const matchingRows = recipeKind === "dough"
        ? doughRows.filter((row) => key(row.name) === name)
        : sauceRows.filter((row) => key(row.name) === name);
      if (name && matchingRows.length === 0) {
        const findingId = `${stable}:${field}:${name}`;
        const confirmed = confirmedLinks.get(`${key(p.brand)}\u0000${key(p.flavor)}\u0000${field}\u0000${name}`);
        const saved = savedProfileNames.get(`${key(p.brand)}\u0000${key(p.flavor)}`);
        const savedName = field === "doughRecipeName" ? saved?.dough : saved?.sauce;
        const sourceConfirmed = confirmed && (
          confirmed.source === "spec-alias" ||
          key(savedName) === key(confirmed.to) ||
          (confirmed.source === "saved-spec" && key(savedName) === "aldo's sauce")
        );
        if (sourceConfirmed && recipeNamesByKind[recipeKind].has(key(confirmed.to))) {
          out.push(finding(scope, "profiles", "warning", findingId, `Profile references missing ${field} "${String(values[field])}"; confirmed source resolves it to "${confirmed.to}".`, true, true, "stale", "import-review", "A saved import or confirmed alias provides the replacement; a manager must explicitly apply the selected repair."));
          profileRepairs.push({
            findingId,
            action: "update-profile-recipe-link",
            category: "profiles",
            profileKey: p.key,
            field,
            from: String(values[field]),
            to: confirmed.to,
            source: confirmed.source,
            fingerprint: masterDataRepairFingerprint({
              profileKey: p.key, field, from: String(values[field]), to: confirmed.to, source: confirmed.source,
            }),
            owner: "import-review",
            preview: { before: String(values[field]), after: confirmed.to },
            undo: "data-health-repair-batch",
          });
        } else {
          out.push(withFollowUp(finding(scope, "profiles", "warning", findingId, `Profile references missing ${field} "${String(values[field])}".`, false, true, "stale", "import-review", "The stored link predates or differs from the current recipe pool; preserve it until the source import or manager confirms the replacement.", "orphaned")));
        }
      } else if (name && matchingRows.length > 1) {
        out.push(withFollowUp(finding(scope, "profiles", "warning", `${stable}:${field}:${name}:ambiguous`, `Profile link "${String(values[field])}" resolves to multiple ${recipeKind} pool rows.`, false, true, "valid", "master-data", "A duplicate display name makes the intended protected recipe row ambiguous; manager review is required.", "ambiguous")));
      }
    }
  });

  const inspectRecipes = (category: "dough" | "sauce" | "cheese" | "mixes", rows: Array<{ id: string; name: string; components: unknown; enabled: boolean }>) => {
    rows.forEach((row) => {
      const components = boundedComponents(row.components);
      const hasPositive = components.some((component) => positive(component.lbs) || positive(component.perPizza));
      // Sauce rows with no formula are bought as-is. Cheese recipes imported
      // from regular spec sheets intentionally store ratio shares while lbs
      // remains zero; neither is a missing formula.
      const hasPositiveShare = components.some((component) => positive(component.sharePct));
      const isValidEmpty = category === "sauce" && !components.length
        || category === "cheese" && hasPositiveShare;
       if (row.enabled && (!components.length || !hasPositive) && !isValidEmpty) {
         const stableName = key(row.name);
         const accepted = ACCEPTED_EMPTY_RECIPES.has(`${category}:${stableName}`);
         const reviewOnly = REVIEW_EMPTY_RECIPES.has(`${category}:${stableName}`);
         out.push(withFollowUp(finding(
           scope,
           category,
           accepted || reviewOnly ? "warning" : "error",
           `${stableName}:${row.id}`,
           accepted || reviewOnly
             ? `Enabled ${category} recipe "${row.name}" is an approved empty/placeholder record pending manager setup.`
             : `Enabled ${category} recipe "${row.name}" has no positive component values.`,
           false,
           true,
           accepted || reviewOnly ? "valid" : "defect",
           "master-data",
           accepted || reviewOnly
             ? "The source import provides no authoritative formula. Preserve this protected record; the master-data owner must confirm a formula or disable it by the review date."
             : "The enabled recipe has neither a usable formula nor the documented buy-as-is/ratio representation.",
         )));
       }
     components.forEach((component, index) => {
       const ingredient = String(component.ingredient ?? component.name ?? "").trim();
       if (!ingredient) {
         out.push(withFollowUp(finding(scope, category, "warning", `orphan-component:${row.id}:${index}`, `Recipe "${row.name}" contains a component without an ingredient name.`, false, true, "defect", "master-data", "The component cannot be matched to the ingredient catalog; preserve it for manager review.", "orphaned")));
       } else if (!ingredientNames.has(key(ingredient))) {
         out.push(withFollowUp(finding(scope, category, "warning", `orphan-component:${row.id}:${index}:${key(ingredient)}`, `Recipe "${row.name}" references ingredient "${ingredient}", which is not in the current ingredient catalog.`, false, true, "stale", "master-data", "The reference may be historical or intentionally retired; do not replace it automatically.", "orphaned")));
       }
     });
     out.push(...duplicateFindings(rows, (row) => row.name, (name) => withFollowUp(finding(
      scope,
      category,
      "warning",
      `duplicate:${name}`,
      `Multiple ${category} pool rows use the name "${name}".`,
      false,
      true,
       "valid",
      "master-data",
       "Duplicate display names are retained until a manager confirms which protected recipe row is canonical.",
       "ambiguous",
    ))));
    });
  };
  inspectRecipes("dough", doughRows);
  inspectRecipes("sauce", sauceRows);
  inspectRecipes("cheese", cheeseRows);
  inspectRecipes("mixes", mixesRows);
  doughRows.forEach((row) => asRows((row as typeof row & { doughballVariants?: unknown }).doughballVariants, () => { payloadState.truncated = true; }).forEach((variant, index) => {
    if (!key(variant.label) || (!positive(variant.weightOz) && !positive(variant.perTray))) {
      out.push(withFollowUp(finding(
        scope,
        "dough",
        "warning",
        `variant:${row.id}:${index}`,
        `Dough recipe "${row.name}" contains an unusable variant.`,
        false,
        true,
        "stale",
        "master-data",
        "The variant lacks enough information for automatic calculation; preserve the recipe and have the master-data owner confirm its weight or tray capacity.",
      )));
    }
  }));

  ingredientsRows.forEach((row) => {
    if (!key(row.name)) out.push(finding(scope, "ingredients", "error", `blank:${row.id}`, "Ingredient has no usable name."));
    if (row.mergedInto && row.mergedInto === row.id) out.push(finding(scope, "ingredients", "error", `self-merge:${row.id}`, "Ingredient points to itself as its merge target."));
  });
  // Merges are intentionally soft so existing recipe components keep resolving
  // through their historical ids. Only active, unmerged catalog entries are
  // duplicates a manager can still select or needs to reconcile.
  const activeIngredients = ingredientsRows.filter((row) => row.enabled && !row.mergedInto);
  out.push(...duplicateFindings(activeIngredients, (row) => row.name, (name) => withFollowUp(finding(
    scope,
    "ingredients",
    "warning",
    `duplicate:${name}`,
    `Multiple ingredient rows use the name "${name}".`,
    false,
    true,
    "valid",
    "inventory",
    "These rows share a display name but retain stable, category-specific catalog identities. Do not merge without an inventory owner confirming category coverage and recipe references.",
    "ambiguous",
  ))));

  const repairs: MasterDataHealthReport["repairs"] = [];
  const namesForMergeCategory = (category: string): Set<string> | null =>
    category === "ingredient" ? ingredientNames
      : category === "dough" ? recipeNamesByKind.dough
        : category === "sauce" ? recipeNamesByKind.sauce
          : category === "cheese" ? recipeNamesByKind.cheese
            : category === "mixes" ? recipeNamesByKind.mixes
              : category === "brand" ? brandNames
                : category === "flavor" ? flavorNames : null;
  const aliasCandidates: AliasCandidate[] = [
    ...importAliasRows.map((alias) => ({
      id: alias.id, externalName: alias.externalName, canonicalName: alias.canonicalName,
      context: alias.brandContext, namespace: alias.type, source: "import" as const,
    })),
    ...specAliasRows.map((alias) => ({
      id: alias.id, externalName: alias.externalName, canonicalName: alias.canonicalName,
      context: alias.context, namespace: alias.kind, source: "spec" as const,
    })),
    ...mergeAliasRows.map((alias) => ({
      id: alias.id, externalName: alias.externalName, canonicalName: alias.canonicalName,
      context: alias.brand, namespace: alias.category, source: "merge" as const,
    })),
  ];
  for (const [source, aliases] of [
    ["import", importAliasRows], ["spec", specAliasRows], ["merge", mergeAliasRows],
  ] as const) {
    aliases.forEach((alias) => {
      const external = key("externalName" in alias ? alias.externalName : "");
      const canonical = key("canonicalName" in alias ? alias.canonicalName : "");
      const namespace = source === "import"
        ? String((alias as typeof importAliasRows[number]).type)
        : source === "spec"
          ? String((alias as typeof specAliasRows[number]).kind)
          : String((alias as typeof mergeAliasRows[number]).category);
      const names = source === "merge"
        ? namesForMergeCategory(namespace)
        : namespace === "brand" ? brandNames
          : namespace === "flavor" ? flavorNames
            : namespace === "recipeName" ? new Set([...recipeNamesByKind.dough, ...recipeNamesByKind.sauce, ...recipeNamesByKind.cheese, ...recipeNamesByKind.mixes])
              : namespace.endsWith("Ingredient") || namespace === "ingredient" ? ingredientNames : null;
      if (!external || !canonical || external === canonical) {
        const id = `${source}:${alias.id}`;
        out.push(finding(scope, "aliases", "warning", id, "Alias is blank or maps a name to itself.", true, false));
        const context = "context" in alias ? alias.context : "brandContext" in alias ? alias.brandContext : null;
        repairs.push({
         findingId: `aliases:${id}`,
         action: "delete-alias",
         category: "aliases",
         source,
         rowId: alias.id,
         externalName: "externalName" in alias ? alias.externalName : "",
         canonicalName: "canonicalName" in alias ? alias.canonicalName : "",
          context,
          fingerprint: masterDataRepairFingerprint({
            source,
            rowId: alias.id,
            externalName: "externalName" in alias ? alias.externalName : "",
            canonicalName: "canonicalName" in alias ? alias.canonicalName : "",
            context,
          }),
          owner: "import-review",
          preview: {
            before: `${String("externalName" in alias ? alias.externalName : "")} → ${String("canonicalName" in alias ? alias.canonicalName : "")}`,
            after: "Alias removed after manager approval",
          },
          undo: "data-health-repair-batch",
       });
      } else if (names) {
        const candidate = aliasCandidates.find((item) => item.source === source && item.id === alias.id);
        const resolution = candidate ? aliasResolution(candidate, aliasCandidates, names) : "stale";
        if (resolution === "stale") {
          out.push(finding(scope, "aliases", "warning", `${source}:${alias.id}:stale`, `Alias "${String(alias.externalName)}" resolves to a name no longer present in its current ${namespace} namespace.`, false, false, "stale", "import-review", "Retain the historical alias until an import or merge owner confirms whether it should be redirected or retired.", "orphaned"));
        } else if (resolution === "ambiguous") {
          out.push(finding(scope, "aliases", "warning", `${source}:${alias.id}:ambiguous`, `Alias "${String(alias.externalName)}" has more than one possible canonical resolution.`, false, false, "stale", "import-review", "The mapping is ambiguous and must remain review-only; fuzzy matching is not an approved repair.", "ambiguous"));
        }
      }
    });
  }
  for (const day of dayRows) {
    const data = boundedData(day.data);
    const state = data.dayState && typeof data.dayState === "object" ? data.dayState as Record<string, unknown> : {};
    const runs = Array.isArray(state.runs) ? state.runs.slice(0, MAX_COMPONENT_ROWS_PER_RECIPE) : [];
    const runValues = data.runValues && typeof data.runValues === "object" ? data.runValues as Record<string, unknown> : {};
    const runIds = new Set<string>();
    runs.forEach((raw, index) => {
      const run = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const brand = key(run.brand), flavor = key(run.flavor);
      const runId = String(run.id ?? index);
      runIds.add(runId);
      if (!brand || !flavor || !profileKeys.has(`${brand}\u0000${flavor}`)) {
        out.push(finding(scope, "scheduled-runs", "error", `${day.date}:${runId}`, `Run on ${day.date} has no matching setup profile.`, false, true, "stale", "import-review", "The run is retained as protected operational history; review the profile identity before changing it.", "orphaned"));
      }
      const values = boundedRecord(runValues[runId], () => { payloadState.truncated = true; });
      for (const [field, recipeKind] of [["doughRecipeName", "dough"], ["frontlineRecipeName", "sauce"]] as const) {
        const recipeName = key(values[field]);
        if (recipeName && !recipeNamesByKind[recipeKind].has(recipeName)) {
          out.push(finding(scope, "scheduled-runs", "warning", `${day.date}:${runId}:${field}:${recipeName}`, `Run on ${day.date} references missing ${recipeKind} recipe "${String(values[field])}".`, false, true, "stale", "master-data", "This historical run reference is protected; a manager must confirm the intended replacement.", "orphaned"));
        }
      }
    });
    for (const runId of Object.keys(runValues)) {
      if (!runIds.has(runId)) {
        out.push(finding(scope, "scheduled-runs", "warning", `${day.date}:orphan-run-values:${runId}`, `The day-state payload has values for run "${runId}" but no matching run record.`, false, true, "stale", "master-data", "Preserve the payload for protected-history review; do not delete it during an audit.", "orphaned"));
      }
    }
  }

  const environment = scope === "live" ? "live" : "development";
  const groups: MasterDataHealthReport["groups"] = { error: [], warning: [], info: [] };
  out.sort((a, b) => a.id.localeCompare(b.id));
  const findings = out.slice(0, MAX_FINDINGS);
  coverage.payloadsTruncated = payloadState.truncated;
  coverage.findingsTruncated = out.length > findings.length;
  findings.forEach((item) => groups[item.severity].push(item));
  const summary = { total: out.length, error: groups.error.length, warning: groups.warning.length, info: groups.info.length } as MasterDataHealthReport["summary"];
  for (const category of ["profiles", "dough", "sauce", "cheese", "mixes", "ingredients", "aliases", "scheduled-runs"] as const) summary[category] = out.filter((item) => item.category === category).length;
  return { scanId: scanId(scope, at), scope, environment, scannedAt: at.toISOString(), findings, groups, summary, coverage, repairs: [...profileRepairs, ...repairs] };
}

export async function runMasterDataHealthScan(
  scope: string,
  options: { maxAgeMs?: number } = {},
): Promise<MasterDataHealthReport> {
  if (options.maxAgeMs !== undefined) {
    const [latest] = await db.select().from(masterDataHealthScansTable)
      .where(eq(masterDataHealthScansTable.scope, scope))
      .orderBy(desc(masterDataHealthScansTable.completedAt)).limit(1);
    if (latest?.completedAt && latest.report && typeof latest.report === "object"
      && "coverage" in latest.report
      && Date.now() - latest.completedAt.getTime() < options.maxAgeMs) {
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
