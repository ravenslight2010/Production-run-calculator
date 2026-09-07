import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability } from "../middlewares/requireCapability";
import { getStaffMember, listStaff } from "../lib/roles";
import {
  countUnreviewedIncidents,
  createIncident,
  getIncident,
  listIncidents,
  markIncidentResolved,
  markIncidentReviewed,
  countActionableIncidents,
  updateIncidentWorkflow,
} from "../lib/incidents";
import {
  buildIncidentContext,
  redactDiagnosticText,
  safeIncidentLogMetadata,
  validateReportBody,
} from "./incidentsAi";
import {
  buildFallbackClusters,
  CLUSTER_MIN_INCIDENTS,
  DEFAULT_LOOKBACK_DAYS,
  shapeIncidents,
  validateClustersBody,
} from "./aiIncidentClusters";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function pathId(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

// Cost/abuse guard for the paid incident-diagnosis endpoint: per-user fixed
// window. This also bounds a crash loop that keeps auto-submitting — the
// surplus is dropped with a 429 rather than fanning out into many paid calls.
// Matches the AI optimize/photo endpoints' posture (10 requests / minute).
const REPORT_RATE_WINDOW_MS = 60_000;
const REPORT_RATE_MAX = 10;

// In production the API may run with more than one instance, so the cap is
// backed by a shared Postgres store. Elsewhere it falls back to in-memory.
// Each endpoint gets its own store and namespaced key so their quotas are
// independent: exhausting the diagnosis limit cannot deny the clustering
// endpoint (and vice versa).
const reportRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(REPORT_RATE_WINDOW_MS)
    : undefined;

const CLUSTERS_RATE_WINDOW_MS = 60_000;
const CLUSTERS_RATE_MAX = 10;
const clustersRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(CLUSTERS_RATE_WINDOW_MS)
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
    keyGenerator: (req) => `ai-incident-diagnosis:${req.userId ?? req.ip ?? "unknown"}`,
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
    const correlationId = String(
      (req as typeof req & { correlationId?: string }).correlationId
      ?? req.id
      ?? randomUUID(),
    );
    res.setHeader("X-Correlation-ID", correlationId);
    context.correlationId = correlationId;
    const safeScreen = redactDiagnosticText(data.screen.split("?")[0] ?? "", 120) || "unknown";
    const safeAppVersion = data.appVersion
      ? redactDiagnosticText(data.appVersion, 64) || null
      : null;

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
    // Generated diagnosis was retired before retention cleanup. Incident capture,
    // human notes, assignment, and workflow history remain fully operational.
    const history = { recurrence: null as null };
    const diagnosis = null;
    const workaround = null;

    const incident = await createIncident({
      source: data.source,
      reporterId: userId,
      reporterName,
      reporterRole,
      screen: safeScreen,
      appPlatform: data.appPlatform,
      appVersion: safeAppVersion,
      context,
      diagnosis,
      workaround,
      recurrence: history.recurrence,
    });
    logger.info({
      event: "incident_captured",
      correlationId,
      incidentId: incident.id,
      operationType: "incident",
      ...safeIncidentLogMetadata(data, context),
    }, "privacy-safe incident captured");

    res.json({
      incidentId: incident.id,
      correlationId,
      diagnosis,
      workaround,
      recurrence: history.recurrence,
      aiGenerated: false,
    });
  },
);

// Manager-only deterministic grouping across the incident log. The stable
// Operations Insights route exposes only deterministic fields; the historical
// /ai URL retains compatibility metadata. Advisory and read-only; groups are
// keyed by platform and screen.
router.post(
  ["/operations-insights/incident-patterns", "/ai/incident-clusters"],
  requireCapability("review-incidents"),
  rateLimit({
    windowMs: CLUSTERS_RATE_WINDOW_MS,
    max: CLUSTERS_RATE_MAX,
    keyGenerator: (req) =>
      `operations-incident-patterns:${req.userId ?? req.ip ?? "unknown"}`,
    store: clustersRateStore,
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
    const { shaped } = shapeIncidents(incidents, lookbackDays, Date.now());
    const shapedIds = new Set(shaped.map((item) => item.id));
    const evidenceIncidents = incidents.filter((item) => shapedIds.has(item.id));
    const evidence = {
      windowDays: lookbackDays,
      sampleCount: shaped.length,
      platforms: [...new Set(evidenceIncidents.map((item) => item.appPlatform))].slice(0, 6),
      builds: [...new Set(evidenceIncidents.map((item) => item.appVersion).filter((value): value is string => Boolean(value)))].slice(0, 8),
      screens: [...new Set(shaped.map((item) => item.screen))].slice(0, 8),
      confidence: shaped.length < 5 ? "limited" : shaped.length < 15 ? "moderate" : "strong",
    };

    // Too few to cluster — return an empty, honest deterministic result.
    if (shaped.length < CLUSTER_MIN_INCIDENTS) {
      res.json({
        clusters: [],
        totalIncidents: shaped.length,
        note:
          shaped.length === 0
            ? "No incidents in the selected window yet."
            : "Not enough incidents yet to find a pattern.",
        generatedAt: Date.now(),
        evidence,
        ...(req.path.startsWith("/ai/")
          ? { aiGenerated: false, aiStatus: "deterministic" as const }
          : {}),
      });
      return;
    }

    res.json({
      clusters: buildFallbackClusters(shaped),
      totalIncidents: shaped.length,
      generatedAt: Date.now(),
      evidence,
      ...(req.path.startsWith("/ai/")
        ? { aiGenerated: false, aiStatus: "deterministic" as const }
        : {}),
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

router.get("/incidents/actionable-count", requireCapability("review-incidents"), async (_req, res): Promise<void> => {
  res.json({ count: await countActionableIncidents() });
});

router.get("/incidents/assignees", requireCapability("review-incidents"), async (_req, res): Promise<void> => {
  const staff = await listStaff();
  res.json(staff.filter((s) => !s.sandbox).map((s) => ({
    userId: s.userId,
    name: s.name ?? s.userId,
    role: s.role,
  })));
});

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

router.patch("/incidents/:id/workflow", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const priorities = new Set(["low", "normal", "high", "urgent"]);
  const states = new Set(["new", "assigned", "waiting", "resolved"]);
  if ((body.priority !== undefined && !priorities.has(body.priority)) ||
      (body.workflowState !== undefined && !states.has(body.workflowState)) ||
      (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) ||
      (body.assigneeId !== undefined && body.assigneeId !== null && typeof body.assigneeId !== "string")) {
    res.status(400).json({ error: "Invalid incident workflow update" });
    return;
  }
  let assigneeName: string | null | undefined;
  if (body.assigneeId) {
    const staff = await getStaffMember(body.assigneeId);
    if (staff.sandbox || !staff.name) {
      res.status(400).json({ error: "Assignee is not eligible" });
      return;
    }
    assigneeName = staff.name;
  } else if (body.assigneeId === null) {
    assigneeName = null;
  }
  const actor = await getStaffMember(req.userId!);
  const incident = await updateIncidentWorkflow(pathId(req.params.id), {
    priority: body.priority,
    workflowState: body.workflowState,
    assigneeId: body.assigneeId,
    assigneeName,
    note: body.note,
    actorName: actor.name ?? req.userId!,
    actorId: req.userId!,
  });
  if (!incident) {
    res.status(404).json({ error: "No incident with that id" });
    return;
  }
  res.json(incident);
});

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
