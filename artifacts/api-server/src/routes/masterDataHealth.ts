import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, masterDataHealthScansTable, importAliasesTable, specImportAliasesTable, mergeAliasesTable, brandProfilesTable } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import { buildMasterDataHealthReport } from "../lib/masterDataHealth";

const router = Router();
const canReview = requireCapability("manage-profiles");

router.get("/master-data/health", canReview, async (req: Request, res: Response) => {
  try {
    const [latest] = await db.select().from(masterDataHealthScansTable)
      .where(eq(masterDataHealthScansTable.scope, currentScope()))
      .orderBy(desc(masterDataHealthScansTable.completedAt)).limit(1);
    const report = latest?.report ?? await buildMasterDataHealthReport(db, currentScope());
    res.json({ report, persistedAt: latest?.completedAt ?? null });
  } catch (err) {
    req.log.error({ err }, "failed to read master-data health");
    res.status(500).json({ error: "Failed to read master-data health" });
  }
});

router.get("/master-data/health/history", canReview, async (req: Request, res: Response) => {
  try {
    const scans = await db.select({
      id: masterDataHealthScansTable.id,
      environment: masterDataHealthScansTable.environment,
      startedAt: masterDataHealthScansTable.startedAt,
      completedAt: masterDataHealthScansTable.completedAt,
      status: masterDataHealthScansTable.status,
      summary: masterDataHealthScansTable.report,
    }).from(masterDataHealthScansTable)
      .where(eq(masterDataHealthScansTable.scope, currentScope()))
      .orderBy(desc(masterDataHealthScansTable.completedAt)).limit(50);
    res.json({
      scans: scans.map((scan) => ({
        ...scan,
        summary: (scan.summary as { summary?: unknown } | null)?.summary ?? {},
      })),
    });
  } catch (err) {
    req.log.error({ err }, "failed to read master-data health history");
    res.status(500).json({ error: "Failed to read master-data health history" });
  }
});

router.post("/master-data/health/scan", canReview, async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const startedAt = new Date();
    const report = await buildMasterDataHealthReport(db, scope, startedAt);
    await db.insert(masterDataHealthScansTable).values({
      id: report.scanId, scope, environment: report.environment, startedAt,
      completedAt: new Date(), status: "completed", report,
    });
    res.json({ report });
  } catch (err) {
    req.log.error({ err }, "failed to run master-data health scan");
    res.status(500).json({ error: "Failed to run master-data health scan" });
  }
});

router.post("/master-data/health/repair", canReview, async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const report = await buildMasterDataHealthReport(db, scope);
    const requested = new Set(Array.isArray(req.body?.findingIds) ? req.body.findingIds.filter((id: unknown): id is string => typeof id === "string") : []);
    const repairs = report.repairs.filter((repair) =>
      repair.action === "update-profile-recipe-link"
        ? requested.size > 0 && requested.has(repair.findingId)
        : requested.size === 0 || requested.has(repair.findingId),
    );
    // Preview is the safe default. A caller must opt in explicitly after
    // reviewing the proposed rows.
    if (req.body?.apply !== true) {
      res.json({ preview: repairs, applied: 0, report });
      return;
    }
    let applied = 0;
    for (const repair of repairs) {
      if (repair.action === "update-profile-recipe-link") {
        const [profile] = await db.select().from(brandProfilesTable)
          .where(and(eq(brandProfilesTable.key, repair.profileKey), eq(brandProfilesTable.scope, scope)));
        const values = profile?.values && typeof profile.values === "object" ? profile.values as Record<string, unknown> : {};
        if (!profile || String(values[repair.field] ?? "") !== repair.from) continue;
        await db.update(brandProfilesTable)
          .set({ values: { ...values, [repair.field]: repair.to }, updatedAtMs: Date.now() + 1 })
          .where(and(eq(brandProfilesTable.key, repair.profileKey), eq(brandProfilesTable.scope, scope)));
        applied++;
        continue;
      }
      const id = repair.rowId;
      const table = repair.source === "import" ? importAliasesTable
        : repair.source === "spec" ? specImportAliasesTable : mergeAliasesTable;
      const deleted = await db.delete(table).where(and(eq(table.id, id), eq(table.scope, scope))).returning({ id: table.id });
      if (deleted.length) applied++;
    }
    res.json({ preview: report.repairs, applied, report: await buildMasterDataHealthReport(db, scope) });
  } catch (err) {
    req.log.error({ err }, "failed to repair master-data health");
    res.status(500).json({ error: "Failed to repair master-data health" });
  }
});

export default router;