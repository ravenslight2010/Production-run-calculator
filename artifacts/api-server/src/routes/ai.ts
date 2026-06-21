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
import { reviewSuggestions } from "./aiReviewer";
import { loadCorrections, appendCorrectionsBlock } from "./aiCorrectionsContext";
import { loadFacilityKnowledge, appendFacilityMemoryBlock } from "./aiMemoryContext";

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
