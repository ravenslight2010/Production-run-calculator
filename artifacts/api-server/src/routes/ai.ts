import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireRole } from "../middlewares/requireRole";
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
  buildSuggestMergesPrompt,
  sanitizeSuggestMerges,
  validateSuggestMergesBody,
} from "./aiSuggestMerges";
import {
  buildProactivePrompt,
  sanitizeProactiveAlert,
  validateOptimizeBody as validateProactiveBody,
} from "./aiProactive";
import {
  buildAskPrompt,
  sanitizeAnswer,
  validateAskBody,
} from "./aiAsk";
import {
  aggregateForecastHistory,
  buildForecastPrompt,
  sanitizeForecast,
  validateForecastBody,
  FORECAST_MIN_RUNS,
} from "./aiForecast";
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

// Same posture for the on-demand demand forecaster: per-user fixed window,
// Postgres-backed in production so the cost cap holds across instances.
const FORECAST_RATE_WINDOW_MS = 60_000;
const FORECAST_RATE_MAX = 10;
const forecastRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(FORECAST_RATE_WINDOW_MS)
    : undefined;

router.post(
  "/ai/optimize",
  requireRole("manager"),
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

// Proactive watcher: same live-day input as /ai/optimize, but returns at most a
// single timely, dismissible nudge (or null). Polled on a cadence by the client
// while a day is running; the client owns de-dup/cooldown via the returned key.
router.post(
  "/ai/proactive-alert",
  requireRole("manager"),
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

    const knowledge = await loadFacilityKnowledge(req.log);
    const { system, user } = buildProactivePrompt(validation.data);
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

// On-demand demand forecaster: given recent finished history (grouped by day)
// and any scheduled future runs, predict a suggested run plan for one upcoming
// day plus a plain-language rationale. Manager-gated and read-only — nothing is
// committed; the manager reviews the suggestion into the editable schedule.
router.post(
  "/ai/forecast",
  requireRole("manager"),
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
    const { system, user } = buildForecastPrompt(validation.data);
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
      const products = forecast.runs
        .map((r) => `${r.brand} ${r.flavor} (~${r.casesNeeded}cs)`)
        .join(", ");
      void recordFacilityKnowledge([
        {
          domain: "forecast",
          key: `plan:${forecast.targetDate}`,
          fact: `Forecast for ${forecast.targetDate} [${forecast.confidence} confidence]: ${products}.`,
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

router.post(
  "/ai/fill-missing",
  requireRole("manager"),
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
  requireRole("manager"),
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
  requireRole("manager"),
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
        max_completion_tokens: 16384,
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
        ...parsed.recipes.map((r, i) => ({
          id: `recipe-${i}`,
          text: `${r.kind} recipe "${r.name}"${r.brand ? ` (brand ${r.brand}${r.flavor ? `, flavor ${r.flavor}` : ""})` : ""}`,
        })),
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
  "/ai/suggest-merges",
  requireRole("manager"),
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
