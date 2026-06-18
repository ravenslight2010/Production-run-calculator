import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireRole } from "../middlewares/requireRole";
import { getStaffMember } from "../lib/roles";
import {
  countUnreviewedIncidents,
  createIncident,
  getIncident,
  listIncidents,
  markIncidentReviewed,
} from "../lib/incidents";
import {
  buildDiagnosisPrompt,
  buildIncidentContext,
  FALLBACK_DIAGNOSIS,
  FALLBACK_WORKAROUND,
  sanitizeDiagnosis,
  validateReportBody,
} from "./incidentsAi";

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
// diagnosis. Open to ANY signed-in user (requireRole("operator") admits all
// roles and also resolves req.role / bootstraps the user's row). We persist the
// incident first so it's never lost even if the AI call fails, then attach the
// diagnosis.
router.post(
  "/incidents",
  requireRole("operator"),
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

    let diagnosis = FALLBACK_DIAGNOSIS;
    let workaround = FALLBACK_WORKAROUND;
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
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
    });

    res.json({ incidentId: incident.id, diagnosis, workaround });
  },
);

// GET /incidents — manager-only review list (newest first).
router.get("/incidents", requireRole("manager"), async (_req, res): Promise<void> => {
  res.json(await listIncidents());
});

// GET /incidents/unreviewed-count — manager nav badge. Declared before the
// "/incidents/:id" route so "unreviewed-count" isn't captured as an id.
router.get(
  "/incidents/unreviewed-count",
  requireRole("manager"),
  async (_req, res): Promise<void> => {
    res.json({ count: await countUnreviewedIncidents() });
  },
);

// GET /incidents/:id — manager-only single incident.
router.get("/incidents/:id", requireRole("manager"), async (req, res): Promise<void> => {
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
  requireRole("manager"),
  async (req, res): Promise<void> => {
    const incident = await markIncidentReviewed(pathId(req.params.id));
    if (!incident) {
      res.status(404).json({ error: "No incident with that id" });
      return;
    }
    res.json(incident);
  },
);

export default router;
