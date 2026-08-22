import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  auditLogsTable,
  brandProfilesTable,
  dataHealsTable,
  dataHealthRepairBatchesTable,
  dailySyncTable,
  db,
  doughRecipesTable,
  savedSpecSheetsTable,
  sauceRecipesTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

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
  category: "profile-links" | "recipe-records" | "import-review" | "cleanup-history";
  severity: "info" | "warning" | "error";
  repairability: "safe" | "review";
  brand: string;
  flavor: string;
  recipe: string;
  message: string;
  proposedRepair: string;
  source: "profile-health" | "saved-spec" | "cleanup";
  sourceRoute: "setupProfiles" | "import" | "merge" | "audit";
  profileFinding?: ProfileDataHealthFinding;
};

export type DataHealthWorkspace = {
  findings: DataHealthFinding[];
  safeRepairs: ProfileDataHealthRepair[];
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
  repairBatches: DataHealthRepairBatchSummary[];
};

type RepairBatchRecord = {
  profileKey: string;
  brand: string;
  flavor: string;
  recipeKind: RecipeKind;
  fields: string[];
  beforeValues: JsonRecord;
  afterValues: JsonRecord;
  beforeStamp: number;
  afterStamp: number;
  runs: Array<{
    runId: string;
    date: string;
    fields: string[];
    beforeValues: JsonRecord;
    afterValues: JsonRecord;
    beforeStamp: number;
    afterStamp: number;
  }>;
};

type DataHealthRepairBatchSummary = {
  id: string;
  scope: string;
  actor: string;
  appliedAt: Date;
  undoneAt: Date | null;
  status: string;
  summary: { applied: number; skipped: number; failed: number; repairedRuns: number };
};

const router = Router();

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
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
      if (!currentName && expectedName && expectedRecipe) {
        const nextValues = { ...values, [fields.name]: expectedRecipe.name, [fields.rows]: expectedRecipe.components };
        finding = { ...base, status: "missing-link", repairable: true, message: `Restore the saved ${kind} recipe link.` };
        repair = {
          id,
          profileKey: profile.key,
          recipeKind: kind,
          fingerprint,
          fields: [fields.name, fields.rows],
          previousValues: Object.fromEntries([fields.name, fields.rows].map((field) => [field, values[field]])),
          nextValues,
        };
      } else if (currentName && !currentRecipe) {
        if (expectedName && expectedRecipe) {
          const nextValues = { ...values, [fields.name]: expectedRecipe.name, [fields.rows]: expectedRecipe.components };
          finding = { ...base, status: "missing-recipe", repairable: true, message: `Replace the missing ${kind} recipe with the exact saved-sheet link.` };
          repair = {
            id,
            profileKey: profile.key,
            recipeKind: kind,
            fingerprint,
            fields: [fields.name, fields.rows],
            previousValues: Object.fromEntries([fields.name, fields.rows].map((field) => [field, values[field]])),
            nextValues,
          };
        } else {
          finding = { ...base, status: "missing-recipe", repairable: false, message: `The linked ${kind} recipe is not in the current recipe pool.` };
        }
      } else if (currentRecipe && currentRows.length === 0 && currentRecipe.components.length > 0) {
        const nextValues = { ...values, [fields.rows]: currentRecipe.components };
        finding = { ...base, status: "missing-rows", repairable: true, message: `Hydrate the empty ${kind} recipe rows from the linked recipe.` };
        repair = {
          id,
          profileKey: profile.key,
          recipeKind: kind,
          fingerprint,
          fields: [fields.rows],
          previousValues: { [fields.rows]: values[fields.rows] },
          nextValues,
        };
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
    source: importMismatch ? "saved-spec" : "profile-health",
    sourceRoute: importMismatch ? "import" : review ? "setupProfiles" : "audit",
    profileFinding: finding,
  };
}

export async function dataHealthWorkspace(executor: HealthExecutor): Promise<DataHealthWorkspace> {
  const scope = currentScope();
  const report = await profileDataHealthReport(executor);
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
  const findings = report.findings.map(workspaceFinding);
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
  const repairBatches = await executor
    .select({
      id: dataHealthRepairBatchesTable.id,
      scope: dataHealthRepairBatchesTable.scope,
      actor: dataHealthRepairBatchesTable.actor,
      appliedAt: dataHealthRepairBatchesTable.appliedAt,
      undoneAt: dataHealthRepairBatchesTable.undoneAt,
      status: dataHealthRepairBatchesTable.status,
      summary: dataHealthRepairBatchesTable.summary,
    })
    .from(dataHealthRepairBatchesTable)
    .where(eq(dataHealthRepairBatchesTable.scope, scope))
    .orderBy(desc(dataHealthRepairBatchesTable.appliedAt))
    .limit(10);
  return {
    findings,
    safeRepairs: report.safeRepairs,
    summary,
    cleanupHistory,
    repairBatches: repairBatches.map((batch) => {
      const result = record(batch.summary);
      return {
        ...batch,
        summary: {
          applied: Number(result.applied) || 0,
          skipped: Number(result.skipped) || 0,
          failed: Number(result.failed) || 0,
          repairedRuns: Number(result.repairedRuns) || 0,
        },
      };
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
    const result = await db.transaction(async (tx) => {
      const before = await profileDataHealthReport(tx);
      const repairedByProfile = new Map<string, { values: JsonRecord; fields: string[] }>();
      const batchRecords = new Map<string, RepairBatchRecord>();
      const applied: ProfileDataHealthRepair[] = [];
      let skipped = 0;
      let failed = 0;
      const now = Date.now();

      for (const repair of before.safeRepairs) {
        const [profile] = await tx.select().from(brandProfilesTable).where(
          and(eq(brandProfilesTable.key, repair.profileKey), eq(brandProfilesTable.scope, scope)),
        ).for("update");
         if (!profile) { skipped++; continue; }
        const values = record(profile.values);
         if (!repairStillMatches(values, profile.updatedAtMs, repair)) { skipped++; continue; }
        const stamp = Math.max(profile.updatedAtMs ?? 0, now) + 1;
          const existing = repairedByProfile.get(profile.key);
          const existingBatch = batchRecords.get(profile.key);
         const changedFields = existing ? [...new Set([...existing.fields, ...repair.fields])] : repair.fields;
          const beforeValues = existing
            ? record(existingBatch?.beforeValues)
           : Object.fromEntries(repair.fields.map((field) => [field, values[field]]));
         const afterValues = Object.fromEntries(changedFields.map((field) => [field, repair.nextValues[field]]));
        await tx.update(brandProfilesTable)
          .set({ values: repair.nextValues, updatedAtMs: stamp })
          .where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, scope)));
        repairedByProfile.set(
          `${profileKey(profile.brand, profile.flavor)}`,
           { values: { ...(existing?.values ?? values), ...repair.nextValues }, fields: changedFields },
        );
         batchRecords.set(profile.key, {
           profileKey: profile.key,
           brand: profile.brand,
           flavor: profile.flavor,
           recipeKind: repair.recipeKind,
           fields: changedFields,
           beforeValues,
           afterValues,
            beforeStamp: existingBatch?.beforeStamp ?? (profile.updatedAtMs ?? 0),
           afterStamp: stamp,
           runs: batchRecords.get(profile.key)?.runs ?? [],
         });
        applied.push(repair);
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
             const beforeRunValues = Object.fromEntries(changedProfile.fields.map((field) => [field, runValues[field]]));
             for (const field of changedProfile.fields) nextRunValues[field] = changedProfile.values[field];
            nextValues[id] = nextRunValues;
            const oldStamp = Number(nextStamps[id]);
            const beforeStamp = Number.isFinite(oldStamp) ? oldStamp : 0;
            const afterStamp = Math.max(beforeStamp, now) + 1;
            nextStamps[id] = afterStamp;
            const batchRecord = [...batchRecords.values()].find((item) => profileKey(item.brand, item.flavor) === profileKey(run.brand, run.flavor));
            batchRecord?.runs.push({
              runId: id,
              date: day.date,
              fields: changedProfile.fields,
              beforeValues: beforeRunValues,
              afterValues: Object.fromEntries(changedProfile.fields.map((field) => [field, nextRunValues[field]])),
              beforeStamp,
              afterStamp,
            });
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

       const batchId = `profile-data-health:${now}:${Math.random().toString(36).slice(2, 10)}`;
       if (applied.length > 0) {
         const batchSummary = { applied: applied.length, skipped, failed, repairedRuns };
         await tx.insert(dataHealthRepairBatchesTable).values({
           id: batchId,
           scope,
           actor: req.userId ?? "unknown",
           status: "applied",
           records: [...batchRecords.values()],
           summary: batchSummary,
         });
        await tx.insert(auditLogsTable).values({
          scope,
          actor: req.userId ?? "unknown",
          action: "profile_data_health_repair",
          resource: "brand_profiles",
          changes: {
            profiles: applied.map((repair) => ({ profileKey: repair.profileKey, recipeKind: repair.recipeKind, fields: repair.fields })),
            repairedRuns,
             batchId,
             applied: applied.length,
             skipped,
             failed,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
        });
      }
       const oldBatches = await tx.select({ id: dataHealthRepairBatchesTable.id })
         .from(dataHealthRepairBatchesTable)
         .where(eq(dataHealthRepairBatchesTable.scope, scope))
         .orderBy(desc(dataHealthRepairBatchesTable.appliedAt))
         .limit(100);
       if (oldBatches.length > 20) {
         await tx.delete(dataHealthRepairBatchesTable).where(inArray(dataHealthRepairBatchesTable.id, oldBatches.slice(20).map((item) => item.id)));
       }
       return {
         before,
         after: await profileDataHealthReport(tx),
         applied,
         batchId: applied.length > 0 ? batchId : null,
         summary: { repairedProfiles: applied.length, repairedRuns },
         outcome: { applied: applied.length, skipped, failed, repairedRuns },
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
      const [batch] = await tx.select().from(dataHealthRepairBatchesTable).where(
          and(eq(dataHealthRepairBatchesTable.id, String(req.params.batchId)), eq(dataHealthRepairBatchesTable.scope, scope)),
      ).for("update");
      if (!batch) return { status: 404 as const, body: { error: "Repair batch not found" } };
      if (batch.status !== "applied") return { status: 409 as const, body: { error: "Repair batch is no longer eligible for undo" } };
      const records = Array.isArray(batch.records) ? batch.records as RepairBatchRecord[] : [];
      let applied = 0;
      let skipped = 0;
      let failed = 0;
      let repairedRuns = 0;
      for (const item of records) {
        const [profile] = await tx.select().from(brandProfilesTable).where(
          and(eq(brandProfilesTable.key, item.profileKey), eq(brandProfilesTable.scope, scope)),
        ).for("update");
        if (!profile || profile.updatedAtMs !== item.afterStamp) { skipped++; continue; }
        const current = record(profile.values);
        const matches = item.fields.every((field) => JSON.stringify(current[field]) === JSON.stringify(item.afterValues[field]));
        if (!matches) { skipped++; continue; }
        const restore = { ...current, ...item.beforeValues };
        const stamp = Math.max(profile.updatedAtMs ?? 0, Date.now()) + 1;
        await tx.update(brandProfilesTable).set({ values: restore, updatedAtMs: stamp }).where(
          and(eq(brandProfilesTable.key, item.profileKey), eq(brandProfilesTable.scope, scope)),
        );
        applied++;
        for (const run of item.runs) {
          const [day] = await tx.select().from(dailySyncTable).where(
            and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, run.date)),
          ).for("update");
          const data = record(day?.data);
          const dayState = record(data.dayState);
          const foundRun = (Array.isArray(dayState.runs) ? dayState.runs : []).map(record).find((entry) => entry.id === run.runId);
          if (!day || !foundRun || foundRun.startedAt != null || foundRun.endedAt != null) { skipped++; continue; }
          const values = record(record(data.runValues)[run.runId]);
          const stamps = record(data.runValuesUpdatedAt);
          if (Number(stamps[run.runId]) !== run.afterStamp || !run.fields.every((field) => JSON.stringify(values[field]) === JSON.stringify(run.afterValues[field]))) {
            skipped++;
            continue;
          }
          const nextValues = { ...record(data.runValues), [run.runId]: { ...values, ...run.beforeValues } };
          const nextStamps = { ...stamps, [run.runId]: Math.max(Number(stamps[run.runId]) || 0, Date.now()) + 1 };
          await tx.update(dailySyncTable).set({ data: { ...data, runValues: nextValues, runValuesUpdatedAt: nextStamps }, updatedAt: new Date() }).where(
            and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, run.date)),
          );
          repairedRuns++;
        }
      }
      if (applied === 0 && skipped === 0) failed++;
      const summary = { applied, skipped, failed, repairedRuns };
      await tx.update(dataHealthRepairBatchesTable).set({ status: "undone", undoneAt: new Date(), summary }).where(eq(dataHealthRepairBatchesTable.id, batch.id));
      await tx.insert(auditLogsTable).values({
        scope,
        actor: req.userId ?? "unknown",
        action: "profile_data_health_repair_undo",
        resource: "brand_profiles",
        changes: { batchId: batch.id, ...summary },
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      return { status: 200 as const, body: { batchId: batch.id, summary } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    req.log.error({ err }, "failed to undo profile data health repairs");
    res.status(500).json({ error: "Failed to undo profile data health repairs" });
  }
});

export default router;