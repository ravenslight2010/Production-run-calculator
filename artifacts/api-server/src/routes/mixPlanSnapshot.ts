// Server-authority mix plan snapshot.
//
// GET /mix-plan-snapshot?makeDay=YYYY-MM-DD&today=YYYY-MM-DD returns the same
// make-day plan the web Mixes tab builds locally (buildMixPlan over canonical
// live + scheduled runs and the server mix pool). The web tab prefers this
// response when online and falls back to its own buildMixPlan call when
// offline, so batches/lbs can never drift between devices and the CPU cost of
// the plan is paid once on the server.
//
// Math parity: feeds the SAME @workspace/mixes buildMixPlan function the web +
// mobile apps use. Run resolution mirrors the web MixesTabContent helper
// (computeSummaryStats + computeCheesePerPizzaOz via lib/mixPlanSnapshot.ts).

import { Router, type Request, type Response } from "express";
import { and, eq, asc, gte } from "drizzle-orm";
import {
  db,
  dailySyncTable,
  brandProfilesTable,
  mixesTable,
} from "@workspace/db";
import { normalizeMix, type Mix } from "@workspace/mixes";
import { currentScope } from "../lib/requestScope";
import { facilityDate } from "../lib/facilityTime";
import { computeMixPlanSnapshot, type MixPlanRunInput } from "../lib/mixPlanSnapshot";

const router: Router = Router();

function clientToday(req: Request): string {
  const t = req.query.today;
  return typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : facilityDate();
}

function makeDay(req: Request): string {
  const t = req.query.makeDay;
  return typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : facilityDate();
}

// Mirror the server pool representation used by the mixes route: rows carry the
// shared Mix shape after normalization.
function toApiItem(row: typeof mixesTable.$inferSelect): Mix {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    brand: row.brand,
    flavor: row.flavor,
    batchSize: row.batchSize,
    daysEarly: row.daysEarly,
    notes: row.notes,
    amountAlreadyMade: row.amountAlreadyMade,
    components: row.components ?? [],
    isPrep: row.isPrep ?? false,
    enabled: row.enabled,
  };
}

function profileValuesFor(
  profiles: Map<string, { values?: Record<string, unknown>; crustValues?: Record<string, unknown> }>,
  brand: string,
  flavor: string,
): Record<string, unknown> | null {
  const key = `${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
  const profile = profiles.get(key);
  if (!profile) return null;
  return { ...(profile.values ?? {}), ...(profile.crustValues ?? {}) };
}

router.get("/inventory/mix-plan-snapshot", async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const today = clientToday(req);
    const selectedMakeDay = makeDay(req);

    const rows = await db
      .select()
      .from(dailySyncTable)
      .where(and(eq(dailySyncTable.scope, scope), gte(dailySyncTable.date, today)))
      .orderBy(asc(dailySyncTable.date));
    const profiles = await db
      .select()
      .from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, scope));
    const profileCache = new Map(profiles.map((p) => [p.key, p]));
    const mixRows = await db
      .select()
      .from(mixesTable)
      .where(eq(mixesTable.scope, scope));
    const mixes: Mix[] = mixRows.map(toApiItem).map((m) => normalizeMix(m)).filter((m): m is Mix => m !== null);

    const liveRuns: MixPlanRunInput[] = [];
    const scheduledRuns: MixPlanRunInput[] = [];

    for (const row of rows) {
      const data = row.data as {
        dayState?: {
          runs?: Array<{ id?: string; brand?: string; flavor?: string; endedAt?: string | null }>;
        };
        runValues?: Record<string, Record<string, unknown>>;
      } | null;
      const runs = data?.dayState?.runs ?? [];
      const runValues = data?.runValues ?? {};
      for (const run of runs) {
        if (!run?.id || !run.brand) continue;
        const rawVals = runValues[run.id];
        if (!rawVals || typeof rawVals !== "object") continue;
        if (row.date === today) {
          // Today's live runs (mirror the web tab: brand set, not ended).
          if (run.endedAt) continue;
          liveRuns.push({
            date: row.date,
            brand: run.brand,
            flavor: run.flavor ?? "",
            values: rawVals,
          });
        } else {
          // Future scheduled runs resolve via the brand profile pool, same as
          // the web valsToMixRun path (profile + casesNeeded + dieType overlay).
          const profile = profileValuesFor(profileCache, String(run.brand ?? ""), String(run.flavor ?? ""));
          const values: Record<string, unknown> = {
            ...(profile ?? {}),
            casesNeeded: Number((rawVals as Record<string, unknown>).casesNeeded) || 0,
            ...(run.brand ? { brand: run.brand } : {}),
            ...(run.flavor ? { flavor: run.flavor } : {}),
            ...(String((rawVals as Record<string, unknown>).dieType ?? "") ? { dieType: String((rawVals as Record<string, unknown>).dieType) } : {}),
          };
          scheduledRuns.push({
            date: row.date,
            brand: run.brand,
            flavor: run.flavor ?? "",
            values,
          });
        }
      }
    }

    const plan = computeMixPlanSnapshot({
      liveRuns,
      scheduledRuns,
      mixes,
      makeDay: selectedMakeDay,
    });

    res.json({ plan, generatedAt: Date.now() });
  } catch (err) {
    req.log.error({ err }, "mix_plan_snapshot_failed");
    res.status(500).json({ error: "Couldn't build the mix plan. Try again." });
  }
});

export default router;
