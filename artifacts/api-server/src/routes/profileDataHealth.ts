import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  auditLogsTable,
  brandProfilesTable,
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
  nextValues: JsonRecord;
};

export type ProfileDataHealthReport = {
  findings: ProfileDataHealthFinding[];
  safeRepairs: ProfileDataHealthRepair[];
  summary: Record<string, number>;
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
        repair = { id, profileKey: profile.key, recipeKind: kind, fingerprint, fields: [fields.name, fields.rows], nextValues };
      } else if (currentName && !currentRecipe) {
        if (expectedName && expectedRecipe) {
          const nextValues = { ...values, [fields.name]: expectedRecipe.name, [fields.rows]: expectedRecipe.components };
          finding = { ...base, status: "missing-recipe", repairable: true, message: `Replace the missing ${kind} recipe with the exact saved-sheet link.` };
          repair = { id, profileKey: profile.key, recipeKind: kind, fingerprint, fields: [fields.name, fields.rows], nextValues };
        } else {
          finding = { ...base, status: "missing-recipe", repairable: false, message: `The linked ${kind} recipe is not in the current recipe pool.` };
        }
      } else if (currentRecipe && currentRows.length === 0 && currentRecipe.components.length > 0) {
        const nextValues = { ...values, [fields.rows]: currentRecipe.components };
        finding = { ...base, status: "missing-rows", repairable: true, message: `Hydrate the empty ${kind} recipe rows from the linked recipe.` };
        repair = { id, profileKey: profile.key, recipeKind: kind, fingerprint, fields: [fields.rows], nextValues };
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

router.post("/profile-data/health-check/apply", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const result = await db.transaction(async (tx) => {
      const before = await profileDataHealthReport(tx);
      const repairedByProfile = new Map<string, { values: JsonRecord; fields: string[] }>();
      const applied: ProfileDataHealthRepair[] = [];
      const now = Date.now();

      for (const repair of before.safeRepairs) {
        const [profile] = await tx.select().from(brandProfilesTable).where(
          and(eq(brandProfilesTable.key, repair.profileKey), eq(brandProfilesTable.scope, scope)),
        ).for("update");
        if (!profile) continue;
        const values = record(profile.values);
        if (!repairStillMatches(values, profile.updatedAtMs, repair)) continue;
        const stamp = Math.max(profile.updatedAtMs ?? 0, now) + 1;
        await tx.update(brandProfilesTable)
          .set({ values: repair.nextValues, updatedAtMs: stamp })
          .where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, scope)));
        repairedByProfile.set(
          `${profileKey(profile.brand, profile.flavor)}`,
          { values: repair.nextValues, fields: repair.fields },
        );
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
            for (const field of changedProfile.fields) nextRunValues[field] = changedProfile.values[field];
            nextValues[id] = nextRunValues;
            const oldStamp = Number(nextStamps[id]);
            nextStamps[id] = Math.max(Number.isFinite(oldStamp) ? oldStamp : 0, now) + 1;
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

      if (applied.length > 0) {
        await tx.insert(auditLogsTable).values({
          scope,
          actor: req.userId ?? "unknown",
          action: "profile_data_health_repair",
          resource: "brand_profiles",
          changes: {
            profiles: applied.map((repair) => ({ profileKey: repair.profileKey, recipeKind: repair.recipeKind, fields: repair.fields })),
            repairedRuns,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
        });
      }
      return { before, after: await profileDataHealthReport(tx), applied, summary: { repairedProfiles: applied.length, repairedRuns } };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "failed to apply profile data health repairs");
    res.status(500).json({ error: "Failed to apply profile data health repairs" });
  }
});

export default router;