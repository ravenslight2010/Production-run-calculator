import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, dieLineDefaultsTable, type DieLineDefaultsRow } from "@workspace/db";
import { SaveDieLineDefaultsBody, DeleteDieLineDefaultsBody } from "@workspace/api-zod";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Manager-editable per-die line-setting defaults. Picking a die on the run
// form / setup editor pre-fills line settings; those numbers used to be
// hard-coded in the web app. Reading is open to any signed-in user (the run
// form needs the values to pre-fill), writes are manager-gated on
// "manage-inventory" — matching the freezer-pull / production-rules precedent
// (open GET, manager-gated writes). Dies with no stored entry fall back to the
// app's built-in defaults, so this table only holds explicit overrides.

const MAX_BATCH = 200;

// Case-folded canonical id so upserts are idempotent across spellings while
// the display spelling (`name`) is preserved.
function dieId(name: string): string {
  return name.trim().toLowerCase();
}

interface ApiEntry {
  name: string;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  freezerTime: number;
  casesPerLayer: number;
}

const NUMERIC_FIELDS = [
  "crustsPerCycle",
  "cycleSpeed",
  "speedAdjustment",
  "freezerTime",
  "casesPerLayer",
] as const;

// Normalize one entry: trim the name, coerce/clamp numbers to finite,
// non-negative values with a sane cap. Returns null for malformed entries.
function normalizeEntry(raw: unknown): ApiEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name || name.length > 200) return null;
  const out: ApiEntry = {
    name,
    crustsPerCycle: 0,
    cycleSpeed: 0,
    speedAdjustment: 1,
    freezerTime: 0,
    casesPerLayer: 0,
  };
  for (const field of NUMERIC_FIELDS) {
    const n = Number(r[field]);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
    out[field] = n;
  }
  return out;
}

function toApiEntry(row: DieLineDefaultsRow): ApiEntry {
  return {
    name: row.name,
    crustsPerCycle: row.crustsPerCycle,
    cycleSpeed: row.cycleSpeed,
    speedAdjustment: row.speedAdjustment,
    freezerTime: row.freezerTime,
    casesPerLayer: row.casesPerLayer,
  };
}

async function listAll(): Promise<ApiEntry[]> {
  const rows = await db
    .select()
    .from(dieLineDefaultsTable)
    .where(eq(dieLineDefaultsTable.scope, currentScope()));
  return rows.map(toApiEntry).sort((a, b) => a.name.localeCompare(b.name));
}

router.get("/die-line-defaults", async (req: Request, res: Response) => {
  try {
    res.json({ entries: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to list die line defaults");
    res.status(500).json({ error: "Failed to list die line defaults" });
  }
});

router.post(
  "/die-line-defaults",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveDieLineDefaultsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    // Dedupe by canonical id (last write wins) so one request can't fight itself.
    const byId = new Map<string, ApiEntry>();
    for (const raw of parsed.data.entries.slice(0, MAX_BATCH)) {
      const entry = normalizeEntry(raw);
      if (entry) byId.set(dieId(entry.name), entry);
    }
    try {
      for (const [id, entry] of byId) {
        const values = {
          id,
          scope: currentScope(),
          name: entry.name,
          crustsPerCycle: entry.crustsPerCycle,
          cycleSpeed: entry.cycleSpeed,
          speedAdjustment: entry.speedAdjustment,
          freezerTime: entry.freezerTime,
          casesPerLayer: entry.casesPerLayer,
          updatedAt: new Date(),
        };
        await db
          .insert(dieLineDefaultsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [dieLineDefaultsTable.id, dieLineDefaultsTable.scope],
            set: {
              name: values.name,
              crustsPerCycle: values.crustsPerCycle,
              cycleSpeed: values.cycleSpeed,
              speedAdjustment: values.speedAdjustment,
              freezerTime: values.freezerTime,
              casesPerLayer: values.casesPerLayer,
              updatedAt: values.updatedAt,
            },
          });
      }
      res.json({ entries: await listAll() });
    } catch (err) {
      req.log.error({ err }, "failed to save die line defaults");
      res.status(500).json({ error: "Failed to save die line defaults" });
    }
  },
);

router.delete(
  "/die-line-defaults",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteDieLineDefaultsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const ids = [
      ...new Set(
        parsed.data.names
          .slice(0, MAX_BATCH)
          .map((n) => (typeof n === "string" ? dieId(n) : ""))
          .filter(Boolean),
      ),
    ];
    try {
      if (ids.length > 0) {
        await db
          .delete(dieLineDefaultsTable)
          .where(
            and(
              inArray(dieLineDefaultsTable.id, ids),
              eq(dieLineDefaultsTable.scope, currentScope()),
            ),
          );
      }
      res.json({ entries: await listAll() });
    } catch (err) {
      req.log.error({ err }, "failed to delete die line defaults");
      res.status(500).json({ error: "Failed to delete die line defaults" });
    }
  },
);

export default router;
