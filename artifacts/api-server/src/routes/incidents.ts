import { Router, type IRouter } from "express";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability } from "../middlewares/requireCapability";
import { getStaffMember } from "../lib/roles";
import {
  countUnreviewedIncidents,
  createIncident,
  getIncident,
  listIncidents,
  markIncidentResolved,
  markIncidentReviewed,
} from "../lib/incidents";
import {
  analyzeIncidentHistory,
  appendIncidentHistoryBlock,
  buildDiagnosisPrompt,
  buildIncidentContext,
  buildIncidentMemoryFact,
  FALLBACK_DIAGNOSIS,
  FALLBACK_WORKAROUND,
  INCIDENT_MEMORY_DOMAIN,
  sanitizeDiagnosis,
  validateReportBody,
} from "./incidentsAi";
import {
  loadFacilityKnowledge,
  appendFacilityMemoryBlock,
  recordFacilityKnowledge,
} from "./aiMemoryContext";
import {
  buildClustersPrompt,
  buildFallbackClusters,
  CLUSTER_MIN_INCIDENTS,
  DEFAULT_LOOKBACK_DAYS,
  sanitizeClusterResponse,
  shapeIncidents,
  validateClustersBody,
} from "./aiIncidentClusters";

const router: IRouter = Router();

function pathId(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

// Cost/abuse guard for the paid diagnosis endpoint: per-user fixed window. This
// also bounds a crash loop that keeps auto-submitting — the surplus is dropped
// with a 429 rather than fanning out into many paid calls. Matches the AI
// optimize/photo endpoints' posture (10 requests / minute).
const REPORT_RATE_WINDOW_MS = 60_000;
const REPORT_RATE_MAX = 10;

// In production the API may run with more than one instance, so the cap is
// backed by a shared Postgres store. Elsewhere it falls back to in-memory.
const reportRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(REPORT_RATE_WINDOW_MS)
    : undefined;

// POST /incidents — report an issue (or auto-submit a crash) and get an AI
// diagnosis. Open to ANY signed-in user (the router already requires auth; no
// capability is needed to report a problem). We persist the incident first so
// it's never lost even if the AI call fails, then attach the diagnosis.
router.post(
  "/incidents",
  rateLimit({
    windowMs: REPORT_RATE_WINDOW_MS,
    max: REPORT_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: reportRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateReportBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const data = validation.data;
    const context = buildIncidentContext(data);

    // Snapshot the reporter's identity so the manager view survives even if the
    // account is later removed.
    const userId = req.userId ?? null;
    let reporterName: string | null = null;
    let reporterRole: string | null = req.role ?? null;
    if (userId) {
      try {
        const staff = await getStaffMember(userId);
        reporterName = staff.name;
        reporterRole = staff.role;
      } catch (err) {
        req.log.warn({ err }, "incident reporter lookup failed");
      }
    }

    // Ask the AI for a plain-language diagnosis + safe workaround. Any failure
    // (provider error, non-JSON) falls back to canned text; the incident is
    // still recorded with that same text so the manager sees what the user saw.
    const { system, user } = buildDiagnosisPrompt({
      source: data.source,
      screen: data.screen,
      appPlatform: data.appPlatform,
      appVersion: data.appVersion ?? null,
      context,
    });
    // Ground the diagnosis in history: pull the shared facility-memory pool,
    // match this report against past incidents, and inject both the general
    // operational facts AND a focused, ranked "similar past incidents" block so
    // recurring problems get history-aware recovery steps. The incidents domain
    // is excluded from the general block so it isn't double-listed alongside the
    // focused one. This route is open to EVERY signed-in user (no capability
    // required to report a problem), so privileged domains (e.g. "forecast",
    // "proactive-alerts") must be excluded from the general block the same way
    // /ai/ask and /ai/summary are — otherwise reporting an issue becomes a
    // side-channel for reading manager-gated facility knowledge.
    const knowledge = await loadFacilityKnowledge(req.log);
    const history = analyzeIncidentHistory(knowledge, {
      screen: data.screen,
      appPlatform: data.appPlatform,
      context,
    });
    const generalKnowledge = knowledge.filter(
      (k) => k.domain.trim().toLowerCase() !== INCIDENT_MEMORY_DOMAIN,
    );
    let userPrompt = appendFacilityMemoryBlock(user, generalKnowledge, undefined, false);
    userPrompt = appendIncidentHistoryBlock(userPrompt, history.similar);

    let diagnosis = FALLBACK_DIAGNOSIS;
    let workaround = FALLBACK_WORKAROUND;
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
      const content = response.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(content);
      const sanitized = sanitizeDiagnosis(parsed);
      diagnosis = sanitized.diagnosis;
      workaround = sanitized.workaround;
    } catch (err) {
      req.log.warn({ err }, "incident diagnosis failed; using fallback");
    }

    const incident = await createIncident({
      source: data.source,
      reporterId: userId,
      reporterName,
      reporterRole,
      screen: data.screen,
      appPlatform: data.appPlatform,
      appVersion: data.appVersion ?? null,
      context,
      diagnosis,
      workaround,
      recurrence: history.recurrence,
    });

    // Contribute this incident back into the shared facility-memory pool so the
    // next similar report is grounded in it. Best-effort: a memory write failure
    // must never fail the report the user just submitted.
    void recordFacilityKnowledge([
      {
        domain: INCIDENT_MEMORY_DOMAIN,
        key: history.signature,
        fact: buildIncidentMemoryFact(
          { screen: data.screen, appPlatform: data.appPlatform, context },
          history.priorExactCount + 1,
          workaround,
        ),
        source: "incident-diagnosis",
      },
    ]).catch((err) => {
      req.log.warn({ err }, "failed to record incident to facility memory");
    });

    res.json({
      incidentId: incident.id,
      diagnosis,
      workaround,
      recurrence: history.recurrence,
    });
  },
);

// POST /ai/incident-clusters — manager-only root-cause clustering across the
// incident log. The server reads the incidents itself, asks the AI to PROPOSE a
// grouping, then verifies every id and recomputes counts deterministically.
// Advisory, read-only, fail-safe (deterministic grouping when AI is unavailable).
router.post(
  "/ai/incident-clusters",
  requireCapability("review-incidents"),
  rateLimit({
    windowMs: REPORT_RATE_WINDOW_MS,
    max: REPORT_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: reportRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateClustersBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const lookbackDays =
      validation.data.lookbackDays && validation.data.lookbackDays > 0
        ? validation.data.lookbackDays
        : DEFAULT_LOOKBACK_DAYS;

    const incidents = await listIncidents();
    const { shaped, byId } = shapeIncidents(incidents, lookbackDays, Date.now());

    // Too few to cluster — return an empty, honest result rather than spend a
    // paid call inventing patterns out of one or two reports.
    if (shaped.length < CLUSTER_MIN_INCIDENTS) {
      res.json({
        clusters: [],
        totalIncidents: shaped.length,
        note:
          shaped.length === 0
            ? "No incidents in the selected window yet."
            : "Not enough incidents yet to find a pattern.",
        generatedAt: Date.now(),
        aiGenerated: false,
      });
      return;
    }

    const { system, user } = buildClustersPrompt(shaped);
    let clusters = null;
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const content = response.choices[0]?.message?.content ?? "";
      clusters = sanitizeClusterResponse(JSON.parse(content), byId);
    } catch (err) {
      req.log.warn({ err }, "incident clustering failed; using deterministic fallback");
    }

    const aiGenerated = clusters !== null;
    const finalClusters = clusters ?? buildFallbackClusters(shaped);
    res.json({
      clusters: finalClusters,
      totalIncidents: shaped.length,
      generatedAt: Date.now(),
      aiGenerated,
    });
  },
);

// GET /incidents — manager-only review list (newest first).
router.get("/incidents", requireCapability("review-incidents"), async (_req, res): Promise<void> => {
  res.json(await listIncidents());
});

// GET /incidents/unreviewed-count — manager nav badge. Declared before the
// "/incidents/:id" route so "unreviewed-count" isn't captured as an id.
router.get(
  "/incidents/unreviewed-count",
  requireCapability("review-incidents"),
  async (_req, res): Promise<void> => {
    res.json({ count: await countUnreviewedIncidents() });
  },
);

// GET /incidents/:id — manager-only single incident.
router.get("/incidents/:id", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const incident = await getIncident(pathId(req.params.id));
  if (!incident) {
    res.status(404).json({ error: "No incident with that id" });
    return;
  }
  res.json(incident);
});

// POST /incidents/:id/review — manager marks an incident reviewed.
router.post(
  "/incidents/:id/review",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const incident = await markIncidentReviewed(pathId(req.params.id));
    if (!incident) {
      res.status(404).json({ error: "No incident with that id" });
      return;
    }
    res.json(incident);
  },
);

// POST /incidents/:id/resolve — manager marks an incident resolved (fixed).
router.post(
  "/incidents/:id/resolve",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const incident = await markIncidentResolved(pathId(req.params.id));
    if (!incident) {
      res.status(404).json({ error: "No incident with that id" });
      return;
    }
    res.json(incident);
  },
);

export default router;
