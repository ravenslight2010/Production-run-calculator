import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { currentScope } from "../lib/requestScope";
import {
  db,
  savedSpecSheetsTable,
} from "@workspace/db";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  reconcileSpecProfiles,
  toReconcileProfiles,
} from "@workspace/spec-reconcile";
import {
  toMixDiscrepancies,
  validateMixReconcileBody,
} from "./aiMixReconcile";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import { fetchModelJsonWithRetry, aiCallFailureHttp } from "../lib/aiJsonRetry";
import {
  extractReviewedDocument,
  specImagesAdapter,
  workbookTextAdapter,
} from "../lib/reviewedDocumentExtraction";
import {
  resolveUnresolvedData,
  resolveUnresolvedDataWithEnrichment,
} from "../lib/unresolvedDataResolution";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { aiCostLimit, chargeAiCost } from "../middlewares/costLimitMiddleware";
import { requireCapability } from "../middlewares/requireCapability";
import {
  buildFillMissingPrompt,
  sanitizeFillMissingSuggestions,
  validateFillMissingBody,
  type RequestedField,
} from "./aiFillMissing";
import {
  buildMatchImportPrompt,
  resolveDeterministicMatchImport,
  sanitizeMatchImport,
  validateMatchImportBody,
} from "./aiMatchImport";
import {
  buildParseSpecSheetPrompt,
  sanitizeParseSpecSheet,
  validateParseSpecSheetBody,
  validateParseSpecImagesBody,
} from "./aiParseSpecSheet";
import {
  buildMatchPremixPrompt,
  resolveDeterministicMatchPremix,
  sanitizeMatchPremix,
  validateMatchPremixBody,
} from "./aiMatchPremix";
import { recipeTargets, type ParsedSpecImport } from "@workspace/spec-import";
import {
  buildSuggestMergesPrompt,
  buildKnownPairsNote,
  filterKnownMerges,
  sanitizeSuggestMerges,
  validateSuggestMergesBody,
} from "./aiSuggestMerges";
import {
  toCurrentReconcileRecipes,
  toCurrentReconcileProfiles,
  validateSpecReconcileBody,
} from "./aiSpecReconcile";
import {
  validateSummaryBody,
  toSummaryAggInput,
} from "./aiSummary";
import {
  aggregateDaySummary,
  buildFallbackSummary,
} from "@workspace/day-summary";
import {
  validateAnomalyBody,
  toAnomalyDetectInput,
  detectAnomalies,
} from "./aiAnomalies";
import {
  validateScheduleBody,
  toScheduleRuns,
  toScheduleRules,
  optimizeSchedule,
} from "./aiScheduleOptimize";
import { reviewSuggestions } from "./aiReviewer";
import {
  AI_RESULT_CACHE_TTL_MS,
  fingerprintAiOperation,
  getOrCreateAiResult,
  type AiCacheLoadResult,
} from "../lib/aiResultCache";
import { loadCorrections, appendCorrectionsBlock } from "./aiCorrectionsContext";
import {
  loadFacilityKnowledge,
  appendFacilityMemoryBlock,
  groundPromptWithMemory,
} from "./aiMemoryContext";

const router: IRouter = Router();

// Stable, non-conversational routes can look up their sanitized result before
// charging the weighted provider budget. They still pass through their own
// request/abuse limiter below. The other routes retain the original global
// charge-before-handler behavior.
const CACHEABLE_AI_PATHS = new Set([
  "/match-import",
  "/match-premix",
  "/suggest-merges",
]);
// These routes retain their historical /ai URLs for client compatibility, but
// their results are now entirely deterministic. Keep them out of the paid AI
// cost limiter and result-cache path.
const DETERMINISTIC_PATHS = new Set([
  "/summary",
  "/anomalies",
  "/schedule-optimize",
  "/spec-reconcile",
  "/mix-reconcile",
]);


router.use("/ai", (req, res, next) => {
  if (DETERMINISTIC_PATHS.has(req.path)) {
    next();
    return;
  }
  if (CACHEABLE_AI_PATHS.has(req.path)) {
    // Preserve the pre-cache behavior for the clearly invalid empty requests
    // used by the auth/cost guard: they are charged before capability gating,
    // but valid requests still defer charging until validation, grounding, and
    // the cache miss owner.
    if (isObject(req.body) && Object.keys(req.body).length === 0) {
      aiCostLimit(req, res, next);
      return;
    }
    next();
    return;
  }
  aiCostLimit(req, res, next);
});

class AiCostLimitError extends Error {
  constructor() {
    super("AI cost limit exceeded");
    this.name = "AiCostLimitError";
  }
}

function finishAiCostLimitResponse(res: Response): void {
  // The miss owner may already have written the detailed limiter response.
  // Concurrent waiters share that error but still need their own response.
  if (!res.headersSent) {
    res.status(429).json({ error: "AI cost limit exceeded" });
  }
}

class AiResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
  ) {
    super(error);
    this.name = "AiResponseError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function cachedAiResponse<T>(
  req: Request,
  res: Response,
  opts: {
    operation: string;
    model: string;
    system: string;
    user: string;
    validate: (value: unknown) => value is T;
    load: () => Promise<AiCacheLoadResult<T>>;
    ttlMs?: number;
  },
): Promise<{ value: T; hit: boolean }> {
  const key = fingerprintAiOperation(opts);
  return getOrCreateAiResult({
    operation: opts.operation,
    key,
    ttlMs: opts.ttlMs ?? AI_RESULT_CACHE_TTL_MS,
    validate: opts.validate,
    log: req.log,
    load: async () => {
      // This is deliberately inside getOrCreateAiResult's in-flight owner:
      // cache hits and concurrent waiters do not consume provider budget.
      if (!(await chargeAiCost(req, res))) throw new AiCostLimitError();
      return opts.load();
    },
  });
}

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

// Cross-reference a saved spec sheet against the current recipe library. The
// diff is deterministic (the shared @workspace/spec-reconcile lib runs here AND
// on both clients), so the discrepancy list is authoritative. The stable
// Operations Insights route exposes only deterministic fields; the historical
// /ai URL retains compatibility metadata for older clients. Read-only; not
// manager-gated.
router.post(
  ["/operations-insights/spec-reconciliation", "/ai/spec-reconcile"],
  rateLimit({
    windowMs: SPEC_RECONCILE_RATE_WINDOW_MS,
    max: SPEC_RECONCILE_RATE_MAX,
    keyGenerator: (req) =>
      `operations-spec-reconciliation:${req.userId ?? req.ip ?? "unknown"}`,
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
      req.log.error({ err }, "operations spec reconciliation failed to load saved spec sheet");
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

    res.json({
      specSheetId: validation.data.specSheetId,
      discrepancies,
      generatedAt: Date.now(),
      ...(req.path.startsWith("/ai/")
        ? { summary: "", aiGenerated: false, aiStatus: "deterministic" as const }
        : {}),
    });
  },
);

// Return the already-computed mix discrepancies. The deterministic diff (the
// shared @workspace/mix-reconcile lib) runs on both clients. The stable
// Operations Insights route exposes only deterministic fields; the historical
// /ai URL retains compatibility metadata. Not manager-gated (any signed-in
// user).
router.post(
  ["/operations-insights/mix-reconciliation", "/ai/mix-reconcile"],
  rateLimit({
    windowMs: MIX_RECONCILE_RATE_WINDOW_MS,
    max: MIX_RECONCILE_RATE_MAX,
    keyGenerator: (req) =>
      `operations-mix-reconciliation:${req.userId ?? req.ip ?? "unknown"}`,
    store: mixReconcileRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateMixReconcileBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const discrepancies = toMixDiscrepancies(validation.data);

    res.json({
      discrepancies,
      generatedAt: Date.now(),
      ...(req.path.startsWith("/ai/")
        ? { summary: "", aiGenerated: false, aiStatus: "deterministic" as const }
        : {}),
    });
  },
);

// Mixes helper: a single-shot, staff-facing Q&A over the current mixes —
// explain a mix, total an ingredient, compare amounts. Grounded strictly in the
// supplied mix definitions and the facility memory. Advisory only — never edits
// a mix, never writes anything, and (by design) returns no structured apply.
// Not manager-gated: floor staff can use this read-only reconciliation.


// End-of-day / weekly production recap. Stats and the plain-language summary are
// computed deterministically from the supplied runs (shared
// @workspace/day-summary lib). The stable Operations Insights route exposes the
// deterministic contract; the historical /ai URL retains compatibility
// metadata. This endpoint never calls a model or writes run data.
router.post(
  ["/operations-insights/recap", "/ai/summary"],
  rateLimit({
    windowMs: SUMMARY_RATE_WINDOW_MS,
    max: SUMMARY_RATE_MAX,
    keyGenerator: (req) => `operations-recap:${req.userId ?? req.ip ?? "unknown"}`,
    store: summaryRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateSummaryBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Deterministic stats and recap are the complete response.
    const stats = aggregateDaySummary(toSummaryAggInput(validation.data));
    const fallback = buildFallbackSummary(stats);

    res.json({
      summary: fallback,
      stats,
      generatedAt: Date.now(),
      ...(req.path.startsWith("/ai/")
        ? { aiGenerated: false, aiStatus: "deterministic" as const }
        : {}),
    });
  },
);

// Predictive-maintenance / anomaly flags. Drift detection (downtime/yield/
// stoppages vs. a per-product baseline) is computed deterministically from the
// supplied runs (shared @workspace/anomaly lib). The stable Operations Insights
// route exposes the deterministic contract; the historical /ai URL retains
// compatibility metadata.
router.post(
  ["/operations-insights/anomalies", "/ai/anomalies"],
  rateLimit({
    windowMs: ANOMALY_RATE_WINDOW_MS,
    max: ANOMALY_RATE_MAX,
    keyGenerator: (req) => `operations-anomalies:${req.userId ?? req.ip ?? "unknown"}`,
    store: anomalyRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateAnomalyBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Deterministic detection is the complete result.
    const result = detectAnomalies(toAnomalyDetectInput(validation.data));

    const baseResponse = {
      anomalies: result.anomalies,
      checkedRuns: result.checkedRuns,
      baselineRuns: result.baselineRuns,
      generatedAt: Date.now(),
    };

    // Not enough history to judge anything → honest deterministic note.
    if (result.baselineRuns < 3) {
      res.json({
        ...baseResponse,
        summary: "",
        note: "Not enough run history yet to spot anomalies.",
        ...(req.path.startsWith("/ai/")
          ? { aiGenerated: false, aiStatus: "deterministic" as const }
          : {}),
      });
      return;
    }

    res.json({
      ...baseResponse,
      summary: "",
      ...(req.path.startsWith("/ai/")
        ? { aiGenerated: false, aiStatus: "deterministic" as const }
        : {}),
    });
  },
);

// Schedule-order suggestion. Given the runs planned for one day, the server
// deterministically proposes an ordering (allergen runs end-of-day, similar
// brand/die grouped to cut changeovers, factory sequence rules honored — shared
// @workspace/schedule-optimize lib). The stable Operations Insights route
// exposes the deterministic contract; the historical /ai URL retains
// compatibility metadata. Read-only — the manager applies the returned order
// through the normal move path.
router.post(
  ["/operations-insights/schedule-order", "/ai/schedule-optimize"],
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: SCHEDULE_RATE_WINDOW_MS,
    max: SCHEDULE_RATE_MAX,
    keyGenerator: (req) => `operations-schedule-order:${req.userId ?? req.ip ?? "unknown"}`,
    store: scheduleRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateScheduleBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    // Deterministic ordering and metrics are the complete result.
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

    // Fewer than 2 runs, or no strictly better order → return a deterministic
    // explanation without attempting to narrate it.
    if (result.ordered.length < 2) {
      res.json({
        ...baseResponse,
        summary: "",
        note: "Not enough runs to reorder.",
        ...(req.path.startsWith("/ai/")
          ? { aiGenerated: false, aiStatus: "deterministic" as const }
          : {}),
      });
      return;
    }
    if (!result.improved) {
      res.json({
        ...baseResponse,
        summary: "",
        note: "Runs are already in a good order.",
        ...(req.path.startsWith("/ai/")
          ? { aiGenerated: false, aiStatus: "deterministic" as const }
          : {}),
      });
      return;
    }

    res.json({
      ...baseResponse,
      summary: "",
      ...(req.path.startsWith("/ai/")
        ? { aiGenerated: false, aiStatus: "deterministic" as const }
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

    // Source-priority resolution already happened in the client. Declare each
    // validated requested field unresolved explicitly so this retained route
    // still uses the shared two-phase status/orchestration boundary.
    const requested: RequestedField[] = validation.data.fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      options: f.options,
    }));
    const resolution = await resolveUnresolvedData({
      label: "ai-fill-missing",
      log: req.log,
      input: requested,
      resolveDeterministically: (fields) => ({ resolved: undefined, unresolved: fields }),
      hasUnresolved: (fields) => fields.length > 0,
      buildModelInput: (fields) => ({ fields, system, userPrompt }),
      call: async ({ system: promptSystem, userPrompt: promptUser }) => {
        const response = await openai.chat.completions.create({
          model: pickModel("cheap"),
          max_completion_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: promptSystem },
            { role: "user", content: promptUser },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
      sanitize: (raw, fields) => sanitizeFillMissingSuggestions(raw, fields),
      merge: (_resolved, suggestions) => suggestions,
    });
    if (resolution.metadata.aiStatus === "unavailable") {
      if (
        resolution.metadata.modelStatus === "provider-unavailable" ||
        resolution.metadata.modelStatus === "rate-limited"
      ) {
        const failure = aiCallFailureHttp(
          {
            reason:
              resolution.metadata.modelStatus === "rate-limited" ? "rate-limited" : "provider",
          },
          "AI provider error",
        );
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({
        suggestions: [],
        generatedAt: Date.now(),
        ...resolution.metadata,
      });
      return;
    }
    const verdicts = await reviewSuggestions({
      featureLabel: "auto-filled values for missing product/run setup fields",
      instructions:
        "Flag any value that is implausible for its field, contradicts the product's known brand/flavor/size, or is an unsafe default to commit. Approve values that are clearly correct and well-justified.",
      items: resolution.data.suggestions.map((s, i) => ({
        id: `fm-${i}`,
        text: `${s.key} = "${s.value}" — ${s.rationale}`,
      })),
      log: req.log,
    });
    const reviewed = resolution.data.suggestions.map((s, i) => {
      const v = verdicts.get(`fm-${i}`);
      return v ? { ...s, review: v } : s;
    });

    res.json({
      suggestions: reviewed,
      generatedAt: Date.now(),
      ...resolution.metadata,
      ...(resolution.data.note ? { note: resolution.data.note } : {}),
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

    type MatchImportCacheBody = {
      brandMatches: unknown[];
      flavorMatches: unknown[];
      ingredientMatches: unknown[];
      appTypeMatches: unknown[];
      pepTypeMatches: unknown[];
      aiStatus: "enriched" | "unavailable";
      note?: string;
    };
    const model = pickModel("cheap");
    let resolution;
    try {
      resolution = await resolveUnresolvedDataWithEnrichment({
        input: validation.data,
        resolveDeterministically: resolveDeterministicMatchImport,
        hasUnresolved: (unresolved) =>
          unresolved.unmatchedBrands.length > 0 ||
          unresolved.unmatchedFlavors.length > 0 ||
          (unresolved.unmatchedIngredients ?? []).length > 0 ||
          (unresolved.unmatchedAppTypes ?? []).length > 0 ||
          (unresolved.unmatchedPepTypes ?? []).length > 0,
        enrichUnresolved: async (unresolved) => {
          const { system, user } = buildMatchImportPrompt(unresolved);
          const userPrompt = await groundPromptWithMemory(req.log, user, {
            correctionDomains: ["brand", "flavor"],
          });
          const cached = await cachedAiResponse<MatchImportCacheBody>(req, res, {
        operation: "match-import",
        model,
        system,
        user: userPrompt,
        validate: (value): value is MatchImportCacheBody =>
          isObject(value) &&
          Array.isArray(value.brandMatches) &&
          Array.isArray(value.flavorMatches) &&
          Array.isArray(value.ingredientMatches) &&
          Array.isArray(value.appTypeMatches) &&
          Array.isArray(value.pepTypeMatches) &&
          value.brandMatches.every(isObject) &&
          value.flavorMatches.every(isObject) &&
          value.ingredientMatches.every(isObject) &&
          value.appTypeMatches.every(isObject) &&
          value.pepTypeMatches.every(isObject) &&
          (value.aiStatus === "enriched" || value.aiStatus === "unavailable"),
        load: async () => {
          const result = await fetchModelJsonWithRetry({
            label: "ai-match-import",
            log: req.log,
            call: async () => {
              const response = await openai.chat.completions.create({
                model,
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
              throw new AiResponseError(failure.status, failure.error);
            }
            return {
              value: {
                brandMatches: [],
                flavorMatches: [],
                ingredientMatches: [],
                appTypeMatches: [],
                pepTypeMatches: [],
                aiStatus: "unavailable",
              },
              cacheable: false,
            };
          }

          const raw = result.raw;
          const rawIsValidShape =
            isObject(raw) &&
            Array.isArray(raw.brandMatches) &&
            Array.isArray(raw.flavorMatches) &&
            Array.isArray(raw.ingredientMatches) &&
            Array.isArray(raw.appTypeMatches) &&
            Array.isArray(raw.pepTypeMatches);
          const {
            brandMatches,
            flavorMatches,
            ingredientMatches,
            appTypeMatches,
            pepTypeMatches,
            note,
          } = sanitizeMatchImport(raw, unresolved);
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
          const value: MatchImportCacheBody = {
            // Cache only the model-owned unresolved suggestions. Deterministic
            // matches are request-local and are merged below on every response;
            // storing them under a fingerprint built from the reduced unresolved
            // prompt could replay another request's deterministic matches.
            brandMatches: brandMatches.map((m, i) => {
              const v = verdicts.get(`brand-${i}`);
              return v ? { ...m, review: v } : m;
            }),
            flavorMatches: flavorMatches.map((m, i) => {
              const v = verdicts.get(`flavor-${i}`);
              return v ? { ...m, review: v } : m;
            }),
            ingredientMatches: ingredientMatches.map((m, i) => {
              const v = verdicts.get(`ingredient-${i}`);
              return v ? { ...m, review: v } : m;
            }),
            appTypeMatches: appTypeMatches.map((m, i) => {
              const v = verdicts.get(`app-${i}`);
              return v ? { ...m, review: v } : m;
            }),
            pepTypeMatches: pepTypeMatches.map((m, i) => {
              const v = verdicts.get(`pep-${i}`);
              return v ? { ...m, review: v } : m;
            }),
            aiStatus: "enriched",
            ...(note ? { note } : {}),
          };
          return { value, cacheable: rawIsValidShape };
        },
          });
          return {
            suggestions: cached.value,
            status: cached.value.aiStatus,
            ...(cached.value.aiStatus === "unavailable" ? { modelStatus: "malformed" as const } : {}),
          };
        },
        emptySuggestions: (): MatchImportCacheBody => ({
          brandMatches: [],
          flavorMatches: [],
          ingredientMatches: [],
          appTypeMatches: [],
          pepTypeMatches: [],
          aiStatus: "unavailable" as const,
        }),
        merge: (resolved, suggestions) => ({
          brandMatches: [...resolved.brandMatches, ...suggestions.brandMatches],
          flavorMatches: [...resolved.flavorMatches, ...suggestions.flavorMatches],
          ingredientMatches: [...resolved.ingredientMatches, ...suggestions.ingredientMatches],
          appTypeMatches: [...resolved.appTypeMatches, ...suggestions.appTypeMatches],
          pepTypeMatches: [...resolved.pepTypeMatches, ...suggestions.pepTypeMatches],
          ...(suggestions.note ? { note: suggestions.note } : {}),
        }),
      });
    } catch (err) {
      if (err instanceof AiCostLimitError) {
        finishAiCostLimitResponse(res);
        return;
      }
      if (err instanceof AiResponseError) {
        // The resolver owns the success/status path. Preserve this route's
        // established provider fallback while retaining freshly deterministic
        // matches without attempting a second provider call.
        const deterministic = resolveDeterministicMatchImport(validation.data);
        res.json({
          ...deterministic.resolved,
          aiGenerated: false,
          aiStatus: "unavailable",
          decision: "suggestion",
          note: "AI matching is unavailable; deterministic matches were retained for review.",
          generatedAt: Date.now(),
        }); return;
      }
      throw err;
    }

    res.json({ ...resolution.data, ...resolution.metadata, generatedAt: Date.now() });
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
    const extraction = await extractReviewedDocument<
      { kind: "workbook-text"; workbookText: string },
      ParsedSpecImport
    >({
      label: "ai-parse-spec-sheet",
      log: req.log,
      adapter: workbookTextAdapter,
      source: { kind: "workbook-text" as const, workbookText: validation.data.workbookText },
      prompt: { system, user: userPrompt },
      call: async ({ prompt }) => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          // Parsing echoes the whole workbook chunk back as structured JSON, so
          // output scales with input: a chunk carrying ~240 spec profiles
          // overflowed 32768 output tokens → truncated non-JSON → empty result.
          // Use the model's full 64k output budget for this route.
          max_completion_tokens: 65536,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
      sanitize: (raw) => sanitizeParseSpecSheet(raw, validation.data),
      empty: (): ParsedSpecImport => ({ profiles: [], recipes: [] }),
      review: async (parsed) => {
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
        return {
          ...parsed,
          profiles: parsed.profiles.map((p, i) => {
            const v = verdicts.get(`profile-${i}`);
            return v ? { ...p, review: v } : p;
          }),
          recipes: parsed.recipes.map((r, i) => {
            const v = verdicts.get(`recipe-${i}`);
            return v ? { ...r, review: v } : r;
          }),
        };
      },
    });
    if (!extraction.ok) {
      if (
        extraction.metadata.modelStatus === "provider-unavailable" ||
        extraction.metadata.modelStatus === "rate-limited"
      ) {
        const failure = aiCallFailureHttp(
          {
            reason:
              extraction.metadata.modelStatus === "provider-unavailable"
                ? "provider"
                : "rate-limited",
          },
          "AI provider error",
        );
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({
        profiles: [],
        recipes: [],
        generatedAt: Date.now(),
        ...extraction.metadata,
        note: "The AI couldn't parse this portion of the sheet (its response was cut off or malformed). Nothing from this portion was imported — try again or split the file.",
      });
      return;
    }
    const parsed = extraction.data;

    res.json({
      profiles: parsed.profiles,
      recipes: parsed.recipes,
      generatedAt: Date.now(),
      ...extraction.metadata,
      ...(parsed.note ? { note: parsed.note } : {}),
      ...(parsed.warnings?.length ? { warnings: parsed.warnings } : {}),
    });
  },
);

router.post(
  "/ai/parse-spec-images",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PARSE_SPEC_RATE_WINDOW_MS,
    max: PARSE_SPEC_RATE_MAX,
    keyGenerator: (req) => `ai-parse-spec-images:${req.userId ?? req.ip ?? "unknown"}`,
    store: parseSpecRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateParseSpecImagesBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const { images } = validation.data;
    const extraction = await extractReviewedDocument({
      label: "ai-parse-spec-images",
      log: req.log,
      adapter: specImagesAdapter,
      source: {
        kind: "spec-images" as const,
        images: images.map((image) => ({
          imageBase64: image.imageBase64,
          mimeType: image.mimeType ?? "image/jpeg",
        })),
      },
      prompt: {
        system:
          "You transcribe photographed frozen-pizza spec sheets and recipe pages. " +
          "Read every visible row and number exactly; do not interpret, summarize, " +
          "or invent values. Preserve page order and represent each page as a " +
          "tab-separated workbook-style section. Return only JSON.",
        user:
          "Transcribe all of these pages into one bounded workbook-style text. " +
          "Use a heading such as [Photo 1] before each page, tab-separated cells " +
          "for each row, and keep blank cells blank. Include all labels, headers, " +
          "units, recipe ingredients, targets, and handwritten values you can read. " +
          'Return exactly {"workbookText":string,"note":string}.',
      },
      call: async ({ prompt, source }) => {
        if (source.kind !== "spec-images") throw new Error("Invalid spec-image source");
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 65536,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                prompt.system,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    prompt.user,
                },
                ...source.images.map((image) => ({
                  type: "image_url" as const,
                  image_url: {
                    url: `data:${image.mimeType || "image/jpeg"};base64,${image.imageBase64}`,
                  },
                })),
              ],
            },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
      sanitize: (raw) => {
        const value = raw as { workbookText?: unknown; note?: unknown };
        return {
          workbookText: typeof value.workbookText === "string" ? value.workbookText.trim() : "",
          note: typeof value.note === "string" ? value.note : "",
        };
      },
      empty: () => ({ workbookText: "", note: "" }),
    });
    if (!extraction.ok) {
      if (
        extraction.metadata.modelStatus === "provider-unavailable" ||
        extraction.metadata.modelStatus === "rate-limited"
      ) {
        const failure = aiCallFailureHttp(
          {
            reason:
              extraction.metadata.modelStatus === "rate-limited"
                ? "rate-limited"
                : "provider",
          },
          "Vision provider error",
        );
        res.status(failure.status).json({ error: failure.error });
      } else {
        res.json({
          workbookText: "",
          generatedAt: Date.now(),
          ...extraction.metadata,
          note: "The photos could not be read. Please retake them with better lighting and focus.",
        });
      }
      return;
    }
    const { workbookText, note } = extraction.data;
    if (!workbookText) {
      res.json({
        workbookText: "",
        generatedAt: Date.now(),
        ...extraction.metadata,
        note: note || "The photos did not contain readable spec-sheet text.",
      });
      return;
    }
    // Keep this adapter read-only: the existing workbook parser owns all
    // canonicalization, review, and eventual writes after explicit confirmation.
    res.json({
      workbookText: workbookText.slice(0, 60_000),
      generatedAt: Date.now(),
      ...extraction.metadata,
      ...(note.trim() ? { note: note.trim() } : {}),
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

    type MatchPremixCacheBody = {
      matches: unknown[];
      aiStatus: "enriched" | "unavailable";
    };
    const model = pickModel("cheap");
    let resolution;
    try {
      resolution = await resolveUnresolvedDataWithEnrichment({
        input: validation.data,
        resolveDeterministically: (data) => {
          const deterministic = resolveDeterministicMatchPremix(data);
          return { resolved: deterministic.matches, unresolved: deterministic.unresolvedNames };
        },
        hasUnresolved: (names) => names.length > 0,
        enrichUnresolved: async (unresolvedNames) => {
          const aiInput = { ...validation.data, unmatchedNames: unresolvedNames };
          const { system, user } = buildMatchPremixPrompt(aiInput);
          const userPrompt = await groundPromptWithMemory(req.log, user, {
            correctionDomains: ["brand", "flavor"],
          });
          const cached = await cachedAiResponse(req, res, {
        operation: "match-premix",
        model,
        system,
        user: userPrompt,
        validate: (value): value is MatchPremixCacheBody =>
          isObject(value) &&
          Array.isArray(value.matches) &&
          value.matches.every(isObject) &&
          (value.aiStatus === "enriched" || value.aiStatus === "unavailable"),
        load: async () => {
          const result = await fetchModelJsonWithRetry({
            label: "ai-match-premix",
            log: req.log,
            call: async () => {
              const response = await openai.chat.completions.create({
                model,
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
              throw new AiResponseError(failure.status, failure.error);
            }
            return {
              value: { matches: [], aiStatus: "unavailable" as const },
              cacheable: false,
            };
          }
          const raw = result.raw;
          const rawIsValidShape = isObject(raw) && Array.isArray(raw.matches);
          const matches = sanitizeMatchPremix(raw, aiInput);
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
          const value: MatchPremixCacheBody = {
            matches: matches.map((m, i) => {
              const v = verdicts.get(`match-${i}`);
              return v ? { ...m, review: v } : m;
            }),
            aiStatus: "enriched",
          };
          return { value, cacheable: rawIsValidShape };
        },
          });
          return {
            suggestions: cached.value.matches,
            status: cached.value.aiStatus,
            ...(cached.value.aiStatus === "unavailable" ? { modelStatus: "malformed" as const } : {}),
          };
        },
        emptySuggestions: () => [],
        merge: (resolved, suggestions) => ({ matches: [...resolved, ...suggestions] }),
      });
    } catch (err) {
      if (err instanceof AiCostLimitError) {
        finishAiCostLimitResponse(res);
        return;
      }
      if (err instanceof AiResponseError) {
        const deterministic = resolveDeterministicMatchPremix(validation.data);
        res.json({
          matches: deterministic.matches,
          aiGenerated: false,
          aiStatus: "unavailable",
          decision: "suggestion",
          note: "AI matching is unavailable; deterministic matches were retained for review.",
          generatedAt: Date.now(),
        });
        return;
      }
      throw err;
    }

    res.json({ ...resolution.data, ...resolution.metadata, generatedAt: Date.now() });
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

    // Load corrections now so we can (a) add a prompt hint listing already-
    // known pairs (saves tokens, helps the model skip them) and (b) apply a
    // deterministic post-filter after the AI responds that guarantees known
    // pairs are never returned regardless of model behaviour.
    const corrections = await loadCorrections(req.log);
    type MergeCacheBody = {
      suggestions: unknown[];
      aiStatus: "enriched" | "unavailable";
      note?: string;
    };
    const model = pickModel("cheap");
    let resolution;
    try {
      resolution = await resolveUnresolvedDataWithEnrichment({
        input: validation.data.names,
        // Corrections are a post-sanitize exclusion, not auto-applied merges.
        // Every remaining name is unresolved and needs advisory enrichment.
        resolveDeterministically: (names) => ({ resolved: [], unresolved: names }),
        hasUnresolved: (names) => names.length > 1,
        enrichUnresolved: async (names) => {
          const promptInput = { ...validation.data, names };
          const { system, user } = buildSuggestMergesPrompt(promptInput);
          const knownPairsNote = buildKnownPairsNote(corrections, names);
          const userWithHint = knownPairsNote ? `${user}\n\n${knownPairsNote}` : user;
          const userPrompt = await groundPromptWithMemory(req.log, userWithHint, {
            correctionDomains: ["ingredient", "die"],
          });
          const cached = await cachedAiResponse<MergeCacheBody>(req, res, {
        operation: "suggest-merges",
        model,
        system,
        user: userPrompt,
        validate: (value): value is MergeCacheBody =>
          isObject(value) &&
          Array.isArray(value.suggestions) &&
          value.suggestions.every(isObject) &&
          (value.aiStatus === "enriched" || value.aiStatus === "unavailable") &&
          (value.note === undefined || typeof value.note === "string"),
        load: async () => {
          const result = await fetchModelJsonWithRetry({
            label: "ai-suggest-merges",
            log: req.log,
            call: async () => {
              const response = await openai.chat.completions.create({
                model,
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
              throw new AiResponseError(failure.status, failure.error);
            }
            return {
              value: { suggestions: [], aiStatus: "unavailable" as const },
              cacheable: false,
            };
          }
          const raw = result.raw;
          const rawIsValidShape = isObject(raw) && Array.isArray(raw.suggestions);
          const suggestions = filterKnownMerges(
            sanitizeSuggestMerges(raw, names),
            corrections,
          );
          const note =
            isObject(raw) && typeof raw.note === "string"
              ? raw.note.trim().slice(0, 500)
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
          const value: MergeCacheBody = {
            suggestions: suggestions.map((s, i) => {
              const v = verdicts.get(`merge-${i}`);
              return v ? { ...s, review: v } : s;
            }),
            aiStatus: "enriched",
            ...(note ? { note } : {}),
          };
          return { value, cacheable: rawIsValidShape };
        },
          });
          return {
            suggestions: cached.value,
            status: cached.value.aiStatus,
            ...(cached.value.aiStatus === "unavailable" ? { modelStatus: "malformed" as const } : {}),
          };
        },
        emptySuggestions: (): MergeCacheBody => ({
          suggestions: [],
          aiStatus: "unavailable",
        }),
        merge: (_resolved, suggestions) => ({
          suggestions: suggestions.suggestions,
          ...(suggestions.note ? { note: suggestions.note } : {}),
        }),
      });
    } catch (err) {
      if (err instanceof AiCostLimitError) {
        finishAiCostLimitResponse(res);
        return;
      }
      if (err instanceof AiResponseError) {
        res.json({
          suggestions: [],
          aiGenerated: false,
          aiStatus: "unavailable",
          decision: "suggestion",
          note: "AI merge suggestions are unavailable. No changes were applied.",
          generatedAt: Date.now(),
        });
        return;
      }
      throw err;
    }

    res.json({ ...resolution.data, ...resolution.metadata, generatedAt: Date.now() });
  },
);

export default router;
