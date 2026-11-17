import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  cycleCountSchedulesTable,
  type CycleCountScheduleRow,
} from "@workspace/db";
import {
  SaveCycleCountSchedulesBody,
  DeleteCycleCountSchedulesBody,
  MarkCycleCountCountedBody,
} from "@workspace/api-zod";
import {
  normalizeCycleCountSchedule,
  type CycleCountSchedule,
} from "@workspace/cycle-count";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Manager-defined, factory-wide cycle-count schedules. Reading is open to any
// signed-in user (both apps build the warehouse "Time to Count" card from them),
// while creating, updating, and deleting are manager-only — matching the
// production-rules / freezer-pull precedent (open GET, manager-gated writes).
// Marking a section counted is intentionally NOT manager-gated: floor staff
// perform the counts, so that endpoint only requires a signed-in user. Schedules
// are normalized + validated with the shared @workspace/cycle-count model so the
// server is the source of truth for what a well-formed schedule is. Gated on
// "manage-inventory" since this is warehouse/inventory master-data.

const MAX_BATCH = 500;

// Server's current date as YYYY-MM-DD, used as a fallback to stamp a section as
// counted. The due math is calendar-day based (cadence in days), so date
// granularity is sufficient.
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Validate a client-supplied "today" as an actual YYYY-MM-DD calendar date (not
// just the right shape). The clients compute their due list from the LOCAL
// factory day, so they pass that same date here to keep the stamp on the same
// basis and avoid timezone off-by-one drift. Returns null when absent/malformed
// so the caller can fall back to the server's own date.
function parseLocalDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

function toApiSchedule(row: CycleCountScheduleRow): CycleCountSchedule {
  return {
    id: row.id,
    section: row.section,
    cadenceDays: row.cadenceDays,
    lastCountedAt: row.lastCountedAt,
    enabled: row.enabled,
  };
}

async function listAll(): Promise<CycleCountSchedule[]> {
  const rows = await db
    .select()
    .from(cycleCountSchedulesTable)
    .where(eq(cycleCountSchedulesTable.scope, currentScope()));
  return rows.map(toApiSchedule);
}

router.get("/cycle-count-schedules", async (req: Request, res: Response) => {
  try {
    const schedules = await listAll();
    res.json({ schedules });
  } catch (err) {
    req.log.error({ err }, "failed to list cycle-count schedules");
    res.status(500).json({ error: "Failed to list cycle-count schedules" });
  }
});

router.post(
  "/cycle-count-schedules",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveCycleCountSchedulesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed schedules, then dedupe by id (last write wins)
    // so a single request can't fight itself with two values for the same id.
    const byId = new Map<string, CycleCountSchedule>();
    for (const raw of parsed.data.schedules.slice(0, MAX_BATCH)) {
      const schedule = normalizeCycleCountSchedule(raw);
      if (schedule) byId.set(schedule.id, schedule);
    }

    try {
      for (const schedule of byId.values()) {
        await db
          .insert(cycleCountSchedulesTable)
          .values({
            id: schedule.id,
            scope: currentScope(),
            section: schedule.section,
            cadenceDays: schedule.cadenceDays,
            lastCountedAt: schedule.lastCountedAt,
            enabled: schedule.enabled,
            updatedAt: new Date(),
          })
          // Preserve `lastCountedAt` on update — only the mark-counted endpoint
          // changes it, so editing a schedule's section/cadence never resets the
          // count history.
          .onConflictDoUpdate({
            target: [cycleCountSchedulesTable.id, cycleCountSchedulesTable.scope],
            set: {
              section: schedule.section,
              cadenceDays: schedule.cadenceDays,
              enabled: schedule.enabled,
              updatedAt: new Date(),
            },
          });
      }
      const schedules = await listAll();
      res.json({ schedules });
    } catch (err) {
      req.log.error({ err }, "failed to save cycle-count schedules");
      res.status(500).json({ error: "Failed to save cycle-count schedules" });
    }
  },
);

router.delete(
  "/cycle-count-schedules",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteCycleCountSchedulesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const ids = parsed.data.ids
      .slice(0, MAX_BATCH)
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);

    try {
      if (ids.length > 0) {
        await db
          .delete(cycleCountSchedulesTable)
          .where(
            and(
              inArray(cycleCountSchedulesTable.id, ids),
              eq(cycleCountSchedulesTable.scope, currentScope()),
            ),
          );
      }
      const schedules = await listAll();
      res.json({ schedules });
    } catch (err) {
      req.log.error({ err }, "failed to delete cycle-count schedules");
      res.status(500).json({ error: "Failed to delete cycle-count schedules" });
    }
  },
);

// Stamp a section as counted now. Open to any signed-in user (requireAuth is
// applied globally) — floor staff perform the counts. NOT manager-gated.
router.post(
  "/cycle-count-schedules/:id/mark-counted",
  async (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    // Prefer the client's local factory day so the stamp matches the basis the
    // clients use to compute the due list; fall back to the server's date.
    const parsedBody = MarkCycleCountCountedBody.safeParse(req.body ?? {});
    const countedOn =
      (parsedBody.success ? parseLocalDay(parsedBody.data.today) : null) ??
      todayStr();

    try {
      const updated = await db
        .update(cycleCountSchedulesTable)
        .set({ lastCountedAt: countedOn, updatedAt: new Date() })
        .where(
          and(
            eq(cycleCountSchedulesTable.id, id),
            eq(cycleCountSchedulesTable.scope, currentScope()),
          ),
        )
        .returning();
      if (updated.length === 0) {
        res.status(404).json({ error: "Schedule not found" });
        return;
      }
      const schedules = await listAll();
      res.json({ schedules });
    } catch (err) {
      req.log.error({ err }, "failed to mark cycle-count section counted");
      res.status(500).json({ error: "Failed to mark section counted" });
    }
  },
);

export default router;
