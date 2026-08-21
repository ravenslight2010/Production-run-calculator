import { and, eq, gte, lte } from "drizzle-orm";
import * as z from "zod";
import {
  aggregateDaySummary,
  type DaySummaryInput,
  type OperationalReport,
} from "@workspace/day-summary";
import {
  db,
  incidentsTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  qualityChecksTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const RunSchema = z.object({
  brand: z.string(),
  flavor: z.string(),
  casesPlanned: z.number().finite(),
  casesProduced: z.number().finite(),
  finished: z.boolean(),
  downtimeMinutes: z.number().finite(),
  stoppageCount: z.number().finite(),
});
const BodySchema = z.object({
  scope: z.enum(["day", "week"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runs: z.array(RunSchema).max(600),
});

function addDays(iso: string, amount: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function dateRange(scope: "day" | "week", date: string): [string, string] {
  return scope === "week" ? [addDays(date, -6), date] : [date, date];
}

router.post(
  "/reports/operational",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid operational report input" });
      return;
    }
    const input = parsed.data;
    const [periodStart, periodEnd] = dateRange(input.scope, input.date);
    const scope = currentScope();
    const [qualityRows, incidentRows, inventoryRows, lots] = await Promise.all([
      db.select().from(qualityChecksTable).where(
        and(
          eq(qualityChecksTable.scope, scope),
          gte(qualityChecksTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(qualityChecksTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      ),
      db.select().from(incidentsTable).where(
        and(
          eq(incidentsTable.scope, scope),
          gte(incidentsTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(incidentsTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      ),
      db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.scope, scope)),
      db.select().from(inventoryLotsTable).where(eq(inventoryLotsTable.scope, scope)),
    ]);
    let historicalInventory: NonNullable<
      NonNullable<OperationalReport["inventory"]["value"]>["historical"]
    >;
    try {
      const ledgerRows = await db
        .select()
        .from(inventoryLedgerTable)
        .where(
          and(
            eq(inventoryLedgerTable.scope, scope),
            gte(inventoryLedgerTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
            lte(inventoryLedgerTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
          ),
        );
      const consumptionEvents = ledgerRows.filter((row) => row.type === "consume").length;
      const wasteEvents = ledgerRows.filter(
        (row) => row.type === "adjust" && row.qtyDelta < 0,
      ).length;
      historicalInventory = {
        availability: "available",
        value: {
          totalEvents: ledgerRows.length,
          consumptionEvents,
          wasteEvents,
          adjustmentEvents: ledgerRows.filter((row) => row.type === "adjust").length,
        },
        note: "Historical inventory ledger events recorded during this period.",
      };
    } catch {
      historicalInventory = {
        availability: "unavailable",
        value: null,
        note: "Historical inventory ledger is unavailable; no historical event totals are shown.",
      };
    }
    const onHand = new Map<number, number>();
    for (const lot of lots) onHand.set(lot.itemId, (onHand.get(lot.itemId) ?? 0) + lot.qtyRemaining);
    const flaggedItems = inventoryRows.filter(
      (item) => item.reorderThreshold > 0 && (onHand.get(item.id) ?? 0) <= item.reorderThreshold,
    ).length;
    const qualityIssues = qualityRows.reduce((n, row) => n + (Array.isArray(row.issues) ? row.issues.length : 0), 0);
    const productionInput: DaySummaryInput = {
      scope: input.scope,
      date: input.date,
      runs: input.runs,
      incidentCount: incidentRows.length,
      wasteFlaggedCount: flaggedItems,
    };
    const report: OperationalReport = {
      scope: input.scope,
      date: input.date,
      periodStart,
      periodEnd,
      generatedAt: new Date().toISOString(),
      production: aggregateDaySummary(productionInput),
      quality: {
        availability: "available",
        value: {
          checks: qualityRows.length,
          issues: qualityIssues,
          failed: qualityRows.filter((r) => r.status === "fail").length,
          warnings: qualityRows.filter((r) => r.status === "warn").length,
        },
        note: qualityRows.length === 0 ? "No quality checks were recorded in this period." : undefined,
      },
      incidents: {
        availability: "available",
        value: {
          total: incidentRows.length,
          unresolved: incidentRows.filter((r) => r.status !== "resolved").length,
        },
        note: incidentRows.length === 0 ? "No incidents were recorded in this period." : undefined,
      },
      inventory: {
        availability: "available",
        value: { flaggedItems, historical: historicalInventory },
        note: "Current inventory snapshot; not a historical period total.",
      },
    };
    res.json(report);
  },
);

export default router;