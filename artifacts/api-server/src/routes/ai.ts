import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
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
} from "@workspace/spec-reconcile";
import { UpdateProactiveAlertSettingsBody } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import {
  buildOptimizePrompt,
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
import {
  buildSpecReconcilePrompt,
  sanitizeSpecReconcileSummary,
  toCurrentReconcileRecipes,
  validateSpecReconcileBody,
} from "./aiSpecReconcile";
import {
  aggregateForecastHistory,
  buildForecastPrompt,
  sanitizeForecast,
  validateForecastBody,
  FORECAST_MIN_RUNS,
} from "./aiForecast";
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

// Same posture for the saved spec-sheet cross-reference: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const SPEC_RECONCILE_RATE_WINDOW_MS = 60_000;
const SPEC_RECONCILE_RATE_MAX = 10;
const specReconcileRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(SPEC_RECONCILE_RATE_WINDOW_MS)
    : undefined;

router.post(
  "/ai/optimize",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: OPTIMIZE_RATE_WINDOW_MS,
    max: OPTIMIZE_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: optimizeRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateOptimizeBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const knowledge = await loadFacilityKnowledge(req.log);
    const { system, user } = buildOptimizePrompt(validation.data);
    const userPrompt = appendFacilityMemoryBlock(user, knowledge);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
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
    const userPrompt = await groundPromptWithMemory(req.log, user, { userId });

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-ask call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    const { answer, note } = sanitizeAnswer(content);
    const replyText = answer || note || "I couldn't find an answer in today's data.";

    // Persist the exchange (user question + assistant reply) and return this
    // user's updated conversation window so the client renders from server truth.
    // Best-effort: a write failure must never drop the answer we already have.
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

    res.json({
      answer: replyText,
      turns,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
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

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-command call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: recipeAssistRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateRecipeAssistBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildRecipeAssistPrompt(validation.data);
    // Ground the prompt in the shared name-corrections (so substitutions honor
    // fixes staff already made) and the facility memory. Read-only and fail-safe.
    const corrections = await loadCorrections(req.log);
    const withCorrections = appendCorrectionsBlock(user, corrections, [
      "ingredient",
      "brand",
      "flavor",
      "die",
    ]);
    const grounded = await groundPromptWithMemory(req.log, withCorrections, {
      facilityDomains: ["ingredient", "general"],
    });

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: grounded },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-recipe-assistant call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    // The model may only target a recipe we actually sent: collect the ids so a
    // hallucinated/off-target suggestion is dropped rather than offered to apply.
    const knownRecipeIds = new Set(
      validation.data.recipes
        .map((r) => r.id?.trim())
        .filter((id): id is string => !!id),
    );
    const { answer, note, suggestion } = sanitizeRecipeAnswer(content, knownRecipeIds);
    const replyText = answer || note || "I couldn't answer that from the recipe data.";

    res.json({
      answer: replyText,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
      ...(suggestion ? { suggestion } : {}),
    });
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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
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
      const data = (row.data ?? {}) as { recipes?: unknown };
      dataRecipesRaw = data.recipes;
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

    // Advisory plain-language summary. Fail-safe: any AI error still returns the
    // deterministic discrepancies (with an empty summary) rather than a 502.
    let summary = "";
    try {
      const { system, user } = buildSpecReconcilePrompt(label, discrepancies);
      const grounded = await groundPromptWithMemory(req.log, user, {
        facilityDomains: ["ingredient", "general"],
      });
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
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

// Proactive watcher: same live-day input as /ai/optimize, but returns at most a
// single timely, dismissible nudge (or null). Polled on a cadence by the client
// while a day is running; the client owns de-dup/cooldown via the returned key.
router.post(
  "/ai/proactive-alert",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PROACTIVE_RATE_WINDOW_MS,
    max: PROACTIVE_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: proactiveRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateProactiveBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [flaggedAtRisk, lowStock] = await Promise.all([
      loadFlaggedAtRiskStock(req.log),
      loadLowStockReorderItems(req.log, validation.data.reorderDemandByKey ?? {}),
    ]);

    // On an idle day (no run started) the only nudges worth surfacing are stock
    // related (at-risk stock, low stock / reorder). If both are empty, skip the
    // AI call entirely so an app left open overnight doesn't burn the cost cap
    // polling for nothing.
    if (!isDayActive(validation.data) && flaggedAtRisk.length === 0 && lowStock.length === 0) {
      res.json({ alert: null, generatedAt: Date.now() });
      return;
    }

    const knowledge = await loadFacilityKnowledge(req.log);
    const { system, user } = buildProactivePrompt(validation.data, flaggedAtRisk, lowStock);
    const userPrompt = appendFacilityMemoryBlock(user, knowledge);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
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
      const now = new Date(validation.data.nowMs);
      const nowClock = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
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

// Reads the single settings row, seeding the default on first access so a fresh
// install returns safe defaults (enabled, 4-min poll, 30-min cooldown).
async function loadProactiveSettings() {
  const [row] = await db
    .select()
    .from(proactiveAlertSettingsTable)
    .where(eq(proactiveAlertSettingsTable.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(proactiveAlertSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: proactiveAlertSettingsTable.id })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(proactiveAlertSettingsTable)
    .where(eq(proactiveAlertSettingsTable.id, 1));
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
    const [row] = await db
      .insert(proactiveAlertSettingsTable)
      .values({ id: 1, enabled, pollSeconds, cooldownSeconds, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: proactiveAlertSettingsTable.id,
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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
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

    const knowledge = await loadFacilityKnowledge(req.log);
    // Surface how recent forecasts actually performed (graded from previously-
    // recorded forecasts vs. the finished history this request carries) as an
    // explicit prompt section so the model self-corrects known over-/under-
    // prediction biases instead of leaving the signal buried in the generic
    // memory dump. Pure/deterministic and fail-safe — empty when nothing scored.
    const accuracyTrend = summarizeAccuracyTrend(
      buildForecastReviews(knowledge, validation.data.history),
    );
    const accuracyGrounding = formatAccuracyGrounding(accuracyTrend);
    const { system, user } = buildForecastPrompt(validation.data, accuracyGrounding);
    const userPrompt = appendFacilityMemoryBlock(user, knowledge);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-forecast call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-forecast non-JSON response");
      res.json({ forecast: null, generatedAt: Date.now() });
      return;
    }

    const { forecast, note } = sanitizeForecast(raw, validation.data.targetDate);

    // Record the produced forecast back through the shared facility-memory write
    // path (best-effort) so future forecasts — and any later accuracy review —
    // can reference what was predicted for this kind of day. A write failure
    // must never break the response, so swallow errors.
    if (forecast) {
      void recordFacilityKnowledge([
        {
          domain: "forecast",
          key: `plan:${forecast.targetDate}`,
          fact: formatForecastFact(forecast),
          source: "demand-forecaster",
        },
      ]).catch((err) => {
        req.log.error({ err }, "failed to record forecast to facility memory");
      });
    }

    res.json({
      forecast,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

// Forecast-accuracy review: grade previously-recorded forecasts (facility
// memory, domain "forecast", key `plan:<date>`) against the actual finished
// history the client supplies for those dates. Manager-gated and read-only —
// purely deterministic arithmetic (NO AI call), so there's no rate limit. Best-
// effort records each review back to facility memory (key `accuracy:<date>`) so
// future forecast prompts learn from past misses.
router.post(
  "/ai/forecast-accuracy",
  requireCapability("use-ai-tools"),
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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: fillMissingRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateFillMissingBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [corrections, knowledge] = await Promise.all([
      loadCorrections(req.log),
      loadFacilityKnowledge(req.log),
    ]);
    const { system, user } = buildFillMissingPrompt(validation.data);
    const userPrompt = appendFacilityMemoryBlock(
      appendCorrectionsBlock(user, corrections, ["brand", "flavor", "die", "item", "ingredient"]),
      knowledge,
    );

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-fill-missing call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-fill-missing non-JSON response");
      res.json({ suggestions: [], generatedAt: Date.now() });
      return;
    }

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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: matchImportRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMatchImportBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [corrections, knowledge] = await Promise.all([
      loadCorrections(req.log),
      loadFacilityKnowledge(req.log),
    ]);
    const { system, user } = buildMatchImportPrompt(validation.data);
    const userPrompt = appendFacilityMemoryBlock(
      appendCorrectionsBlock(user, corrections, ["brand", "flavor"]),
      knowledge,
    );

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-match-import call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-match-import non-JSON response");
      res.json({ brandMatches: [], flavorMatches: [], generatedAt: Date.now() });
      return;
    }

    const { brandMatches, flavorMatches, note } = sanitizeMatchImport(raw, validation.data);

    const verdicts = await reviewSuggestions({
      featureLabel: "spreadsheet brand/flavor matches to existing saved names",
      instructions:
        "Flag any match where the imported name is likely NOT the same real-world product as the matched saved name (a wrong or coincidental match). Approve matches that clearly refer to the same product.",
      items: [
        ...brandMatches.map((m, i) => ({
          id: `brand-${i}`,
          text: `Imported brand "${m.candidate}" matched to saved "${m.match}"`,
        })),
        ...flavorMatches.map((m, i) => ({
          id: `flavor-${i}`,
          text: `Imported flavor "${m.candidate}" (brand ${m.brand}) matched to saved "${m.match}"`,
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

    res.json({
      brandMatches: reviewedBrands,
      flavorMatches: reviewedFlavors,
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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: parseSpecRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateParseSpecSheetBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [corrections, knowledge] = await Promise.all([
      loadCorrections(req.log),
      loadFacilityKnowledge(req.log),
    ]);
    const { system, user } = buildParseSpecSheetPrompt(validation.data);
    const userPrompt = appendFacilityMemoryBlock(
      appendCorrectionsBlock(user, corrections, ["brand", "flavor", "die", "ingredient"]),
      knowledge,
    );

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 32768,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-parse-spec-sheet call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-parse-spec-sheet non-JSON response");
      res.json({ profiles: [], recipes: [], generatedAt: Date.now() });
      return;
    }

    const parsed = sanitizeParseSpecSheet(raw);

    const verdicts = await reviewSuggestions({
      featureLabel: "pizza spec-sheet profiles and recipes parsed from a spreadsheet",
      instructions:
        "Flag any profile or recipe with implausible weights, a mismatched brand/flavor, or values outside normal pizza-production ranges. Approve entries that look correctly parsed and plausible.",
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
    });
  },
);

router.post(
  "/ai/match-premix",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: MATCH_PREMIX_RATE_WINDOW_MS,
    max: MATCH_PREMIX_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: matchPremixRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMatchPremixBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [corrections, knowledge] = await Promise.all([
      loadCorrections(req.log),
      loadFacilityKnowledge(req.log),
    ]);
    const { system, user } = buildMatchPremixPrompt(validation.data);
    const userPrompt = appendFacilityMemoryBlock(
      appendCorrectionsBlock(user, corrections, ["brand", "flavor"]),
      knowledge,
    );

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-match-premix call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-match-premix non-JSON response");
      res.json({ matches: [], generatedAt: Date.now() });
      return;
    }

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
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: suggestMergesRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateSuggestMergesBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const [corrections, knowledge] = await Promise.all([
      loadCorrections(req.log),
      loadFacilityKnowledge(req.log),
    ]);
    const { system, user } = buildSuggestMergesPrompt(validation.data);
    const userPrompt = appendFacilityMemoryBlock(
      appendCorrectionsBlock(user, corrections, ["ingredient", "die"]),
      knowledge,
    );

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 16384,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-suggest-merges call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-suggest-merges non-JSON response");
      res.json({ suggestions: [], generatedAt: Date.now() });
      return;
    }

    const suggestions = sanitizeSuggestMerges(raw, validation.data.names);
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
