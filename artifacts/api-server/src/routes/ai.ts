import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { currentScope } from "../lib/requestScope";
import {
  db,
  proactiveAlertSettingsTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventorySettingsTable,
  savedSpecSheetsTable,
  type InventoryLot,
} from "@workspace/db";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  reconcileSpecProfiles,
  toReconcileProfiles,
} from "@workspace/spec-reconcile";
import {
  buildMixReconcilePrompt,
  sanitizeMixReconcileSummary,
  toMixDiscrepancies,
  validateMixReconcileBody,
} from "./aiMixReconcile";
import {
  buildMixAssistPrompt,
  sanitizeMixAnswer,
  validateMixAssistBody,
} from "./aiMixAssistant";
import { UpdateProactiveAlertSettingsBody } from "@workspace/api-zod";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import { fetchModelJsonWithRetry, aiCallFailureHttp } from "../lib/aiJsonRetry";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import {
  buildOptimizePrompt,
  formatClock12,
  sanitizeRecommendations,
  validateOptimizeBody,
} from "./aiOptimize";
import {
  buildFillMissingPrompt,
  sanitizeFillMissingSuggestions,
  validateFillMissingBody,
  type RequestedField,
} from "./aiFillMissing";
import {
  buildMatchImportPrompt,
  sanitizeMatchImport,
  validateMatchImportBody,
} from "./aiMatchImport";
import {
  buildParseSpecSheetPrompt,
  sanitizeParseSpecSheet,
  validateParseSpecSheetBody,
} from "./aiParseSpecSheet";
import {
  buildMatchPremixPrompt,
  sanitizeMatchPremix,
  validateMatchPremixBody,
} from "./aiMatchPremix";
import { recipeTargets } from "@workspace/spec-import";
import {
  buildSuggestMergesPrompt,
  buildKnownPairsNote,
  filterKnownMerges,
  sanitizeSuggestMerges,
  validateSuggestMergesBody,
} from "./aiSuggestMerges";
import {
  buildProactivePrompt,
  clampProactiveSettings,
  isDayActive,
  sanitizeProactiveAlert,
  validateOptimizeBody as validateProactiveBody,
} from "./aiProactive";
import {
  buildFallbackClusters,
  type IncidentCluster,
  type IncidentForCluster,
} from "@workspace/incident-cluster";
import { listIncidents } from "../lib/incidents";
import {
  flagExpiringItems,
  type FlaggableItem,
  type WasteFlaggedItem,
} from "./wasteInsight";
import {
  computeReorderList,
  type ReorderInput,
  type ReorderItem,
} from "@workspace/inventory-math";
import {
  buildAskPrompt,
  sanitizeAnswer,
  validateAskBody,
} from "./aiAsk";
import {
  buildCommandPrompt,
  sanitizeCommand,
  validateCommandBody,
  type CommandGrounding,
} from "./aiCommand";
import {
  buildRecipeAssistPrompt,
  sanitizeRecipeAnswer,
  validateRecipeAssistBody,
} from "./aiRecipeAssistant";
import { wantsEventStream, sseFrame, extractJsonStringField } from "./aiStream";
import {
  buildSpecReconcilePrompt,
  sanitizeSpecReconcileSummary,
  toCurrentReconcileRecipes,
  toCurrentReconcileProfiles,
  validateSpecReconcileBody,
} from "./aiSpecReconcile";
import {
  aggregateForecastHistory,
  buildForecastPrompt,
  sanitizeForecasts,
  forecastTargetDates,
  validateForecastBody,
  FORECAST_MIN_RUNS,
} from "./aiForecast";
import { verifyForecastHistory } from "./aiForecastVerify";
import {
  validateSummaryBody,
  toSummaryAggInput,
  buildSummaryPrompt,
  sanitizeSummary,
} from "./aiSummary";
import {
  aggregateDaySummary,
  buildFallbackSummary,
} from "@workspace/day-summary";
import {
  validateAnomalyBody,
  toAnomalyDetectInput,
  buildAnomalyPrompt,
  sanitizeAnomalySummary,
  detectAnomalies,
} from "./aiAnomalies";
import {
  validateScheduleBody,
  toScheduleRuns,
  toScheduleRules,
  buildSchedulePrompt,
  sanitizeScheduleSummary,
  optimizeSchedule,
} from "./aiScheduleOptimize";
import {
  validateForecastAccuracyBody,
  buildForecastReviews,
  summarizeAccuracyTrend,
  formatForecastFact,
  formatAccuracyFact,
  formatAccuracyGrounding,
} from "./forecastAccuracy";
import { reviewSuggestions } from "./aiReviewer";
import { loadCorrections, appendCorrectionsBlock } from "./aiCorrectionsContext";
import {
  loadFacilityKnowledge,
  appendFacilityMemoryBlock,
  recordFacilityKnowledge,
  groundPromptWithMemory,
  recordConversationTurns,
} from "./aiMemoryContext";

const router: IRouter = Router();

// Cost/abuse guard for the paid AI endpoint: per-user fixed window. Matches the
// photo-intake endpoint's posture (10 requests / minute).
const OPTIMIZE_RATE_WINDOW_MS = 60_000;
const OPTIMIZE_RATE_MAX = 10;

// In production the API may run with more than one instance, so the cost cap is
// backed by a shared Postgres store to keep it effective across instances.
// Everywhere else (dev/test, a single process) the limiter falls back to its
// in-memory store — identical behavior and headers, no DB dependency.
const optimizeRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(OPTIMIZE_RATE_WINDOW_MS)
    : undefined;

// Same posture for the setup "fill in missing data" assistant: per-user fixed
// window, Postgres-backed in production so the cap holds across instances.
const FILL_MISSING_RATE_WINDOW_MS = 60_000;
const FILL_MISSING_RATE_MAX = 10;
const fillMissingRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(FILL_MISSING_RATE_WINDOW_MS)
    : undefined;

// Same posture for the Excel-import brand/flavor matcher: per-user fixed window,
// Postgres-backed in production so the cap holds across instances.
const MATCH_IMPORT_RATE_WINDOW_MS = 60_000;
const MATCH_IMPORT_RATE_MAX = 10;
const matchImportRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(MATCH_IMPORT_RATE_WINDOW_MS)
    : undefined;

// Same posture for the Excel spec-sheet / recipe parser: per-user fixed window,
// Postgres-backed in production so the cap holds across instances.
const PARSE_SPEC_RATE_WINDOW_MS = 60_000;
const PARSE_SPEC_RATE_MAX = 10;
const parseSpecRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PARSE_SPEC_RATE_WINDOW_MS)
    : undefined;

// Same posture for the premix-sheet product-name matcher: per-user fixed window,
// Postgres-backed in production so the cap holds across instances.
const MATCH_PREMIX_RATE_WINDOW_MS = 60_000;
const MATCH_PREMIX_RATE_MAX = 10;
const matchPremixRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(MATCH_PREMIX_RATE_WINDOW_MS)
    : undefined;

// Same posture for the ingredient merge suggester: per-user fixed window,
// Postgres-backed in production so the cap holds across instances.
const SUGGEST_MERGES_RATE_WINDOW_MS = 60_000;
const SUGGEST_MERGES_RATE_MAX = 10;
const suggestMergesRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(SUGGEST_MERGES_RATE_WINDOW_MS)
    : undefined;

// The proactive watcher polls on a cadence (every few minutes) while a day runs,
// so it needs a little more headroom than the on-demand endpoints, but the same
// posture: per-user fixed window, Postgres-backed in production for a shared cap.
const PROACTIVE_RATE_WINDOW_MS = 60_000;
const PROACTIVE_RATE_MAX = 20;
const proactiveRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PROACTIVE_RATE_WINDOW_MS)
    : undefined;

// Same posture for the free-form "ask the AI about the day" chat: per-user fixed
// window, Postgres-backed in production so the cost cap holds across instances.
const ASK_RATE_WINDOW_MS = 60_000;
const ASK_RATE_MAX = 10;
const askRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(ASK_RATE_WINDOW_MS)
    : undefined;

// Same posture for the voice-command interpreter: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const COMMAND_RATE_WINDOW_MS = 60_000;
const COMMAND_RATE_MAX = 20;
const commandRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(COMMAND_RATE_WINDOW_MS)
    : undefined;

// Same posture for the recipe & ingredient helper (staff-facing chat): per-user
// fixed window, Postgres-backed in production so the cost cap holds across
// instances.
const RECIPE_ASSIST_RATE_WINDOW_MS = 60_000;
const RECIPE_ASSIST_RATE_MAX = 10;
const recipeAssistRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(RECIPE_ASSIST_RATE_WINDOW_MS)
    : undefined;

// Same posture for the on-demand demand forecaster: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const FORECAST_RATE_WINDOW_MS = 60_000;
const FORECAST_RATE_MAX = 10;
const forecastRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(FORECAST_RATE_WINDOW_MS)
    : undefined;

const SUMMARY_RATE_WINDOW_MS = 60_000;
const SUMMARY_RATE_MAX = 10;
const summaryRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(SUMMARY_RATE_WINDOW_MS)
    : undefined;

// Same posture for the anomaly-flag narrator: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const ANOMALY_RATE_WINDOW_MS = 60_000;
const ANOMALY_RATE_MAX = 10;
const anomalyRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(ANOMALY_RATE_WINDOW_MS)
    : undefined;

// Same posture for the schedule-order narrator: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const SCHEDULE_RATE_WINDOW_MS = 60_000;
const SCHEDULE_RATE_MAX = 10;
const scheduleRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(SCHEDULE_RATE_WINDOW_MS)
    : undefined;

// Same posture for the saved spec-sheet cross-reference: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const SPEC_RECONCILE_RATE_WINDOW_MS = 60_000;
const SPEC_RECONCILE_RATE_MAX = 10;
const specReconcileRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(SPEC_RECONCILE_RATE_WINDOW_MS)
    : undefined;

// Same posture for the mix-reconcile narration: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const MIX_RECONCILE_RATE_WINDOW_MS = 60_000;
const MIX_RECONCILE_RATE_MAX = 10;
const mixReconcileRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(MIX_RECONCILE_RATE_WINDOW_MS)
    : undefined;

// Same posture for the Mixes helper (staff-facing chat): per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const MIX_ASSIST_RATE_WINDOW_MS = 60_000;
const MIX_ASSIST_RATE_MAX = 10;
const mixAssistRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(MIX_ASSIST_RATE_WINDOW_MS)
    : undefined;

router.post(
  "/ai/optimize",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: OPTIMIZE_RATE_WINDOW_MS,
    max: OPTIMIZE_RATE_MAX,
    keyGenerator: (req) => `ai-optimize:${req.userId ?? req.ip ?? "unknown"}`,
    store: optimizeRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateOptimizeBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildOptimizePrompt(validation.data);
    const userPrompt = await groundPromptWithMemory(req.log, user);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-optimize call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-optimize non-JSON response");
      res.json({ recommendations: [], generatedAt: Date.now() });
      return;
    }

    const knownRunIds = new Set(validation.data.runs.map((r) => r.id));
    const { recommendations, note } = sanitizeRecommendations(raw, knownRunIds);

    const verdicts = await reviewSuggestions({
      featureLabel: "production run-schedule optimization recommendations",
      instructions:
        "Flag any recommendation that contradicts the provided run data, is unsafe to apply on a live production line, or whose action would set an impossible or implausible value (e.g. a finish time in the past). Approve sound, low-risk suggestions.",
      items: recommendations.map((r, i) => ({
        id: `rec-${i}`,
        text: `${r.title} [${r.category}/${r.impact}${r.appliesTo ? `, applies to ${r.appliesTo}` : ""}]: ${r.detail}`,
      })),
      log: req.log,
    });
    const reviewed = recommendations.map((r, i) => {
      const v = verdicts.get(`rec-${i}`);
      return v ? { ...r, review: v } : r;
    });

    res.json({
      recommendations: reviewed,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

// Free-form "ask the AI about the day" chat. Unlike /ai/optimize this is NOT
// manager-gated — every signed-in worker can ask plain-language questions. The
// answer is grounded strictly in the day's real data, the shared facility
// memory, and this user's own recent conversation turns; the exchange is then
// recorded back into that user's conversation memory so follow-ups keep context.
// Read-only — the model only answers, it never takes actions.
router.post(
  "/ai/ask",
  rateLimit({
    windowMs: ASK_RATE_WINDOW_MS,
    max: ASK_RATE_MAX,
    keyGenerator: (req) => `ai-ask:${req.userId ?? req.ip ?? "unknown"}`,
    store: askRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateAskBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const userId = req.userId ?? "";
    const { system, user } = buildAskPrompt(validation.data);
    // Ground in facility memory + this user's prior turns BEFORE recording the
    // new exchange, so the model sees the conversation as it stood at ask time.
    // Not manager-gated — every signed-in worker can ask — so the privileged
    // slice of facility memory (forecast plans, proactive-alert history; see
    // PRIVILEGED_FACILITY_DOMAINS) must be excluded, or a low-privilege account
    // could recover it by asking the model to repeat what it was told,
    // bypassing GET /ai-memory/facility's use-ai-tools gate.
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      userId,
      allowPrivilegedFacilityDomains: false,
    });

    // Finalize the exchange identically for the stream and non-stream paths: run
    // the same deterministic sanitize, then best-effort record the turns so the
    // client renders from server truth. A write failure never drops the answer.
    const finalize = async (
      content: string,
    ): Promise<{
      answer: string;
      turns: Array<{ role: "user" | "assistant"; text: string }>;
      generatedAt: number;
      note?: string;
    }> => {
      const { answer, note } = sanitizeAnswer(content);
      const replyText = answer || note || "I couldn't find an answer in today's data.";
      let turns: Array<{ role: "user" | "assistant"; text: string }> = [];
      if (userId) {
        try {
          turns = await recordConversationTurns(userId, [
            { role: "user", text: validation.data.question },
            { role: "assistant", text: replyText },
          ]);
        } catch (err) {
          req.log.error({ err }, "ai-ask failed to record conversation turns");
        }
      }
      return { answer: replyText, turns, generatedAt: Date.now(), ...(note ? { note } : {}) };
    };

    // ── Streaming path (opt-in via Accept: text/event-stream) ────────────────
    // Stream the answer text as it's generated, then send the same final payload
    // the non-stream path returns. The client keeps a non-stream fallback.
    if (wantsEventStream(req.headers.accept)) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      let content = "";
      let emitted = "";
      try {
        const stream = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        for await (const chunk of stream) {
          const piece = chunk.choices[0]?.delta?.content ?? "";
          if (!piece) continue;
          content += piece;
          const partial = extractJsonStringField(content, "answer");
          if (partial.length > emitted.length) {
            res.write(sseFrame("delta", { text: partial.slice(emitted.length) }));
            emitted = partial;
          }
        }
      } catch (err) {
        req.log.error({ err }, "ai-ask stream failed");
        res.write(sseFrame("error", { error: "AI provider error" }));
        res.end();
        return;
      }
      const payload = await finalize(content);
      res.write(sseFrame("done", payload));
      res.end();
      return;
    }

    // ── Non-streaming path (default) ─────────────────────────────────────────
    // A cut-off reply here surfaces to the worker as a garbled half-JSON
    // "answer" (sanitizeAnswer's raw fallback), so retry once. On final
    // give-up the existing raw-fallback behavior is kept via result.content.
    const result = await fetchModelJsonWithRetry({
      label: "ai-ask",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok && result.reason !== "malformed") {
      const failure = aiCallFailureHttp(result, "AI provider error");
      res.status(failure.status).json({ error: failure.error });
      return;
    }
    const content = result.ok ? JSON.stringify(result.raw) : result.content;

    res.json(await finalize(content));
  },
);

// Voice commands: classify a single spoken phrase as a QUESTION (the client
// routes it to /ai/ask, unchanged) or a COMMAND. For a command, return one or
// more structured actions from a fixed vocabulary, with every fuzzy reference
// already resolved against the grounding (today's runs by brand/flavor → run id,
// inventory items by name → item key/id) and validated. This endpoint NEVER
// mutates anything — the client runs the actions through its existing handlers,
// applying the same role gating and offering Undo. Not manager-gated: floor
// staff issue commands, exactly like manual actions (each action's own role bar
// is enforced client-side, mirroring the manual UI).
router.post(
  "/ai/command",
  rateLimit({
    windowMs: COMMAND_RATE_WINDOW_MS,
    max: COMMAND_RATE_MAX,
    keyGenerator: (req) => `ai-command:${req.userId ?? req.ip ?? "unknown"}`,
    store: commandRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateCommandBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Build the grounding: runs come from the supplied day-state; inventory is
    // read live from the DB so item references resolve to current keys/ids.
    const grounding: CommandGrounding = {
      runs: new Map(),
      inventoryByKey: new Map(),
      inventoryById: new Map(),
    };
    for (const r of validation.data.dayState.runs) {
      grounding.runs.set(r.id, { label: r.label, brand: r.brand, flavor: r.flavor });
    }

    let inventoryForPrompt: Array<{
      key: string;
      id: number;
      category: string;
      name: string;
      unit: string;
      onHand: number;
    }> = [];
    try {
      const items = await db
        .select()
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.scope, currentScope()))
        .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
      // On-hand per item is the sum of its lots' remaining qty (no onHand column).
      const lots = await db
        .select()
        .from(inventoryLotsTable)
        .where(eq(inventoryLotsTable.scope, currentScope()));
      const onHandByItem = new Map<number, number>();
      for (const lot of lots) {
        onHandByItem.set(lot.itemId, (onHandByItem.get(lot.itemId) ?? 0) + lot.qtyRemaining);
      }
      inventoryForPrompt = items.map((item) => ({
        key: item.key,
        id: item.id,
        category: item.category,
        name: item.name,
        unit: item.unit,
        onHand: Math.round((onHandByItem.get(item.id) ?? 0) * 100) / 100,
      }));
      for (const item of items) {
        grounding.inventoryByKey.set(item.key, {
          id: item.id,
          category: item.category,
          name: item.name,
          unit: item.unit,
        });
        grounding.inventoryById.set(item.id, {
          key: item.key,
          name: item.name,
          unit: item.unit,
        });
      }
    } catch (err) {
      // Inventory grounding is best-effort: run commands still work without it.
      req.log.error({ err }, "ai-command failed to load inventory grounding");
    }

    const { system, user } = buildCommandPrompt(validation.data, inventoryForPrompt);

    // A malformed reply here turns a spoken command into a silent no-op ("I
    // didn't catch that"), so retry once. On final give-up sanitizeCommand's
    // existing safe "none" fallback still applies via result.content.
    const aiResult = await fetchModelJsonWithRetry({
      label: "ai-command",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("cheap"),
          max_completion_tokens: 1024,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!aiResult.ok && aiResult.reason !== "malformed") {
      const failure = aiCallFailureHttp(aiResult, "AI provider error");
      res.status(failure.status).json({ error: failure.error });
      return;
    }
    const content = aiResult.ok ? JSON.stringify(aiResult.raw) : aiResult.content;

    const result = sanitizeCommand(content, grounding);
    res.json({ ...result, generatedAt: Date.now() });
  },
);

// Recipe & ingredient helper: a single-shot, staff-facing Q&A over the current
// run's recipes — scale a recipe, suggest a substitution, or explain a formula.
// Grounded strictly in the supplied recipe rows, the known ingredient pool, the
// shared name-corrections (so a fix learned elsewhere is honored), and the
// facility memory. Advisory only — never edits a recipe, never writes anything.
// Not manager-gated: floor staff use it, exactly like /ai/ask.
router.post(
  "/ai/recipe-assistant",
  rateLimit({
    windowMs: RECIPE_ASSIST_RATE_WINDOW_MS,
    max: RECIPE_ASSIST_RATE_MAX,
    keyGenerator: (req) => `ai-recipe-assistant:${req.userId ?? req.ip ?? "unknown"}`,
    store: recipeAssistRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateRecipeAssistBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildRecipeAssistPrompt(validation.data);
    // Ground the prompt in facility memory and the shared name-corrections pool
    // (so substitutions honor fixes staff already made). Read-only and fail-safe.
    const grounded = await groundPromptWithMemory(req.log, user, {
      facilityDomains: ["ingredient", "general"],
      correctionDomains: ["ingredient", "brand", "flavor", "die", "recipe"],
    });

    // The model may only target a recipe we actually sent: collect the ids so a
    // hallucinated/off-target suggestion is dropped rather than offered to apply.
    const knownRecipeIds = new Set(
      validation.data.recipes
        .map((r) => r.id?.trim())
        .filter((id): id is string => !!id),
    );
    // Finalize identically for the stream and non-stream paths: same
    // deterministic sanitize, same drop-off-target-suggestion guard.
    const finalize = (content: string) => {
      const { answer, note, suggestion } = sanitizeRecipeAnswer(content, knownRecipeIds);
      const replyText = answer || note || "I couldn't answer that from the recipe data.";
      return {
        answer: replyText,
        generatedAt: Date.now(),
        ...(note ? { note } : {}),
        ...(suggestion ? { suggestion } : {}),
      };
    };

    // ── Streaming path (opt-in via Accept: text/event-stream) ────────────────
    // Stream the answer text, then send the same final payload the non-stream
    // path returns (incl. any apply-able suggestion). Client keeps a fallback.
    if (wantsEventStream(req.headers.accept)) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      let content = "";
      let emitted = "";
      try {
        const stream = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: grounded },
          ],
        });
        for await (const chunk of stream) {
          const piece = chunk.choices[0]?.delta?.content ?? "";
          if (!piece) continue;
          content += piece;
          const partial = extractJsonStringField(content, "answer");
          if (partial.length > emitted.length) {
            res.write(sseFrame("delta", { text: partial.slice(emitted.length) }));
            emitted = partial;
          }
        }
      } catch (err) {
        req.log.error({ err }, "ai-recipe-assistant stream failed");
        res.write(sseFrame("error", { error: "AI provider error" }));
        res.end();
        return;
      }
      res.write(sseFrame("done", finalize(content)));
      res.end();
      return;
    }

    // ── Non-streaming path (default) ─────────────────────────────────────────
    // A cut-off reply surfaces as a garbled half-JSON "answer" (raw fallback),
    // so retry once; final give-up keeps that fallback via result.content.
    const result = await fetchModelJsonWithRetry({
      label: "ai-recipe-assistant",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: grounded },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok && result.reason !== "malformed") {
      const failure = aiCallFailureHttp(result, "AI provider error");
      res.status(failure.status).json({ error: failure.error });
      return;
    }
    const content = result.ok ? JSON.stringify(result.raw) : result.content;

    res.json(finalize(content));
  },
);

// Cross-reference a saved spec sheet against the current recipe library. The
// diff itself is deterministic (the shared @workspace/spec-reconcile lib runs
// here AND on both clients), so the discrepancy list is always returned even if
// the AI summary is unavailable. The AI only narrates the already-computed
// discrepancies — it can't invent or miss one. Read-only; not manager-gated.
router.post(
  "/ai/spec-reconcile",
  rateLimit({
    windowMs: SPEC_RECONCILE_RATE_WINDOW_MS,
    max: SPEC_RECONCILE_RATE_MAX,
    keyGenerator: (req) => `ai-spec-reconcile:${req.userId ?? req.ip ?? "unknown"}`,
    store: specReconcileRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateSpecReconcileBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Load the saved spec sheet in the caller's scope.
    let dataRecipesRaw: unknown;
    let dataProfilesRaw: unknown;
    let label = "Spec sheet";
    try {
      const rows = await db
        .select()
        .from(savedSpecSheetsTable)
        .where(
          and(
            eq(savedSpecSheetsTable.scope, currentScope()),
            eq(savedSpecSheetsTable.id, validation.data.specSheetId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "No saved spec sheet with that id" });
        return;
      }
      label = row.label;
      const data = (row.data ?? {}) as { recipes?: unknown; profiles?: unknown };
      dataRecipesRaw = data.recipes;
      dataProfilesRaw = data.profiles;
    } catch (err) {
      req.log.error({ err }, "ai-spec-reconcile failed to load saved spec sheet");
      res.status(500).json({ error: "Failed to load saved spec sheet" });
      return;
    }

    // Deterministic diff: saved spec sheet's recipes vs the current recipe library.
    const discrepancies = reconcileSpecWithRecipes({
      specRecipes: toReconcileRecipes(dataRecipesRaw),
      currentRecipes: toCurrentReconcileRecipes(validation.data),
    });

    // Deterministic profile diff: saved spec sheet's brand+flavor profile specs
    // (die/sauce/applicators/pepperonis) vs the current profiles the client sent.
    // Gate strictly on PRESENCE of currentProfiles: older clients (e.g. mobile)
    // omit the field entirely, and we must skip profiles for them rather than
    // treat an absent snapshot as "every profile is missing". A client that
    // genuinely has no matching profiles sends an explicit (empty) array.
    const profileDiscrepancies =
      validation.data.currentProfiles === undefined
        ? []
        : reconcileSpecProfiles({
            specProfiles: toReconcileProfiles(dataProfilesRaw),
            currentProfiles: toCurrentReconcileProfiles(validation.data),
          });

    // Advisory plain-language summary. Fail-safe: any AI error still returns the
    // deterministic discrepancies (with an empty summary) rather than a 502.
    let summary = "";
    try {
      const { system, user } = buildSpecReconcilePrompt(label, discrepancies, profileDiscrepancies);
      const grounded = await groundPromptWithMemory(req.log, user, {
        facilityDomains: ["ingredient", "general"],
      });
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: grounded },
        ],
      });
      summary = sanitizeSpecReconcileSummary(response.choices[0]?.message?.content ?? "");
    } catch (err) {
      req.log.error({ err }, "ai-spec-reconcile summary call failed");
    }

    res.json({
      specSheetId: validation.data.specSheetId,
      discrepancies,
      generatedAt: Date.now(),
      ...(summary ? { summary } : {}),
    });
  },
);

// Narrate the already-computed mix discrepancies. The deterministic diff (the
// shared @workspace/mix-reconcile lib) runs on BOTH clients, so the client sends
// the exact discrepancy list and the AI only summarizes it — it can't invent or
// miss one. Read-only and fail-safe: any AI error returns an empty summary
// rather than a 502. Not manager-gated (any signed-in user).
router.post(
  "/ai/mix-reconcile",
  rateLimit({
    windowMs: MIX_RECONCILE_RATE_WINDOW_MS,
    max: MIX_RECONCILE_RATE_MAX,
    keyGenerator: (req) => `ai-mix-reconcile:${req.userId ?? req.ip ?? "unknown"}`,
    store: mixReconcileRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMixReconcileBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const discrepancies = toMixDiscrepancies(validation.data);

    // Advisory plain-language summary. Fail-safe: any AI error still returns a
    // (empty) summary rather than a 502 — the deterministic diff already lives
    // on the client.
    let summary = "";
    try {
      const { system, user } = buildMixReconcilePrompt(
        validation.data.label ?? "",
        discrepancies,
      );
      const grounded = await groundPromptWithMemory(req.log, user, {
        facilityDomains: ["ingredient", "general"],
      });
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: grounded },
        ],
      });
      summary = sanitizeMixReconcileSummary(response.choices[0]?.message?.content ?? "");
    } catch (err) {
      req.log.error({ err }, "ai-mix-reconcile summary call failed");
    }

    res.json({
      generatedAt: Date.now(),
      ...(summary ? { summary } : {}),
    });
  },
);

// Mixes helper: a single-shot, staff-facing Q&A over the current mixes —
// explain a mix, total an ingredient, compare amounts. Grounded strictly in the
// supplied mix definitions and the facility memory. Advisory only — never edits
// a mix, never writes anything, and (by design) returns no structured apply.
// Not manager-gated: floor staff use it, exactly like /ai/ask.
router.post(
  "/ai/mix-assistant",
  rateLimit({
    windowMs: MIX_ASSIST_RATE_WINDOW_MS,
    max: MIX_ASSIST_RATE_MAX,
    keyGenerator: (req) => `ai-mix-assistant:${req.userId ?? req.ip ?? "unknown"}`,
    store: mixAssistRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMixAssistBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildMixAssistPrompt(validation.data);
    const grounded = await groundPromptWithMemory(req.log, user, {
      facilityDomains: ["ingredient", "general"],
    });

    // A cut-off reply surfaces as a garbled half-JSON "answer" (raw fallback),
    // so retry once; final give-up keeps that fallback via result.content.
    const result = await fetchModelJsonWithRetry({
      label: "ai-mix-assistant",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: grounded },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok && result.reason !== "malformed") {
      const failure = aiCallFailureHttp(result, "AI provider error");
      res.status(failure.status).json({ error: failure.error });
      return;
    }
    const content = result.ok ? JSON.stringify(result.raw) : result.content;

    const { answer, note } = sanitizeMixAnswer(content);
    const replyText = answer || note || "I couldn't answer that from the mix data.";

    res.json({
      answer: replyText,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

// Compute the current expired / expiring-soon stock the same way the on-demand
// waste-insight endpoint does (deterministic flagging, grounded by the global
// expiry lead-time setting). Fed into the proactive prompt so the watcher can
// surface an auto-deduped waste nudge without anyone opening the Inventory tab.
// Best-effort: a DB hiccup must never break the poll, so any failure returns an
// empty list and the watcher simply omits the at-risk section.
async function loadFlaggedAtRiskStock(
  log: { error: (obj: unknown, msg?: string) => void },
): Promise<WasteFlaggedItem[]> {
  try {
    const [settingsRow] = await db
      .select()
      .from(inventorySettingsTable)
      .where(eq(inventorySettingsTable.scope, currentScope()));
    const soonDays = settingsRow?.expirySoonDays ?? 7;

    const items = await db
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.scope, currentScope()))
      .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
    const allLots = await db
      .select()
      .from(inventoryLotsTable)
      .where(eq(inventoryLotsTable.scope, currentScope()));
    const lotsByItem = new Map<number, InventoryLot[]>();
    for (const lot of allLots) {
      const arr = lotsByItem.get(lot.itemId) ?? [];
      arr.push(lot);
      lotsByItem.set(lot.itemId, arr);
    }
    const flaggable: FlaggableItem[] = items.map((item) => ({
      key: item.key,
      name: item.name,
      category: item.category,
      unit: item.unit,
      lots: (lotsByItem.get(item.id) ?? []).map((l) => ({
        qtyRemaining: l.qtyRemaining,
        expirationDate: l.expirationDate,
      })),
    }));
    return flagExpiringItems(flaggable, soonDays);
  } catch (err) {
    log.error({ err }, "proactive-alert: failed to load at-risk stock (non-fatal)");
    return [];
  }
}

// Compute the items that have dropped to/below their reorder point the same way
// the warehouse "Reorder Now" card does (shared computeReorderList from
// @workspace/inventory-math), so the proactive watcher can surface an
// auto-deduped reorder nudge without anyone opening the Warehouse tab.
// `demandByKey` is the client-resolved material demand from upcoming scheduled
// runs (brand/recipe profiles live client-side, so the server can't resolve it):
// when present it is subtracted from cross-location on-hand exactly like the
// card, so the nudge fires as early as the card and the two can never disagree.
// When absent/empty this reduces to `onHand <= reorderThreshold` (a conservative
// SUBSET of the card). computeReorderList already clamps each demand to a
// non-negative number, so an untrusted client map is safe. Best-effort: any DB
// failure returns an empty list and the watcher simply omits the low-stock
// section.
async function loadLowStockReorderItems(
  log: { error: (obj: unknown, msg?: string) => void },
  demandByKey: Record<string, number> = {},
): Promise<ReorderItem[]> {
  try {
    const items = await db
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.scope, currentScope()))
      .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
    const allLots = await db
      .select()
      .from(inventoryLotsTable)
      .where(eq(inventoryLotsTable.scope, currentScope()));
    const onHandByItem = new Map<number, number>();
    for (const lot of allLots) {
      onHandByItem.set(lot.itemId, (onHandByItem.get(lot.itemId) ?? 0) + lot.qtyRemaining);
    }
    const reorderInputs: ReorderInput[] = items.map((item) => ({
      key: item.key,
      name: item.name,
      category: item.category as ReorderInput["category"],
      unit: item.unit,
      onHand: onHandByItem.get(item.id) ?? 0,
      reorderThreshold: item.reorderThreshold,
    }));
    return computeReorderList(reorderInputs, demandByKey);
  } catch (err) {
    log.error({ err }, "proactive-alert: failed to load low-stock reorder items (non-fatal)");
    return [];
  }
}

// Recent recurring incident patterns, for grounding the proactive watcher so it
// "learns" from problems staff have reported lately. Reuses the SAME deterministic
// grouping the manager-facing incident-clusters view uses (@workspace/incident-
// cluster), so what the watcher sees as context matches what managers see. Only a
// recent window is considered, and the pure prompt builder further filters to
// recurring (2+) clusters. Fail-safe: any read error yields no patterns and the
// poll continues uninterrupted.
const INCIDENT_PATTERN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
async function loadRecentIncidentPatterns(log: {
  error: (obj: unknown, msg?: string) => void;
}): Promise<IncidentCluster[]> {
  try {
    const incidents = await listIncidents();
    const cutoff = Date.now() - INCIDENT_PATTERN_WINDOW_MS;
    const forCluster: IncidentForCluster[] = incidents
      .filter((i) => new Date(i.createdAt).getTime() >= cutoff)
      .map((i) => ({
        id: i.id,
        appPlatform: i.appPlatform,
        screen: i.screen,
        source: i.source,
        message: i.context.description || i.context.errorMessage || "",
        count: i.recurrence?.count ?? 1,
      }));
    return buildFallbackClusters(forCluster);
  } catch (err) {
    log.error({ err }, "proactive-alert: failed to load incident patterns (non-fatal)");
    return [];
  }
}

// Proactive watcher: same live-day input as /ai/optimize, but returns at most a
// single timely, dismissible nudge (or null). Polled on a cadence by the client
// while a day is running; the client owns de-dup/cooldown via the returned key.
router.post(
  "/ai/proactive-alert",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PROACTIVE_RATE_WINDOW_MS,
    max: PROACTIVE_RATE_MAX,
    keyGenerator: (req) => `ai-proactive-alert:${req.userId ?? req.ip ?? "unknown"}`,
    store: proactiveRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateProactiveBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [flaggedAtRisk, lowStock, incidentPatterns] = await Promise.all([
      loadFlaggedAtRiskStock(req.log),
      loadLowStockReorderItems(req.log, validation.data.reorderDemandByKey ?? {}),
      loadRecentIncidentPatterns(req.log),
    ]);

    // On an idle day (no run started) the only nudges worth surfacing are stock
    // related (at-risk stock, low stock / reorder). If both are empty, skip the
    // AI call entirely so an app left open overnight doesn't burn the cost cap
    // polling for nothing.
    if (!isDayActive(validation.data) && flaggedAtRisk.length === 0 && lowStock.length === 0) {
      res.json({ alert: null, generatedAt: Date.now() });
      return;
    }

    const { system, user } = buildProactivePrompt(
      validation.data,
      flaggedAtRisk,
      lowStock,
      incidentPatterns,
    );
    const userPrompt = await groundPromptWithMemory(req.log, user);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-proactive-alert call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-proactive-alert non-JSON response");
      res.json({ alert: null, generatedAt: Date.now() });
      return;
    }

    const { alert, note } = sanitizeProactiveAlert(raw);

    // Record notable triggers back through the shared facility-memory write path
    // (best-effort) so the watcher's timing improves over time. A write failure
    // must never break the poll, so swallow errors.
    if (alert) {
      const nowClock = formatClock12(validation.data.nowMs, validation.data.tzOffsetMinutes);
      void recordFacilityKnowledge([
        {
          domain: "proactive-alerts",
          key: `trigger:${alert.key}`,
          fact: `Proactively alerted "${alert.title}" (${alert.category}/${alert.impact}) around ${nowClock}.`,
          source: "proactive-watcher",
        },
      ]).catch((err) => {
        req.log.error({ err }, "failed to record proactive-alert trigger to facility memory");
      });
    }

    res.json({
      alert,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

// ── Proactive-alert settings (cadence / cooldown / on-off) ───────────────────
// The proactive-alert settings live in a single row (id=1) outside the per-day
// sync payload, like the other global settings. Bounds/clamping live in the
// db-free aiProactive.ts module (clampProactiveSettings) so they stay
// unit-testable; this route just persists the clamped values.

// Reads the settings row for the current scope, seeding the default on first
// access so a fresh install returns safe defaults (enabled, 4-min poll, 30-min
// cooldown). Live and sandbox each have their own independent row.
async function loadProactiveSettings() {
  const scope = currentScope();
  const [row] = await db
    .select()
    .from(proactiveAlertSettingsTable)
    .where(eq(proactiveAlertSettingsTable.scope, scope));
  if (row) return row;
  const [created] = await db
    .insert(proactiveAlertSettingsTable)
    .values({ scope })
    .onConflictDoNothing({ target: proactiveAlertSettingsTable.scope })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(proactiveAlertSettingsTable)
    .where(eq(proactiveAlertSettingsTable.scope, scope));
  return existing;
}

// Open to any signed-in user (the watcher only polls for managers, but reading
// the config is harmless and keeps the hook simple).
router.get("/ai/proactive-settings", async (_req, res): Promise<void> => {
  const row = await loadProactiveSettings();
  res.json({
    enabled: row.enabled,
    pollSeconds: row.pollSeconds,
    cooldownSeconds: row.cooldownSeconds,
  });
});

router.put(
  "/ai/proactive-settings",
  requireCapability("use-ai-tools"),
  async (req, res): Promise<void> => {
    const parsed = UpdateProactiveAlertSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { enabled, pollSeconds, cooldownSeconds } = clampProactiveSettings(parsed.data);
    const scope = currentScope();
    const [row] = await db
      .insert(proactiveAlertSettingsTable)
      .values({ scope, enabled, pollSeconds, cooldownSeconds, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: proactiveAlertSettingsTable.scope,
        set: { enabled, pollSeconds, cooldownSeconds, updatedAt: new Date() },
      })
      .returning();
    res.json({
      enabled: row.enabled,
      pollSeconds: row.pollSeconds,
      cooldownSeconds: row.cooldownSeconds,
    });
  },
);

// On-demand demand forecaster: given recent finished history (grouped by day)
// and any scheduled future runs, predict a suggested run plan for one upcoming
// day plus a plain-language rationale. Manager-gated and read-only — nothing is
// committed; the manager reviews the suggestion into the editable schedule.
router.post(
  "/ai/forecast",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: FORECAST_RATE_WINDOW_MS,
    max: FORECAST_RATE_MAX,
    keyGenerator: (req) => `ai-forecast:${req.userId ?? req.ip ?? "unknown"}`,
    store: forecastRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateForecastBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Hard floor against fabrication: a single finished run (or none) isn't a
    // pattern to predict from, so refuse honestly without spending an AI call.
    const agg = aggregateForecastHistory(validation.data);
    if (agg.totalRuns < FORECAST_MIN_RUNS) {
      res.json({
        forecast: null,
        generatedAt: Date.now(),
        note: "Not enough production history yet to forecast. Finish a few days of runs and try again.",
      });
      return;
    }

    // Load facility knowledge and corrections in parallel: knowledge is needed
    // for both the accuracy-trend calculation and the prompt; corrections are
    // appended to the prompt so the model knows factory-wide name equivalences.
    const [knowledge, corrections] = await Promise.all([
      loadFacilityKnowledge(req.log),
      loadCorrections(req.log),
    ]);
    // Surface how recent forecasts actually performed (graded from previously-
    // recorded forecasts vs. the finished history this request carries) as an
    // explicit prompt section so the model self-corrects known over-/under-
    // prediction biases instead of leaving the signal buried in the generic
    // memory dump. Pure/deterministic and fail-safe — empty when nothing scored.
    const accuracyTrend = summarizeAccuracyTrend(
      buildForecastReviews(knowledge, validation.data.history),
    );
    const accuracyGrounding = formatAccuracyGrounding(accuracyTrend);
    // Expand the requested horizon into the concrete list of days to forecast so
    // multi-day output can be matched back to real dates deterministically.
    const targetDates = forecastTargetDates(
      validation.data.targetDate,
      validation.data.horizonDays,
    );

    const { system, user } = buildForecastPrompt(validation.data, accuracyGrounding);
    const userPrompt = appendCorrectionsBlock(appendFacilityMemoryBlock(user, knowledge), corrections);

    // A malformed reply here is user-visible data loss (the manager gets no
    // forecast at all), so retry once before falling back to the empty result.
    const result = await fetchModelJsonWithRetry({
      label: "ai-forecast",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          // Multi-day plans produce proportionally more output; give the longer
          // horizons more room while keeping a sane ceiling.
          max_completion_tokens: targetDates.length > 1 ? 8192 : 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider" || result.reason === "rate-limited") {
        const failure = aiCallFailureHttp(result, "AI provider error");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({ forecast: null, forecasts: [], generatedAt: Date.now() });
      return;
    }
    const raw: unknown = result.raw;

    const { forecasts, note } = sanitizeForecasts(raw, targetDates);

    // Record each produced day's plan back through the shared facility-memory
    // write path (best-effort) so future forecasts — and any later accuracy
    // review — can reference what was predicted for this kind of day. A write
    // failure must never break the response, so swallow errors.
    //
    // Security: `validation.data.history` is entirely client-controlled, and the
    // model is told to echo its brand/flavor names verbatim, so a fabricated
    // history flows straight into what gets persisted here — poisoning the
    // shared pool every other AI feature trusts. Reconcile the submitted
    // history against the server's own authoritative daily_sync records before
    // writing back; an unverifiable/fabricated history still gets its forecast
    // returned to the caller, it just isn't trusted into shared memory.
    const historyVerified = await verifyForecastHistory(
      validation.data.history,
      currentScope(),
      req.log,
    );
    if (forecasts.length && historyVerified) {
      void recordFacilityKnowledge(
        forecasts.map((plan) => ({
          domain: "forecast",
          key: `plan:${plan.targetDate}`,
          fact: formatForecastFact(plan),
          source: "demand-forecaster",
        })),
      ).catch((err) => {
        req.log.error({ err }, "failed to record forecast to facility memory");
      });
    }

    res.json({
      // forecast (singular) stays populated with the first day's plan for
      // backward compatibility with older clients; forecasts carries every day.
      forecast: forecasts[0] ?? null,
      forecasts,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

// End-of-day / weekly production recap. Stats are computed deterministically
// from the supplied runs (shared @workspace/day-summary lib); the model only
// NARRATES them. Open to all signed-in staff (informational, like ask-the-day),
// rate-limited per user. Fail-safe: any AI failure or unusable output falls back
// to the deterministic plain-language summary built from the same stats, so the
// caller always gets a usable recap. Read-only — never writes run data.
router.post(
  "/ai/summary",
  rateLimit({
    windowMs: SUMMARY_RATE_WINDOW_MS,
    max: SUMMARY_RATE_MAX,
    keyGenerator: (req) => `ai-summary:${req.userId ?? req.ip ?? "unknown"}`,
    store: summaryRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateSummaryBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Deterministic stats first — these are what the UI shows and what the
    // fallback recap is built from. The AI never sees raw run data beyond this.
    const stats = aggregateDaySummary(toSummaryAggInput(validation.data));
    const fallback = buildFallbackSummary(stats);

    // Nothing to narrate: skip the AI call entirely and return the deterministic
    // "no runs" recap. Honest and cheap.
    if (!stats.hasData) {
      res.json({
        summary: fallback,
        stats,
        generatedAt: Date.now(),
        aiGenerated: false,
      });
      return;
    }

    const { system, user } = buildSummaryPrompt(stats);
    // Open to all signed-in staff (see comment above), so exclude the
    // privileged facility-memory domains (forecast/proactive-alerts) — same
    // reasoning as /ai/ask. Corrections (name equivalences) are included by
    // default via groundPromptWithMemory so the summary honors merges/renames.
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      allowPrivilegedFacilityDomains: false,
    });

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      // Fail-safe: AI provider error still returns a usable deterministic recap.
      req.log.error({ err }, "ai-summary call failed; using deterministic fallback");
      res.json({
        summary: fallback,
        stats,
        generatedAt: Date.now(),
        aiGenerated: false,
      });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-summary non-JSON response");
      res.json({
        summary: fallback,
        stats,
        generatedAt: Date.now(),
        aiGenerated: false,
      });
      return;
    }

    const narrated = sanitizeSummary(raw);
    res.json({
      summary: narrated ?? fallback,
      stats,
      generatedAt: Date.now(),
      aiGenerated: narrated != null,
    });
  },
);

// Predictive-maintenance / anomaly flags. Drift detection (downtime/yield/
// stoppages vs. a per-product baseline) is computed deterministically from the
// supplied runs (shared @workspace/anomaly lib); the model only NARRATES the
// flagged anomalies — and only when at least one is flagged (no flags → no AI
// call), mirroring the waste-insight posture. Open to all signed-in staff
// (informational), rate-limited per user. Fail-safe: any AI failure or unusable
// output returns the deterministic anomaly list with an empty narration.
// Read-only — never writes run data.
router.post(
  "/ai/anomalies",
  rateLimit({
    windowMs: ANOMALY_RATE_WINDOW_MS,
    max: ANOMALY_RATE_MAX,
    keyGenerator: (req) => `ai-anomalies:${req.userId ?? req.ip ?? "unknown"}`,
    store: anomalyRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateAnomalyBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Deterministic detection first — this is what the UI shows. The AI never
    // sees raw run data beyond the flagged anomalies.
    const result = detectAnomalies(toAnomalyDetectInput(validation.data));

    const baseResponse = {
      anomalies: result.anomalies,
      checkedRuns: result.checkedRuns,
      baselineRuns: result.baselineRuns,
      generatedAt: Date.now(),
    };

    // Not enough history to judge anything → honest note, no AI call.
    if (result.baselineRuns < 3) {
      res.json({
        ...baseResponse,
        summary: "",
        note: "Not enough run history yet to spot anomalies.",
        aiGenerated: false,
      });
      return;
    }

    // Nothing drifted → skip the AI call entirely. Cheap and honest.
    if (result.anomalies.length === 0) {
      res.json({ ...baseResponse, summary: "", aiGenerated: false });
      return;
    }

    const { system, user } = buildAnomalyPrompt(result);
    // Open to all signed-in staff (see comment above), so exclude the
    // privileged facility-memory domains (forecast/proactive-alerts) — same
    // reasoning as /ai/ask. Corrections included by default so anomaly
    // narration honors factory-wide name equivalences.
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      allowPrivilegedFacilityDomains: false,
    });

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      // Fail-safe: AI provider error still returns the deterministic anomalies.
      req.log.error({ err }, "ai-anomalies call failed; returning anomalies without narration");
      res.json({ ...baseResponse, summary: "", aiGenerated: false });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-anomalies non-JSON response");
      res.json({ ...baseResponse, summary: "", aiGenerated: false });
      return;
    }

    const narrated = sanitizeAnomalySummary(raw);
    res.json({
      ...baseResponse,
      summary: narrated ?? "",
      aiGenerated: narrated != null,
    });
  },
);

// AI schedule-order suggestion. Given the runs planned for one day, the server
// DETERMINISTICALLY proposes an ordering (allergen runs end-of-day, similar
// brand/die grouped to cut changeovers, factory sequence rules honored — shared
// @workspace/schedule-optimize lib). The model only NARRATES the suggested
// order, and only when a strictly better order exists (no improvement → no AI
// call), mirroring the anomaly posture. Manager-gated (use-ai-tools) and
// rate-limited per user. Fail-safe: any AI failure or unusable output returns
// the deterministic suggested order with an empty narration. Read-only — never
// writes the schedule; the manager applies it through the normal move path.
router.post(
  "/ai/schedule-optimize",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: SCHEDULE_RATE_WINDOW_MS,
    max: SCHEDULE_RATE_MAX,
    keyGenerator: (req) => `ai-schedule-optimize:${req.userId ?? req.ip ?? "unknown"}`,
    store: scheduleRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateScheduleBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Deterministic ordering first — this is what the UI shows. The AI never
    // sees raw run data beyond the suggested order's FACTS block.
    const result = optimizeSchedule(
      toScheduleRuns(validation.data),
      toScheduleRules(validation.data),
    );

    const baseResponse = {
      order: result.order,
      changed: result.changed,
      improved: result.improved,
      before: result.before,
      after: result.after,
      generatedAt: Date.now(),
    };

    // Fewer than 2 runs, or no strictly better order → skip the AI call
    // entirely. Cheap and honest.
    if (result.ordered.length < 2) {
      res.json({
        ...baseResponse,
        summary: "",
        note: "Not enough runs to reorder.",
        aiGenerated: false,
      });
      return;
    }
    if (!result.improved) {
      res.json({
        ...baseResponse,
        summary: "",
        note: "Runs are already in a good order.",
        aiGenerated: false,
      });
      return;
    }

    const { system, user } = buildSchedulePrompt(result);
    const userPrompt = await groundPromptWithMemory(req.log, user);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      // Fail-safe: AI provider error still returns the deterministic order.
      req.log.error(
        { err },
        "ai-schedule-optimize call failed; returning order without narration",
      );
      res.json({ ...baseResponse, summary: "", aiGenerated: false });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn(
        { content: content.slice(0, 200) },
        "ai-schedule-optimize non-JSON response",
      );
      res.json({ ...baseResponse, summary: "", aiGenerated: false });
      return;
    }

    const narrated = sanitizeScheduleSummary(raw);
    res.json({
      ...baseResponse,
      summary: narrated ?? "",
      aiGenerated: narrated != null,
    });
  },
);

// Cost/abuse guard for the forecast-accuracy write path. Although the handler
// itself makes no AI call, each POST writes up to ACCURACY_MAX_REVIEWS rows
// into the shared facility_knowledge table and may trigger
// pruneFacilityKnowledge(), which deletes the oldest entries across ALL
// domains. Rapid calls can therefore evict quality/ingredient/general facts
// that every other AI feature depends on. 10 requests/minute matches the
// posture of all other manager-gated AI endpoints.
const FORECAST_ACCURACY_RATE_WINDOW_MS = 60_000;
const FORECAST_ACCURACY_RATE_MAX = 10;
const forecastAccuracyRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(FORECAST_ACCURACY_RATE_WINDOW_MS)
    : undefined;

// Forecast-accuracy review: grade previously-recorded forecasts (facility
// memory, domain "forecast", key `plan:<date>`) against the actual finished
// history the client supplies for those dates. Manager-gated. Purely
// deterministic arithmetic (NO AI call), but still needs a rate limit because
// each call writes up to ACCURACY_MAX_REVIEWS rows to shared facility memory
// and can trigger cross-domain pruning (see above). Best-effort records each
// review back to facility memory (key `accuracy:<date>`) so future forecast
// prompts learn from past misses.
router.post(
  "/ai/forecast-accuracy",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: FORECAST_ACCURACY_RATE_WINDOW_MS,
    max: FORECAST_ACCURACY_RATE_MAX,
    keyGenerator: (req) => `ai-forecast-accuracy:${req.userId ?? req.ip ?? "unknown"}`,
    store: forecastAccuracyRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateForecastAccuracyBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const knowledge = await loadFacilityKnowledge(req.log);
    const reviews = buildForecastReviews(knowledge, validation.data.history);
    const trend = summarizeAccuracyTrend(reviews);

    // Record accuracy back to shared memory (best-effort) so the forecaster is
    // grounded in how it actually did. A write failure must never break the
    // response, so swallow errors.
    if (reviews.length > 0) {
      void recordFacilityKnowledge(
        reviews.map((r) => ({
          domain: "forecast",
          key: `accuracy:${r.date}`,
          fact: formatAccuracyFact(r),
          source: "forecast-accuracy",
        })),
      ).catch((err) => {
        req.log.error({ err }, "failed to record forecast accuracy to facility memory");
      });
    }

    res.json({
      reviews,
      trend,
      generatedAt: Date.now(),
      ...(reviews.length === 0
        ? {
            note: "No past forecasts to review yet. Once a forecasted day finishes its runs, its accuracy shows up here.",
          }
        : {}),
    });
  },
);

router.post(
  "/ai/fill-missing",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: FILL_MISSING_RATE_WINDOW_MS,
    max: FILL_MISSING_RATE_MAX,
    keyGenerator: (req) => `ai-fill-missing:${req.userId ?? req.ip ?? "unknown"}`,
    store: fillMissingRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateFillMissingBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildFillMissingPrompt(validation.data);
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      correctionDomains: ["brand", "flavor", "die", "item", "ingredient", "recipe"],
    });

    // A malformed reply here is user-visible data loss (the fill-missing panel
    // shows nothing to apply), so retry once before the empty fallback.
    const result = await fetchModelJsonWithRetry({
      label: "ai-fill-missing",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("cheap"),
          max_completion_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider" || result.reason === "rate-limited") {
        const failure = aiCallFailureHttp(result, "AI provider error");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({ suggestions: [], generatedAt: Date.now() });
      return;
    }
    const raw: unknown = result.raw;

    const requested: RequestedField[] = validation.data.fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      options: f.options,
    }));
    const { suggestions, note } = sanitizeFillMissingSuggestions(raw, requested);

    const verdicts = await reviewSuggestions({
      featureLabel: "auto-filled values for missing product/run setup fields",
      instructions:
        "Flag any value that is implausible for its field, contradicts the product's known brand/flavor/size, or is an unsafe default to commit. Approve values that are clearly correct and well-justified.",
      items: suggestions.map((s, i) => ({
        id: `fm-${i}`,
        text: `${s.key} = "${s.value}" — ${s.rationale}`,
      })),
      log: req.log,
    });
    const reviewed = suggestions.map((s, i) => {
      const v = verdicts.get(`fm-${i}`);
      return v ? { ...s, review: v } : s;
    });

    res.json({
      suggestions: reviewed,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

router.post(
  "/ai/match-import",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: MATCH_IMPORT_RATE_WINDOW_MS,
    max: MATCH_IMPORT_RATE_MAX,
    keyGenerator: (req) => `ai-match-import:${req.userId ?? req.ip ?? "unknown"}`,
    store: matchImportRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMatchImportBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildMatchImportPrompt(validation.data);
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      correctionDomains: ["brand", "flavor"],
    });

    // A malformed reply here is user-visible data loss (an Excel import loses
    // all its name matches), so retry once before the empty fallback.
    const result = await fetchModelJsonWithRetry({
      label: "ai-match-import",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("cheap"),
          max_completion_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider" || result.reason === "rate-limited") {
        const failure = aiCallFailureHttp(result, "AI provider error");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({ brandMatches: [], flavorMatches: [], generatedAt: Date.now() });
      return;
    }
    const raw: unknown = result.raw;

    const { brandMatches, flavorMatches, ingredientMatches, appTypeMatches, pepTypeMatches, note } =
      sanitizeMatchImport(raw, validation.data);

    const verdicts = await reviewSuggestions({
      featureLabel: "spreadsheet name matches to existing saved names",
      instructions:
        "Flag any match where the imported name is likely NOT the same real-world item as the matched saved name (a wrong or coincidental match). Approve matches that clearly refer to the same item.",
      items: [
        ...brandMatches.map((m, i) => ({
          id: `brand-${i}`,
          text: `Imported brand "${m.candidate}" matched to saved "${m.match}"`,
        })),
        ...flavorMatches.map((m, i) => ({
          id: `flavor-${i}`,
          text: `Imported flavor "${m.candidate}" (brand ${m.brand}) matched to saved "${m.match}"`,
        })),
        ...ingredientMatches.map((m, i) => ({
          id: `ingredient-${i}`,
          text: `Imported ${m.kind} ingredient "${m.candidate}" matched to saved "${m.match}"`,
        })),
        ...appTypeMatches.map((m, i) => ({
          id: `app-${i}`,
          text: `Imported applicator type "${m.candidate}" matched to saved "${m.match}"`,
        })),
        ...pepTypeMatches.map((m, i) => ({
          id: `pep-${i}`,
          text: `Imported pepperoni type "${m.candidate}" matched to saved "${m.match}"`,
        })),
      ],
      log: req.log,
    });
    const reviewedBrands = brandMatches.map((m, i) => {
      const v = verdicts.get(`brand-${i}`);
      return v ? { ...m, review: v } : m;
    });
    const reviewedFlavors = flavorMatches.map((m, i) => {
      const v = verdicts.get(`flavor-${i}`);
      return v ? { ...m, review: v } : m;
    });
    const reviewedIngredients = ingredientMatches.map((m, i) => {
      const v = verdicts.get(`ingredient-${i}`);
      return v ? { ...m, review: v } : m;
    });
    const reviewedAppTypes = appTypeMatches.map((m, i) => {
      const v = verdicts.get(`app-${i}`);
      return v ? { ...m, review: v } : m;
    });
    const reviewedPepTypes = pepTypeMatches.map((m, i) => {
      const v = verdicts.get(`pep-${i}`);
      return v ? { ...m, review: v } : m;
    });

    res.json({
      brandMatches: reviewedBrands,
      flavorMatches: reviewedFlavors,
      ingredientMatches: reviewedIngredients,
      appTypeMatches: reviewedAppTypes,
      pepTypeMatches: reviewedPepTypes,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

router.post(
  "/ai/parse-spec-sheet",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PARSE_SPEC_RATE_WINDOW_MS,
    max: PARSE_SPEC_RATE_MAX,
    keyGenerator: (req) => `ai-parse-spec-sheet:${req.userId ?? req.ip ?? "unknown"}`,
    store: parseSpecRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateParseSpecSheetBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildParseSpecSheetPrompt(validation.data);
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      correctionDomains: ["brand", "flavor", "die", "ingredient", "recipe"],
    });

    // The model occasionally truncates/malforms its JSON mid-response even for
    // small sheets; the shared bounded retry (fetchModelJsonWithRetry) absorbs
    // that transient flakiness so the user's import doesn't silently come back
    // empty, and the empty-result fallback still applies once attempts are
    // exhausted.
    const result = await fetchModelJsonWithRetry({
      label: "ai-parse-spec-sheet",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          // Parsing echoes the whole workbook chunk back as structured JSON, so
          // output scales with input: a chunk carrying ~240 spec profiles
          // overflowed 32768 output tokens → truncated non-JSON → empty result.
          // Use the model's full 64k output budget for this route.
          max_completion_tokens: 65536,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider" || result.reason === "rate-limited") {
        const failure = aiCallFailureHttp(result, "AI provider error");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({
        profiles: [],
        recipes: [],
        generatedAt: Date.now(),
        note: "The AI couldn't parse this portion of the sheet (its response was cut off or malformed). Nothing from this portion was imported — try again or split the file.",
      });
      return;
    }
    const raw: unknown = result.raw;

    const parsed = sanitizeParseSpecSheet(raw, validation.data);

    const verdicts = await reviewSuggestions({
      featureLabel: "pizza spec-sheet profiles and recipes parsed from a spreadsheet",
      instructions:
        "Flag any profile or recipe with implausible weights, a mismatched brand/flavor, or values outside normal pizza-production ranges. Approve entries that look correctly parsed and plausible. Die types are commonly non-numeric custom dies (e.g. \"Argus\", \"Mystic\"), not inch sizes — do NOT flag a die merely for not being a standard numeric pizza size.",
      items: [
        ...parsed.profiles.map((p, i) => ({
          id: `profile-${i}`,
          text: `Spec profile: brand "${p.brand}", flavor "${p.flavor}"${p.dieType ? `, die ${p.dieType}` : ""}`,
        })),
        ...parsed.recipes.map((r, i) => {
          const tgts = recipeTargets(r);
          const ctx = tgts.length
            ? ` (brand ${tgts[0].brand}, flavor ${tgts[0].flavor}${tgts.length > 1 ? ` +${tgts.length - 1} more profiles` : ""})`
            : "";
          return { id: `recipe-${i}`, text: `${r.kind} recipe "${r.name}"${ctx}` };
        }),
      ],
      log: req.log,
    });
    const reviewedProfiles = parsed.profiles.map((p, i) => {
      const v = verdicts.get(`profile-${i}`);
      return v ? { ...p, review: v } : p;
    });
    const reviewedRecipes = parsed.recipes.map((r, i) => {
      const v = verdicts.get(`recipe-${i}`);
      return v ? { ...r, review: v } : r;
    });

    res.json({
      profiles: reviewedProfiles,
      recipes: reviewedRecipes,
      generatedAt: Date.now(),
      ...(parsed.note ? { note: parsed.note } : {}),
      ...(parsed.warnings?.length ? { warnings: parsed.warnings } : {}),
    });
  },
);

router.post(
  "/ai/match-premix",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: MATCH_PREMIX_RATE_WINDOW_MS,
    max: MATCH_PREMIX_RATE_MAX,
    keyGenerator: (req) => `ai-match-premix:${req.userId ?? req.ip ?? "unknown"}`,
    store: matchPremixRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMatchPremixBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildMatchPremixPrompt(validation.data);
    const userPrompt = await groundPromptWithMemory(req.log, user, {
      correctionDomains: ["brand", "flavor"],
    });

    // A malformed reply here is user-visible data loss (a premix import loses
    // all its product matches), so retry once before the empty fallback.
    const result = await fetchModelJsonWithRetry({
      label: "ai-match-premix",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("cheap"),
          max_completion_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider" || result.reason === "rate-limited") {
        const failure = aiCallFailureHttp(result, "AI provider error");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({ matches: [], generatedAt: Date.now() });
      return;
    }
    const raw: unknown = result.raw;

    const matches = sanitizeMatchPremix(raw, validation.data);

    const verdicts = await reviewSuggestions({
      featureLabel: "premix product names matched to existing saved brand/flavor products",
      instructions:
        "Flag any match where the imported premix name is likely NOT the same real-world product as the matched saved brand/flavor (a wrong or coincidental match). Approve matches that clearly refer to the same product.",
      items: matches.map((m, i) => ({
        id: `match-${i}`,
        text: `Imported premix "${m.name}" matched to saved brand "${m.brand}"${m.flavor ? ` flavor "${m.flavor}"` : ""}`,
      })),
      log: req.log,
    });
    const reviewedMatches = matches.map((m, i) => {
      const v = verdicts.get(`match-${i}`);
      return v ? { ...m, review: v } : m;
    });

    res.json({ matches: reviewedMatches, generatedAt: Date.now() });
  },
);

router.post(
  "/ai/suggest-merges",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: SUGGEST_MERGES_RATE_WINDOW_MS,
    max: SUGGEST_MERGES_RATE_MAX,
    keyGenerator: (req) => `ai-suggest-merges:${req.userId ?? req.ip ?? "unknown"}`,
    store: suggestMergesRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateSuggestMergesBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildSuggestMergesPrompt(validation.data);

    // Load corrections now so we can (a) add a prompt hint listing already-
    // known pairs (saves tokens, helps the model skip them) and (b) apply a
    // deterministic post-filter after the AI responds that guarantees known
    // pairs are never returned regardless of model behaviour.
    const corrections = await loadCorrections(req.log);
    const knownPairsNote = buildKnownPairsNote(corrections, validation.data.names);
    const userWithHint = knownPairsNote ? `${user}\n\n${knownPairsNote}` : user;

    // groundPromptWithMemory will also append the full corrections block
    // (facility memory + all confirmed name equivalences), so the model sees
    // both the targeted "skip these" note AND the wider corrections context.
    const userPrompt = await groundPromptWithMemory(req.log, userWithHint, {
      correctionDomains: ["ingredient", "die"],
    });

    // A malformed reply here is user-visible data loss (the user asked for
    // merge suggestions and gets none), so retry once before the empty fallback.
    const result = await fetchModelJsonWithRetry({
      label: "ai-suggest-merges",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("cheap"),
          max_completion_tokens: 16384,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider" || result.reason === "rate-limited") {
        const failure = aiCallFailureHttp(result, "AI provider error");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({ suggestions: [], generatedAt: Date.now() });
      return;
    }
    const raw: unknown = result.raw;

    // Deterministic post-filter: drop any source→target pair that already has
    // a confirmed correction, so known renames never re-appear as suggestions.
    const suggestions = filterKnownMerges(
      sanitizeSuggestMerges(raw, validation.data.names),
      corrections,
    );
    const note =
      raw && typeof raw === "object" && typeof (raw as { note?: unknown }).note === "string"
        ? (raw as { note: string }).note.trim().slice(0, 500)
        : "";

    const verdicts = await reviewSuggestions({
      featureLabel: "proposed ingredient-name merges (folding duplicates into one canonical name)",
      instructions:
        "Flag any group that would merge names which are actually DIFFERENT products or ingredients (a merge that loses a real distinction). Approve groups that are clearly the same item spelled differently.",
      items: suggestions.map((s, i) => ({
        id: `merge-${i}`,
        text: `Merge [${s.sources.join(", ")}] into "${s.target}"${s.reason ? ` — ${s.reason}` : ""}`,
      })),
      log: req.log,
    });
    const reviewed = suggestions.map((s, i) => {
      const v = verdicts.get(`merge-${i}`);
      return v ? { ...s, review: v } : s;
    });

    res.json({
      suggestions: reviewed,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

export default router;
