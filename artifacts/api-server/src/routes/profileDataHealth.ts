import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  auditLogsTable,
  brandProfilesTable,
  dataHealsTable,
  dataHealthRepairBatchesTable,
  dailySyncTable,
  db,
  doughRecipesTable,
  importAliasesTable,
  savedSpecSheetsTable,
  sauceRecipesTable,
  specImportAliasesTable,
  mergeAliasesTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import { buildMasterDataHealthReport, type MasterDataHealthReport } from "../lib/masterDataHealth";
import { applyAiRetentionCleanup, buildAiRetentionReport, type AiRetentionReport } from "../lib/aiRetention";

type JsonRecord = Record<string, unknown>;
type RecipeKind = "dough" | "sauce";
type HealthExecutor = Pick<typeof db, "select">;

export type ProfileDataHealthFinding = {
  id: string;
  profileKey: string;
  brand: string;
  flavor: string;
  recipeKind: RecipeKind;
  status: "healthy" | "missing-link" | "missing-recipe" | "missing-rows" | "saved-spec-mismatch";
  currentName: string;
  expectedName: string;
  repairable: boolean;
  message: string;
  fingerprint: string;
};

export type ProfileDataHealthRepair = {
  id: string;
  profileKey: string;
  recipeKind: RecipeKind;
  fingerprint: string;
  fields: string[];
  previousValues: JsonRecord;
  nextValues: JsonRecord;
};

export type ProfileDataHealthReport = {
  findings: ProfileDataHealthFinding[];
  safeRepairs: ProfileDataHealthRepair[];
  summary: Record<string, number>;
};

export type DataHealthFinding = {
  id: string;
  category: "profile-links" | "profiles" | "dough" | "sauce" | "cheese" | "mixes" | "ingredients" | "aliases" | "scheduled-runs" | "import-review" | "cleanup-history";
  severity: "info" | "warning" | "error";
  repairability: "safe" | "review";
  brand: string;
  flavor: string;
  recipe: string;
  message: string;
  proposedRepair: string;
  affectedRecord: string;
  protectedValue: boolean;
  source: "profile-health" | "master-data" | "saved-spec" | "cleanup";
  sourceRoute: "setupProfiles" | "import" | "merge" | "audit" | "dough" | "sauce" | "cheeseRecipes" | "mixes" | "ingredientTypes";
  preview?: {
    before: string;
    after: string;
    changes?: Array<{ field: string; before: string; after: string }>;
  };
  profileFinding?: ProfileDataHealthFinding;
};

export type DataHealthRepair =
  | (ProfileDataHealthRepair & { repairType: "profile-link" })
  | {
    repairType: "delete-alias";
    findingId: string;
    source: "import" | "spec" | "merge";
    rowId: number;
    externalName: string;
    canonicalName: string;
    context: string | null;
  };

export type DataHealthWorkspace = {
  findings: DataHealthFinding[];
  safeRepairs: DataHealthRepair[];
  summary: Record<string, number>;
  cleanupHistory: {
    appliedAt: Date | null;
    summary: {
      scannedProfiles: number;
      correctedProfiles: number;
      skippedStarted: number;
      removedStubs: { dough: number; sauce: number; cheese: number; mix: number };
    };
  } | null;
  repairBatches: Array<{
    id: string; actor: string; appliedAt: Date; undoneAt: Date | null; status: string;
    summary: { applied: number; skipped: number; failed: number; repairedRuns: number };
  }>;
  aiRetention: AiRetentionReport;
};

const router = Router();

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function snapshotFields(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const fields = value.filter((field): field is string => typeof field === "string" && field.trim().length > 0);
  if (fields.length !== value.length || new Set(fields).size !== fields.length) return null;
  return fields;
}

function hasSnapshotValues(value: unknown, fields: string[]): boolean {
  const values = record(value);
  return fields.every((field) => Object.prototype.hasOwnProperty.call(values, field));
}

function finiteSnapshotStamp(value: unknown): number | null {
  if (value == null || value === "") return null;
  const stamp = Number(value);
  return Number.isFinite(stamp) ? stamp : null;
}

function nameKey(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function profileKey(brand: unknown, flavor: unknown): string {
  return `${nameKey(brand)}\u0000${nameKey(flavor)}`;
}

function safeRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hash(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function chicagoToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function fieldConfig(kind: RecipeKind) {
  return kind === "dough"
    ? { name: "doughRecipeName", rows: "doughRecipe", parsedName: "doughName" }
    : { name: "frontlineRecipeName", rows: "frontlineRecipe", parsedName: "sauceName" };
}

/**
 * Reports only exact, deterministic recovery candidates. A saved sheet can
 * identify what the name should be, but a valid conflicting link is left for a
 * manager to review rather than being silently overwritten.
 */
export async function profileDataHealthReport(executor: HealthExecutor): Promise<ProfileDataHealthReport> {
  const scope = currentScope();
  const [profiles, doughRecipes, sauceRecipes, sheets] = await Promise.all([
    executor.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, scope)),
    executor.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
    executor.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
    executor.select().from(savedSpecSheetsTable)
      .where(eq(savedSpecSheetsTable.scope, scope))
      .orderBy(desc(savedSpecSheetsTable.createdAt)),
  ]);

  const parsedByProfile = new Map<string, JsonRecord>();
  for (const sheet of sheets) {
    const data = record(sheet.data);
    const parsedProfiles = Array.isArray(data.profiles) ? data.profiles : [];
    for (const parsed of parsedProfiles) {
      const item = record(parsed);
      const key = profileKey(item.brand, item.flavor);
      if (key !== "\u0000" && !parsedByProfile.has(key)) parsedByProfile.set(key, item);
    }
  }

  const poolByKind: Record<RecipeKind, Map<string, { name: string; components: unknown[] }>> = {
    dough: new Map(doughRecipes.map((row) => [nameKey(row.name), { name: row.name, components: safeRows(row.components) }])),
    sauce: new Map(sauceRecipes.map((row) => [nameKey(row.name), { name: row.name, components: safeRows(row.components) }])),
  };

  const findings: ProfileDataHealthFinding[] = [];
  const safeRepairs: ProfileDataHealthRepair[] = [];
  for (const profile of profiles) {
    const values = record(profile.values);
    const parsed = parsedByProfile.get(profileKey(profile.brand, profile.flavor)) ?? {};

    for (const kind of ["dough", "sauce"] as const) {
      const fields = fieldConfig(kind);
      const currentName = String(values[fields.name] ?? "").trim();
      const expectedName = String(parsed[fields.parsedName] ?? "").trim();
      const pool = poolByKind[kind];
      const currentRecipe = pool.get(nameKey(currentName));
      const expectedRecipe = pool.get(nameKey(expectedName));
      const currentRows = safeRows(values[fields.rows]);
      const fingerprint = hash({
        updatedAt: profile.updatedAtMs ?? 0,
        name: currentName,
        rows: currentRows,
        expectedName,
      });
      const id = `${profile.key}:${kind}:${fingerprint}`;
      const base = {
        id,
        profileKey: profile.key,
        brand: profile.brand ?? "",
        flavor: profile.flavor ?? "",
        recipeKind: kind,
        currentName,
        expectedName,
        fingerprint,
      };

      let finding: ProfileDataHealthFinding | null = null;
      let repair: ProfileDataHealthRepair | null = null;
      const previousValuesFor = (changedFields: string[]) =>
        Object.fromEntries(changedFields.map((field) => [field, values[field]]));
      if (!currentName && expectedName && expectedRecipe) {
        const nextValues = { ...values, [fields.name]: expectedRecipe.name, [fields.rows]: expectedRecipe.components };
        finding = { ...base, status: "missing-link", repairable: true, message: `Restore the saved ${kind} recipe link.` };
        repair = { id, profileKey: profile.key, recipeKind: kind, fingerprint, fields: [fields.name, fields.rows], previousValues: previousValuesFor([fields.name, fields.rows]), nextValues };
      } else if (currentName && !currentRecipe) {
        if (expectedName && expectedRecipe) {
          const nextValues = { ...values, [fields.name]: expectedRecipe.name, [fields.rows]: expectedRecipe.components };
          finding = { ...base, status: "missing-recipe", repairable: true, message: `Replace the missing ${kind} recipe with the exact saved-sheet link.` };
          repair = { id, profileKey: profile.key, recipeKind: kind, fingerprint, fields: [fields.name, fields.rows], previousValues: previousValuesFor([fields.name, fields.rows]), nextValues };
        } else {
          finding = { ...base, status: "missing-recipe", repairable: false, message: `The linked ${kind} recipe is not in the current recipe pool.` };
        }
      } else if (currentRecipe && currentRows.length === 0 && currentRecipe.components.length > 0) {
        const nextValues = { ...values, [fields.rows]: currentRecipe.components };
        finding = { ...base, status: "missing-rows", repairable: true, message: `Hydrate the empty ${kind} recipe rows from the linked recipe.` };
        repair = { id, profileKey: profile.key, recipeKind: kind, fingerprint, fields: [fields.rows], previousValues: previousValuesFor([fields.rows]), nextValues };
      } else if (currentRecipe && expectedName && nameKey(currentName) !== nameKey(expectedName)) {
        finding = { ...base, status: "saved-spec-mismatch", repairable: false, message: `The saved sheet names a different ${kind} recipe; review before changing it.` };
      }

      if (finding) findings.push(finding);
      if (repair) safeRepairs.push(repair);
    }
  }

  const summary: Record<string, number> = { profilesChecked: profiles.length, repairable: safeRepairs.length };
  for (const finding of findings) summary[finding.status] = (summary[finding.status] ?? 0) + 1;
  return { findings, safeRepairs, summary };
}

function workspaceFinding(finding: ProfileDataHealthFinding): DataHealthFinding {
  const review = !finding.repairable;
  const importMismatch = finding.status === "saved-spec-mismatch";
  return {
    id: finding.id,
    category: importMismatch ? "import-review" : "profile-links",
    severity: importMismatch ? "warning" : finding.status === "missing-recipe" ? "error" : "warning",
    repairability: finding.repairable ? "safe" : "review",
    brand: finding.brand,
    flavor: finding.flavor,
    recipe: `${finding.recipeKind}: ${finding.currentName || finding.expectedName || "unnamed"}`,
    message: finding.message,
    proposedRepair: finding.repairable
      ? "Restore the exact saved recipe link and rows; future runs will be refreshed, started runs are protected."
      : importMismatch
        ? "Review the saved import and choose the intended recipe before changing this profile."
        : "Open the setup or merge workflow and resolve this record explicitly.",
    affectedRecord: `${finding.brand || "Unbranded"} / ${finding.flavor || "All flavors"} / ${finding.recipeKind}`,
    protectedValue: false,
    source: importMismatch ? "saved-spec" : "profile-health",
    sourceRoute: importMismatch ? "import" : review ? "setupProfiles" : "audit",
    preview: finding.repairable
      ? { before: finding.currentName || "No linked recipe", after: finding.expectedName || "Exact saved recipe" }
      : undefined,
    profileFinding: finding,
  };
}

function previewValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "0 recipe rows";
    const rows = value.slice(0, 4).map((raw) => {
      const row = record(raw);
      const ingredient = String(row.ingredient ?? row.name ?? "unnamed");
      const amount = row.lbs ?? row.oz ?? row.amount;
      return amount == null ? ingredient : `${ingredient} (${String(amount)})`;
    });
    return `${value.length} recipe row${value.length === 1 ? "" : "s"}: ${rows.join(", ")}${value.length > rows.length ? ", …" : ""}`;
  }
  const text = String(value ?? "").trim();
  return text || "empty";
}

export async function dataHealthWorkspace(executor: HealthExecutor): Promise<DataHealthWorkspace> {
  const scope = currentScope();
  const [report, master, aiRetention] = await Promise.all([
    profileDataHealthReport(executor),
    buildMasterDataHealthReport(executor, scope),
    buildAiRetentionReport(executor),
  ]);
  const [marker] = await executor
    .select({
      appliedAt: dataHealsTable.appliedAt,
      result: dataHealsTable.result,
    })
    .from(dataHealsTable)
    .where(eq(dataHealsTable.id, "profile-name-link-stub-purge-v1"))
    .limit(1);
  const result = record(marker?.result);
  const removed = record(result.removedStubs);
  const cleanupHistory = marker ? {
    appliedAt: marker.appliedAt,
    summary: {
      scannedProfiles: Number(result.scannedProfiles) || 0,
      correctedProfiles: Number(result.correctedProfiles) || 0,
      skippedStarted: Number(result.skippedStarted) || 0,
      removedStubs: {
        dough: Number(removed.dough) || 0,
        sauce: Number(removed.sauce) || 0,
        cheese: Number(removed.cheese) || 0,
        mix: Number(removed.mix) || 0,
      },
    },
  } : null;
  const profileRepairsByFinding = new Map(report.safeRepairs.map((repair) => [repair.id, repair]));
  const findings = report.findings.map((finding) => {
    const normalized = workspaceFinding(finding);
    const repair = profileRepairsByFinding.get(finding.id);
    if (!repair) return normalized;
    return {
      ...normalized,
      preview: {
        before: finding.currentName || "No linked recipe",
        after: finding.expectedName || "Exact saved recipe",
        changes: repair.fields.map((field) => ({
          field,
          before: previewValue(repair.previousValues[field]),
          after: previewValue(repair.nextValues[field]),
        })),
      },
    };
  });
  const masterRepairsByFinding = new Map(master.repairs.map((repair) => [
    repair.action === "update-profile-recipe-link" ? `profiles:${repair.findingId}` : repair.findingId,
    repair,
  ]));
  for (const item of master.findings) {
    const repair = masterRepairsByFinding.get(item.id);
    const aliasSource = item.category === "aliases" ? item.stableKey.split(":")[0] : "";
    const route = item.category === "profiles" || item.category === "scheduled-runs" ? "setupProfiles"
      : item.category === "aliases" ? aliasSource === "merge" ? "merge" : "import"
        : item.category === "dough" ? "dough"
          : item.category === "sauce" ? "sauce"
            : item.category === "cheese" ? "cheeseRecipes"
              : item.category === "mixes" ? "mixes"
                : item.category === "ingredients" ? "ingredientTypes"
                  : item.owner === "import-review" ? "import" : "audit";
    const repairPreview = repair?.action === "delete-alias"
      ? { before: `${repair.externalName} → ${repair.canonicalName}`, after: "Alias removed after manager approval" }
      : repair?.action === "update-profile-recipe-link"
        ? { before: repair.from, after: repair.to }
        : undefined;
    const safelyRepairable = item.repairable && repair?.action === "delete-alias";
    findings.push({
      id: `master:${item.id}`,
      category: item.category,
      severity: item.severity,
      repairability: safelyRepairable ? "safe" : "review",
      brand: "",
      flavor: "",
      recipe: item.category === "profiles" ? "Profile record" : item.category,
      message: item.message,
      proposedRepair: repair
        ? repair.action === "delete-alias"
          ? "Remove this blank/self-mapping alias after reviewing the exact mapping."
          : "Review this confirmed source value in Setup Profiles before replacing the protected link."
        : item.dispositionReason,
      affectedRecord: item.stableKey,
      protectedValue: item.protectedValue,
      source: "master-data",
      sourceRoute: route,
      preview: repairPreview,
    });
  }
  if (cleanupHistory) {
    for (const [kind, count] of Object.entries(cleanupHistory.summary.removedStubs)) {
      if (count === 0) continue;
      findings.push({
        id: `cleanup-history:${kind}`,
        category: "cleanup-history",
        severity: "info",
        repairability: "review",
        brand: "",
        flavor: "",
        recipe: `${kind} recipe records`,
        message: `${count} orphaned zero-value ${kind} record${count === 1 ? "" : "s"} were removed by the completed cleanup.`,
        proposedRepair: "No action is pending. Open the audit log to review the recorded cleanup result.",
        source: "cleanup",
        sourceRoute: "audit",
        affectedRecord: `${kind} recipe records`,
        protectedValue: true,
      });
    }
  }
  const summary = {
    ...report.summary,
    total: findings.length,
    safe: findings.filter((item) => item.repairability === "safe").length,
    review: findings.filter((item) => item.repairability === "review").length,
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
  };
  const batches = await executor.select({
    id: dataHealthRepairBatchesTable.id, actor: dataHealthRepairBatchesTable.actor,
    appliedAt: dataHealthRepairBatchesTable.appliedAt, undoneAt: dataHealthRepairBatchesTable.undoneAt,
    status: dataHealthRepairBatchesTable.status, summary: dataHealthRepairBatchesTable.summary,
  }).from(dataHealthRepairBatchesTable)
    .where(eq(dataHealthRepairBatchesTable.scope, scope))
    .orderBy(desc(dataHealthRepairBatchesTable.appliedAt)).limit(10);
  return {
    findings,
    safeRepairs: [
      ...report.safeRepairs.map((repair) => ({ ...repair, repairType: "profile-link" as const })),
      ...master.repairs.flatMap((repair) => repair.action === "delete-alias"
        ? [{ ...repair, findingId: `master:${repair.findingId}`, repairType: "delete-alias" as const }]
        : []),
    ],
    summary,
    cleanupHistory,
    aiRetention,
    repairBatches: batches.map((batch) => {
      const value = record(batch.summary);
      return { ...batch, summary: {
        applied: Number(value.applied) || 0, skipped: Number(value.skipped) || 0,
        failed: Number(value.failed) || 0, repairedRuns: Number(value.repairedRuns) || 0,
      } };
    }),
  };
}

function repairStillMatches(values: JsonRecord, updatedAtMs: number | null, repair: ProfileDataHealthRepair): boolean {
  const fields = fieldConfig(repair.recipeKind);
  const currentName = String(values[fields.name] ?? "").trim();
  const currentRows = safeRows(values[fields.rows]);
  const expectedName = String(repair.nextValues[fields.name] ?? "").trim();
  return hash({ updatedAt: updatedAtMs ?? 0, name: currentName, rows: currentRows, expectedName }) === repair.fingerprint;
}

router.get("/profile-data/health-check", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    res.json({ report: await profileDataHealthReport(db) });
  } catch (err) {
    req.log.error({ err }, "failed to audit profile data health");
    res.status(500).json({ error: "Failed to audit profile data health" });
  }
});

router.post("/profile-data/ai-retention/apply", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    const report = await applyAiRetentionCleanup();
    req.log.info({
      policyVersion: report.policyVersion,
      scope: report.scope,
      candidateCounts: report.candidates,
    }, "AI retention cleanup completed");
    res.json({ report });
  } catch (err) {
    req.log.error({ err }, "AI retention cleanup failed");
    res.status(409).json({ error: "AI retention cleanup could not run within its bounded batch" });
  }
});

router.get("/profile-data/health-workspace", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    res.json({ workspace: await dataHealthWorkspace(db) });
  } catch (err) {
    req.log.error({ err }, "failed to load data health workspace");
    res.status(500).json({ error: "Failed to load data health workspace" });
  }
});

router.post("/profile-data/health-check/apply", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    if (!Array.isArray(req.body?.findingIds) || req.body.findingIds.length === 0 || req.body.findingIds.length > 100
      || req.body.findingIds.some((id: unknown) => typeof id !== "string" || id.length === 0 || id.length > 240)) {
      res.status(400).json({ error: "Select between 1 and 100 valid health findings" });
      return;
    }
    const requested = new Set(req.body.findingIds as string[]);
    const result = await db.transaction(async (tx) => {
      const before = await profileDataHealthReport(tx);
      const master = await buildMasterDataHealthReport(tx, scope);
      const supportedIds = new Set([
        ...before.safeRepairs.map((repair) => repair.id),
        ...master.repairs.flatMap((repair) => repair.action === "delete-alias"
          ? [`master:${repair.findingId}`]
          : []),
      ]);
      const repairedByProfile = new Map<string, { values: JsonRecord; fields: string[] }>();
      const appliedByProfileKey = new Map<string, ProfileDataHealthRepair & { afterStamp: number }>();
      const applied: Array<Record<string, unknown>> = [];
      const runRecords: Array<Record<string, unknown>> = [];
      let skipped = [...requested].filter((id) => !supportedIds.has(id)).length;
      const now = Date.now();

      for (const repair of before.safeRepairs) {
        if (!requested.has(repair.id)) continue;
        const [profile] = await tx.select().from(brandProfilesTable).where(
          and(eq(brandProfilesTable.key, repair.profileKey), eq(brandProfilesTable.scope, scope)),
        ).for("update");
        if (!profile) { skipped++; continue; }
        const values = record(profile.values);
        if (!repairStillMatches(values, profile.updatedAtMs, repair)) { skipped++; continue; }
        const previousValues = Object.fromEntries(repair.fields.map((field) => [field, values[field]]));
        const stamp = Math.max(profile.updatedAtMs ?? 0, now) + 1;
        await tx.update(brandProfilesTable)
          .set({ values: repair.nextValues, updatedAtMs: stamp })
          .where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, scope)));
        repairedByProfile.set(
          `${profileKey(profile.brand, profile.flavor)}`,
          { values: repair.nextValues, fields: repair.fields },
        );
        repair.previousValues = previousValues;
        (repair as ProfileDataHealthRepair & { afterStamp: number }).afterStamp = stamp;
        appliedByProfileKey.set(profileKey(profile.brand, profile.flavor), repair as ProfileDataHealthRepair & { afterStamp: number });
        applied.push({ ...repair, repairType: "profile-link" });
      }

      let repairedRuns = 0;
      if (repairedByProfile.size > 0) {
        const days = await tx.select().from(dailySyncTable)
          .where(and(eq(dailySyncTable.scope, scope), gte(dailySyncTable.date, chicagoToday())))
          .for("update");
        for (const day of days) {
          const data = record(day.data);
          const dayState = record(data.dayState);
          const runs = Array.isArray(dayState.runs) ? dayState.runs : [];
          const oldValues = record(data.runValues);
          const oldStamps = record(data.runValuesUpdatedAt);
          const nextValues = { ...oldValues };
          const nextStamps = { ...oldStamps };
          let changed = false;
          for (const rawRun of runs) {
            const run = record(rawRun);
            const id = typeof run.id === "string" ? run.id : "";
            if (!id || run.startedAt != null || run.endedAt != null) continue;
            const changedProfile = repairedByProfile.get(profileKey(run.brand, run.flavor));
            const runValues = record(nextValues[id]);
            if (!changedProfile || Object.keys(runValues).length === 0) continue;
            const nextRunValues = { ...runValues };
            for (const field of changedProfile.fields) nextRunValues[field] = changedProfile.values[field];
            nextValues[id] = nextRunValues;
            const oldStamp = Number(nextStamps[id]);
            const beforeStamp = Number.isFinite(oldStamp) ? oldStamp : 0;
            const afterStamp = Math.max(beforeStamp, now) + 1;
            nextStamps[id] = afterStamp;
            const appliedRepair = appliedByProfileKey.get(profileKey(run.brand, run.flavor));
            if (appliedRepair) {
               runRecords.push({
                 repairType: "run-values",
                 profileKey: appliedRepair.profileKey,
                runId: id, date: day.date, fields: changedProfile.fields,
                beforeValues: Object.fromEntries(changedProfile.fields.map((field) => [field, runValues[field]])),
                afterValues: Object.fromEntries(changedProfile.fields.map((field) => [field, nextRunValues[field]])),
                beforeStamp, afterStamp,
              });
            }
            repairedRuns++;
            changed = true;
          }
          if (changed) {
            await tx.update(dailySyncTable)
              .set({ data: { ...data, runValues: nextValues, runValuesUpdatedAt: nextStamps }, updatedAt: new Date() })
              .where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, scope)));
          }
        }
      }

      let batchId: string | null = null;
      for (const repair of master.repairs) {
        if (repair.action !== "delete-alias" || !requested.has(`master:${repair.findingId}`)) continue;
          const table = repair.source === "import" ? importAliasesTable
            : repair.source === "spec" ? specImportAliasesTable : mergeAliasesTable;
          const [row] = await tx.select().from(table).where(
            and(eq(table.id, repair.rowId), eq(table.scope, scope)),
          ).for("update");
          const rowValues = record(row);
          const sameMapping = row
            && String(rowValues.externalName ?? "") === repair.externalName
            && String(rowValues.canonicalName ?? "") === repair.canonicalName
            && String(rowValues.context ?? rowValues.brandContext ?? "") === String(repair.context ?? "");
          if (!sameMapping) { skipped++; continue; }
          await tx.delete(table).where(and(eq(table.id, repair.rowId), eq(table.scope, scope)));
          const previousValues = repair.source === "import"
            ? { scope, type: rowValues.type, externalName: rowValues.externalName, canonicalName: rowValues.canonicalName, brandContext: rowValues.brandContext ?? null }
            : repair.source === "spec"
              ? { scope, kind: rowValues.kind, externalName: rowValues.externalName, canonicalName: rowValues.canonicalName, context: rowValues.context ?? null }
              : { scope, category: rowValues.category, brand: rowValues.brand ?? null, externalName: rowValues.externalName, canonicalName: rowValues.canonicalName };
          applied.push({
            repairType: "delete-alias",
            findingId: `master:${repair.findingId}`,
            source: repair.source,
            rowId: repair.rowId,
            previousValues,
          });
      }

      if (applied.length > 0) {
        batchId = `profile-data-health:${now}:${Math.random().toString(36).slice(2, 10)}`;
        await tx.insert(dataHealthRepairBatchesTable).values({
           id: batchId, scope, actor: req.userId ?? "unknown", records: [...applied, ...runRecords],
          summary: { applied: applied.length, skipped, failed: 0, repairedRuns },
        });
        await tx.insert(auditLogsTable).values({
          scope,
          actor: req.userId ?? "unknown",
          action: "profile_data_health_repair",
          resource: "brand_profiles",
          changes: {
            profiles: applied
              .filter((repair) => repair.repairType === "profile-link")
              .map((repair) => ({ profileKey: repair.profileKey, recipeKind: repair.recipeKind, fields: repair.fields })),
            aliases: applied
              .filter((repair) => repair.repairType === "delete-alias")
              .map((repair) => ({ source: repair.source, rowId: repair.rowId })),
            repairedRuns,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
        });
      }
       return {
         before,
         after: await profileDataHealthReport(tx),
         applied,
         batchId,
         outcome: { applied: applied.length, skipped, failed: 0, repairedRuns },
         summary: {
           repairedProfiles: applied.filter((item) => item.repairType === "profile-link").length,
           repairedRuns,
         },
       };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "failed to apply profile data health repairs");
    res.status(500).json({ error: "Failed to apply profile data health repairs" });
  }
});

router.post("/profile-data/health-check/batches/:batchId/undo", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx.select().from(dataHealthRepairBatchesTable)
        .where(and(eq(dataHealthRepairBatchesTable.id, String(req.params.batchId)), eq(dataHealthRepairBatchesTable.scope, scope))).for("update");
      if (!batch) return { status: 404 as const, body: { error: "Repair batch not found" } };
      if (batch.status === "undone") {
        const value = record(batch.summary);
        return {
          status: 200 as const,
          body: {
            batchId: batch.id,
            alreadyUndone: true,
            summary: {
              applied: Number(value.applied) || 0,
              skipped: Number(value.skipped) || 0,
              failed: Number(value.failed) || 0,
              repairedRuns: Number(value.repairedRuns) || 0,
            },
          },
        };
      }
      if (batch.status !== "applied") return { status: 409 as const, body: { error: "Repair batch is no longer eligible for undo" } };
      const records = Array.isArray(batch.records) ? batch.records as Array<Record<string, unknown>> : [];
      let applied = 0; let skipped = 0; let repairedRuns = 0;
      for (const raw of records) {
        const item = record(raw);
        if (item.repairType === "delete-alias") {
          const source = item.source;
          const previous = record(item.previousValues);
          const table = source === "import" ? importAliasesTable
            : source === "spec" ? specImportAliasesTable : mergeAliasesTable;
          if (!source || Object.keys(previous).length === 0) { skipped++; continue; }
          const [existing] = await tx.select().from(table).where(and(
            eq(table.scope, scope),
            eq(table.externalName, String(previous.externalName ?? "")),
            eq(table.canonicalName, String(previous.canonicalName ?? "")),
          )).limit(1);
          if (existing) { skipped++; continue; }
          if (source === "import") {
            await tx.insert(importAliasesTable).values({
              scope,
              type: String(previous.type ?? "brand"),
              externalName: String(previous.externalName ?? ""),
              canonicalName: String(previous.canonicalName ?? ""),
              brandContext: previous.brandContext == null ? null : String(previous.brandContext),
            });
          } else if (source === "spec") {
            await tx.insert(specImportAliasesTable).values({
              scope,
              kind: String(previous.kind ?? "ingredient"),
              externalName: String(previous.externalName ?? ""),
              canonicalName: String(previous.canonicalName ?? ""),
              context: previous.context == null ? null : String(previous.context),
            });
          } else {
            await tx.insert(mergeAliasesTable).values({
              scope,
              category: String(previous.category ?? "ingredient"),
              brand: previous.brand == null ? null : String(previous.brand),
              externalName: String(previous.externalName ?? ""),
              canonicalName: String(previous.canonicalName ?? ""),
            });
          }
          applied++;
          continue;
        }
        if (item.repairType === "run-values") {
          const date = String(item.date ?? "");
          const runId = String(item.runId ?? "");
          const fields = snapshotFields(item.fields);
          const beforeStamp = finiteSnapshotStamp(item.beforeStamp);
          const afterStamp = finiteSnapshotStamp(item.afterStamp);
          const [day] = await tx.select().from(dailySyncTable)
            .where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, date))).for("update");
          if (!day || !runId || !fields || beforeStamp == null || afterStamp == null
            || !hasSnapshotValues(item.beforeValues, fields)
            || !hasSnapshotValues(item.afterValues, fields)) { skipped++; continue; }
          const data = record(day.data);
          const state = record(data.dayState);
          const found = (Array.isArray(state.runs) ? state.runs : []).map(record).find((value) => value.id === runId);
          const stamps = record(data.runValuesUpdatedAt);
          const values = record(record(data.runValues)[runId]);
          if (!found || found.startedAt != null || found.endedAt != null
            || Number(stamps[runId]) !== afterStamp
            || !fields.every((field) => JSON.stringify(values[field]) === JSON.stringify(record(item.afterValues)[field]))) {
            skipped++;
            continue;
          }
          const restoredRuns = { ...record(data.runValues), [runId]: { ...values, ...record(item.beforeValues) } };
          const restoredStamps = {
            ...stamps,
            [runId]: Math.max(Number(stamps[runId]) || 0, Date.now()) + 1,
          };
          await tx.update(dailySyncTable).set({
            data: { ...data, runValues: restoredRuns, runValuesUpdatedAt: restoredStamps },
            updatedAt: new Date(),
          }).where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, date)));
          repairedRuns++;
          continue;
        }
        const key = String(item.profileKey ?? "");
        const [profile] = await tx.select().from(brandProfilesTable)
          .where(and(eq(brandProfilesTable.key, key), eq(brandProfilesTable.scope, scope))).for("update");
        const fields = Array.isArray(item.fields) ? item.fields.map(String) : [];
        const afterValues = record(item.nextValues);
        if (!profile || profile.updatedAtMs !== Number(item.afterStamp)) { skipped++; continue; }
        const current = record(profile.values);
        if (!fields.every((field) => JSON.stringify(current[field]) === JSON.stringify(afterValues[field]))) { skipped++; continue; }
        const restored = { ...current, ...record(item.previousValues) };
        await tx.update(brandProfilesTable).set({
          values: restored,
          updatedAtMs: Math.max(profile.updatedAtMs ?? 0, Date.now()) + 1,
        })
          .where(and(eq(brandProfilesTable.key, key), eq(brandProfilesTable.scope, scope)));
        applied++;
        // Older batches nested run snapshots under the profile record. Keep
        // honoring that legacy shape, while new batches use independent
        // run-values records above so profile undo cannot gate run undo.
        const runs = Array.isArray(item.runs) ? item.runs.map(record) : [];
        for (const run of runs) {
          const date = String(run.date ?? "");
          const runId = String(run.runId ?? "");
          const fields = snapshotFields(run.fields);
          const beforeStamp = finiteSnapshotStamp(run.beforeStamp);
          const afterStamp = finiteSnapshotStamp(run.afterStamp);
          const [day] = await tx.select().from(dailySyncTable)
            .where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, date))).for("update");
          if (!day || !runId || !fields || beforeStamp == null || afterStamp == null
            || !hasSnapshotValues(run.beforeValues, fields)
            || !hasSnapshotValues(run.afterValues, fields)) { skipped++; continue; }
          const data = record(day.data);
          const state = record(data.dayState);
          const found = (Array.isArray(state.runs) ? state.runs : []).map(record).find((value) => value.id === runId);
          const stamps = record(data.runValuesUpdatedAt);
          const values = record(record(data.runValues)[runId]);
          if (!found || found.startedAt != null || found.endedAt != null
            || Number(stamps[runId]) !== afterStamp
            || !fields.every((field) => JSON.stringify(values[field]) === JSON.stringify(record(run.afterValues)[field]))) {
            skipped++;
            continue;
          }
          const restoredRuns = { ...record(data.runValues), [runId]: { ...values, ...record(run.beforeValues) } };
          const restoredStamps = {
            ...stamps,
            [runId]: Math.max(Number(stamps[runId]) || 0, Date.now()) + 1,
          };
          await tx.update(dailySyncTable).set({
            data: { ...data, runValues: restoredRuns, runValuesUpdatedAt: restoredStamps },
            updatedAt: new Date(),
          }).where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, date)));
          repairedRuns++;
        }
      }
      const summary = { applied, skipped, failed: 0, repairedRuns };
      await tx.update(dataHealthRepairBatchesTable).set({ status: "undone", undoneAt: new Date(), summary })
        .where(eq(dataHealthRepairBatchesTable.id, batch.id));
      return { status: 200 as const, body: { batchId: batch.id, summary } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    req.log.error({ err }, "failed to undo profile data health repairs");
    res.status(500).json({ error: "Failed to undo profile data health repairs" });
  }
});

export default router;