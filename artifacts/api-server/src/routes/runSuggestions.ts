import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, runSuggestionsTable, type RunSuggestionRow } from "@workspace/db";
import {
  ObserveRunSuggestionBody,
  UpdateRunSuggestionBody,
  FollowUpRunSuggestionBody,
} from "@workspace/api-zod";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

// Run Insights: pattern-based setting suggestions generated after runs
// complete. The web client's DETERMINISTIC analysis decides whether a
// suggestion exists (≥5% deviation across ≥2 recent runs of the same
// product+die); this route stores the measured facts and records the manager's
// accept/dismiss decision. Nothing is ever auto-applied server-side — Accept is
// executed by the manager's client.
//
// One row per pattern (`${type}::${brand}::${flavor}::${die}`, case-folded):
// - pending rows are refreshed in place as new runs come in;
// - dismissed rows stay suppressed until the drift worsens meaningfully past
//   the value the manager saw, or the configured value itself changed;
// - accepted rows reopen when the pattern recurs under the new configuration
//   (the client only counts runs whose configured value matches the CURRENT
//   setting, so an accept naturally resets the consistency window).

const router: IRouter = Router();

type SuggestionType = "speed-target" | "tunnel-time";

const OBSERVE_RATE_WINDOW_MS = 60_000;
const OBSERVE_RATE_MAX = 12;
const observeRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(OBSERVE_RATE_WINDOW_MS)
    : undefined;

// A dismissed pattern reopens only when the observed value drifted at least
// this much (relative to configured) beyond what the manager dismissed.
const REOPEN_DRIFT = 0.02;
function patternId(type: string, brand: string, flavor: string, dieType: string): string {
  return `${type}::${brand.trim().toLowerCase()}::${flavor.trim().toLowerCase()}::${dieType
    .trim()
    .toLowerCase()}`;
}

function toApi(row: RunSuggestionRow) {
  return {
    id: row.id,
    type: row.type,
    brand: row.brand,
    flavor: row.flavor,
    dieType: row.dieType,
    observedValue: row.observedValue,
    configuredValue: row.configuredValue,
    recommendedValue: row.recommendedValue,
    unit: row.unit,
    runCount: row.runCount,
    statsLine: row.statsLine,
    narrative: row.narrative,
    status: row.status,
    followUpNote: row.followUpNote,
    updatedAt: row.updatedAt.getTime(),
  };
}

async function listAll(): Promise<RunSuggestionRow[]> {
  const rows = await db
    .select()
    .from(runSuggestionsTable)
    .where(eq(runSuggestionsTable.scope, currentScope()));
  return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

router.get("/run-suggestions", async (req: Request, res: Response) => {
  try {
    res.json({ suggestions: (await listAll()).map(toApi) });
  } catch (err) {
    req.log.error({ err }, "failed to list run suggestions");
    res.status(500).json({ error: "Failed to list run suggestions" });
  }
});

// NOT manager-gated: staff tablets finalize runs and report observations.
router.post(
  "/run-suggestions/observe",
  rateLimit({
    windowMs: OBSERVE_RATE_WINDOW_MS,
    max: OBSERVE_RATE_MAX,
    keyGenerator: (req) => `run-suggest-observe:${req.userId ?? req.ip ?? "unknown"}`,
    store: observeRateStore,
  }),
  async (req: Request, res: Response) => {
    const parsed = ObserveRunSuggestionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const b = parsed.data;
    const type = b.type as SuggestionType;
    const brand = (b.brand ?? "").trim().slice(0, 200);
    const flavor = (b.flavor ?? "").trim().slice(0, 200);
    const dieType = (b.dieType ?? "").trim().slice(0, 200);
    const nums = [b.observedValue, b.configuredValue, b.recommendedValue];
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 100000) || b.configuredValue <= 0) {
      res.status(400).json({ error: "Invalid values" });
      return;
    }
    const statsLine = b.statsLine.trim().slice(0, 1000);
    const runCount = Math.max(0, Math.min(100, Math.round(b.runCount)));
    const id = patternId(type, brand, flavor, dieType);
    const scope = currentScope();

    try {
      const existing = (
        await db
          .select()
          .from(runSuggestionsTable)
          .where(and(eq(runSuggestionsTable.id, id), eq(runSuggestionsTable.scope, scope)))
      )[0];

      // Dismissed patterns stay quiet until the drift meaningfully worsens
      // past what the manager saw, or the configured value itself changed.
      if (existing && existing.status === "dismissed") {
        const configChanged =
          Math.abs(existing.configuredValue - b.configuredValue) >
          Math.abs(existing.configuredValue) * 1e-6 + 1e-9;
        const dismissedAt = existing.dismissedObservedValue ?? existing.observedValue;
        const priorDrift = Math.abs(dismissedAt - existing.configuredValue) / existing.configuredValue;
        const newDrift = Math.abs(b.observedValue - b.configuredValue) / b.configuredValue;
        if (!configChanged && newDrift <= priorDrift + REOPEN_DRIFT) {
          res.json({ ok: true, suppressed: true });
          return;
        }
      }

      const values = {
        id,
        scope,
        type,
        brand,
        flavor,
        dieType,
        observedValue: b.observedValue,
        configuredValue: b.configuredValue,
        recommendedValue: b.recommendedValue,
        unit: b.unit.slice(0, 50),
        runCount,
        statsLine,
        // Keep the legacy field in the response/schema for older clients, but
        // stop writing model-generated prose. The UI uses statsLine.
        narrative: "",
        status: "pending",
        dismissedObservedValue: null,
        followUpNote: "",
        updatedAt: new Date(),
      };
      const [row] = await db
        .insert(runSuggestionsTable)
        .values(values)
        .onConflictDoUpdate({
          target: [runSuggestionsTable.id, runSuggestionsTable.scope],
          set: {
            type: values.type,
            brand: values.brand,
            flavor: values.flavor,
            dieType: values.dieType,
            observedValue: values.observedValue,
            configuredValue: values.configuredValue,
            recommendedValue: values.recommendedValue,
            unit: values.unit,
            runCount: values.runCount,
            statsLine: values.statsLine,
            narrative: values.narrative,
            status: values.status,
            dismissedObservedValue: values.dismissedObservedValue,
            followUpNote: values.followUpNote,
            updatedAt: values.updatedAt,
          },
        })
        .returning();
      res.json({ ok: true, suggestion: toApi(row) });
    } catch (err) {
      req.log.error({ err }, "failed to store run suggestion");
      res.status(500).json({ error: "Failed to store run suggestion" });
    }
  },
);

// Manager decision: accept / dismiss, or clear a delivered follow-up note.
router.post(
  "/run-suggestions/update",
  requireCapability("use-ai-tools"),
  async (req: Request, res: Response) => {
    const parsed = UpdateRunSuggestionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const { id, status, clearFollowUp } = parsed.data;
    const scope = currentScope();
    try {
      const existing = (
        await db
          .select()
          .from(runSuggestionsTable)
          .where(and(eq(runSuggestionsTable.id, id), eq(runSuggestionsTable.scope, scope)))
      )[0];
      if (!existing) {
        res.status(404).json({ error: "Unknown suggestion" });
        return;
      }
      const set: Partial<typeof runSuggestionsTable.$inferInsert> = { updatedAt: new Date() };
      if (status === "accepted") {
        set.status = "accepted";
        set.followUpNote = "";
      } else if (status === "dismissed") {
        set.status = "dismissed";
        set.dismissedObservedValue = existing.observedValue;
      } else if (status === "pending") {
        set.status = "pending";
        set.dismissedObservedValue = null;
      }
      if (clearFollowUp) set.followUpNote = "";
      await db
        .update(runSuggestionsTable)
        .set(set)
        .where(and(eq(runSuggestionsTable.id, id), eq(runSuggestionsTable.scope, scope)));
      res.json({ suggestions: (await listAll()).map(toApi) });
    } catch (err) {
      req.log.error({ err }, "failed to update run suggestion");
      res.status(500).json({ error: "Failed to update run suggestion" });
    }
  },
);

// Post-accept feedback from the next finished run of the same scope. Any
// signed-in device may report (staff tablets finalize runs); only fills an
// EMPTY note slot on an ACCEPTED suggestion, so it can't overwrite or spam.
router.post("/run-suggestions/follow-up", async (req: Request, res: Response) => {
  const parsed = FollowUpRunSuggestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { id } = parsed.data;
  const note = parsed.data.note.trim().slice(0, 500);
  if (!note) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = currentScope();
  try {
    await db
      .update(runSuggestionsTable)
      .set({ followUpNote: note, updatedAt: new Date() })
      .where(
        and(
          eq(runSuggestionsTable.id, id),
          eq(runSuggestionsTable.scope, scope),
          eq(runSuggestionsTable.status, "accepted"),
          eq(runSuggestionsTable.followUpNote, ""),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "failed to record run-suggestion follow-up");
    res.status(500).json({ error: "Failed to record follow-up" });
  }
});

export default router;
