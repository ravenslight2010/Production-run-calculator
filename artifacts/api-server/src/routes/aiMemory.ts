import { Router, type IRouter, type Request, type Response } from "express";
import { SaveFacilityKnowledgeBody, AppendConversationBody } from "@workspace/api-zod";
import { normalizeKnowledge } from "@workspace/ai-memory";
import { requireCapability } from "../middlewares/requireCapability";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { getOrCreateUserRole, getRole, type Capability } from "../lib/roles";
import {
  listFacilityKnowledge,
  recordFacilityKnowledge,
  listConversationTurns,
  recordConversationTurns,
} from "./aiMemoryContext";

const router: IRouter = Router();

// Shared AI memory HTTP surface. Conversation history is strictly per-user:
// every conversation route is scoped to req.userId, so a user can only ever
// see or extend their own history.
//
// The facility pool is different — it is factory-wide and gets folded into
// AI prompts (including manager-only planning tools) for every signed-in
// user, so it needs its own guardrails on top of the router-level
// requireAuth:
//   - Reading the raw pool is gated to `use-ai-tools`. No current client
//     feature needs the raw list (prompts are grounded server-side via
//     aiMemoryContext, never through this route), so this closes off bulk
//     disclosure to every low-privilege account without breaking anything.
//   - Writing stays reachable by ordinary staff accounts for the two
//     everyday features that record back into this pool (dismissing a
//     proactive alert; confirming a quality check — the latter already
//     `use-ai-tools`-gated client-side, enforced again here). Every entry
//     must also match BOTH the exact domain/key shape AND a fixed sentence
//     TEMPLATE those real features produce, with only a short bounded
//     substring left free — so this can no longer be used to persist an
//     arbitrary fabricated "incident"/"forecast"/etc. fact, or an
//     open-ended essay-length prompt-injection payload, under a plausible
//     label. (`normalizeKnowledge` additionally strips newlines/control
//     characters from every field so a single entry can't forge extra fake
//     bullet lines under a different, more-trusted domain either.)

const MAX_BATCH = 1000;

// Cost/abuse guard for the conversation-history write path. Each POST triggers
// a batch INSERT (up to 20 rows), a full SELECT of the user's window, and
// individual DELETEs to trim stale rows. Without a limiter a single account
// can saturate the Postgres connection pool. 30 requests/minute is generous
// for any real client (mobile/web only calls this path when the user finishes
// an AI exchange) while still bounding DB write amplification. In production
// the API may run with more than one instance, so the cap is backed by a
// shared Postgres store; elsewhere it falls back to in-memory.
const CONVERSATION_WRITE_RATE_WINDOW_MS = 60_000;
const CONVERSATION_WRITE_RATE_MAX = 30;
const conversationWriteRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(CONVERSATION_WRITE_RATE_WINDOW_MS)
    : undefined;

// Lighter read-side guard for GET /ai-memory/conversation: prevents a burst
// of reads from building up DB load (each is a SELECT of all rows for the
// user), and keeps the same pattern as the write path.
const CONVERSATION_READ_RATE_WINDOW_MS = 60_000;
const CONVERSATION_READ_RATE_MAX = 60;
const conversationReadRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(CONVERSATION_READ_RATE_WINDOW_MS)
    : undefined;

// Every real client call site writes exactly ONE facility-knowledge entry per
// request (a single dismissal or a single quality-check confirmation) — never a
// batch. Capping the request to exactly that (rather than MAX_BATCH) means a
// single POST can no longer be used to mint many fake rows in one shot; it
// bounds the "flood to evict" attack at the request-shape level, on top of the
// per-user rate limit below.
const MAX_FACILITY_WRITE_BATCH = 1;

// Cost/abuse guard for the facility-memory write path. Combined with
// MAX_FACILITY_WRITE_BATCH=1, this caps one low-privilege account to at most
// FACILITY_WRITE_RATE_MAX new/updated rows per window — low enough that a
// dismissal-flood attack can no longer meaningfully outpace legitimate writes
// or force large-scale pruning (MAX_FACILITY_ROWS=500 in aiMemoryContext.ts),
// even though the route itself only needs requireAuth (see
// CLIENT_WRITABLE_KNOWLEDGE above). Real usage is a handful of writes per
// session at most, so this stays generous for legitimate traffic.
const FACILITY_WRITE_RATE_WINDOW_MS = 60_000;
const FACILITY_WRITE_RATE_MAX = 5;
const facilityWriteRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(FACILITY_WRITE_RATE_WINDOW_MS)
    : undefined;

type FacilityEntryInput = { domain: string; key: string; fact: string };

// One rule per client-writable domain: the full key shape AND the full fact
// shape a client entry must match, plus an optional extra capability gate.
// Both patterns are CLOSED VOCABULARY — no unbounded free-text capture group
// of any kind (no alert title, no AI summary/notes). A real client write
// only ever carries a small enum/slug/number, so this can't be used to
// persist attacker-authored prose into the shared pool at all, not just a
// "bounded" amount of it. Keep in lockstep with every client call site that
// writes facility knowledge directly (see aiProactive.ts / InventoryTab.tsx
// quality-check confirm and their mobile mirrors) — those call sites must be
// updated in lockstep if a pattern here ever changes.
const CLIENT_WRITABLE_KNOWLEDGE: Record<
  string,
  { keyPattern: RegExp; factPattern: RegExp; requireCapability?: Capability }
> = {
  "proactive-alerts": {
    // key suffix mirrors the AI-generated alert's own slugified key
    // (lowercase a-z0-9-, capped) — see slugifyKey() in aiProactive.ts.
    keyPattern: /^dismissed:[a-z0-9-]{1,64}$/,
    factPattern: /^A manager dismissed a proactive alert \(key: [a-z0-9-]{1,64}\) around ([01]\d|2[0-3]):[0-5]\d\.$/,
  },
  quality: {
    keyPattern: /^check:(pizza|crust|other):\d{4}-\d{2}-\d{2}$/,
    factPattern:
      /^On \d{4}-\d{2}-\d{2}, a (pizza|crust|other) quality check was reviewed and confirmed as "(pass|warn|fail)" \(\d{1,3}% confidence\)\.$/,
    requireCapability: "use-ai-tools",
  },
};

function matchesWriteRule(entry: FacilityEntryInput): boolean {
  const rule = CLIENT_WRITABLE_KNOWLEDGE[entry.domain.trim().toLowerCase()];
  if (!rule) return false;
  if (!rule.keyPattern.test(entry.key.trim().toLowerCase())) return false;
  return rule.factPattern.test(entry.fact.trim());
}

// Some client-writable domains require an extra capability beyond plain
// requireAuth (quality checks are already gated client-side to
// `use-ai-tools`; re-checked here so the raw endpoint can't be used to
// bypass that). Resolves the caller's capabilities once per request.
async function requiredCapabilitiesFor(entries: FacilityEntryInput[]): Promise<Set<Capability>> {
  const caps = new Set<Capability>();
  for (const e of entries) {
    const rule = CLIENT_WRITABLE_KNOWLEDGE[e.domain.trim().toLowerCase()];
    if (rule?.requireCapability) caps.add(rule.requireCapability);
  }
  return caps;
}

router.get(
  "/ai-memory/facility",
  requireCapability("use-ai-tools"),
  async (req: Request, res: Response) => {
    try {
      const knowledge = await listFacilityKnowledge();
      res.json({ knowledge });
    } catch (err) {
      req.log.error({ err }, "failed to list facility knowledge");
      res.status(500).json({ error: "Failed to list facility knowledge" });
    }
  },
);

router.post(
  "/ai-memory/facility",
  rateLimit({
    windowMs: FACILITY_WRITE_RATE_WINDOW_MS,
    max: FACILITY_WRITE_RATE_MAX,
    keyGenerator: (req) => `ai-mem-facility-write:${req.userId ?? req.ip ?? "unknown"}`,
    store: facilityWriteRateStore,
  }),
  async (req: Request, res: Response) => {
    const parsed = SaveFacilityKnowledgeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const entries = parsed.data.knowledge.slice(0, MAX_FACILITY_WRITE_BATCH);
    if (entries.some((e) => !matchesWriteRule(e))) {
      res.status(403).json({ error: "Entry not writable via this endpoint" });
      return;
    }
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let hasFullReadAccess = false;
    try {
      const needed = await requiredCapabilitiesFor(entries);
      const { role } = await getOrCreateUserRole(userId);
      const def = await getRole(role);
      const held = new Set(def?.capabilities ?? []);
      hasFullReadAccess = held.has("use-ai-tools");
      if (needed.size > 0) {
        const missing = [...needed].filter((c) => !held.has(c));
        if (missing.length > 0) {
          res.status(403).json({ error: `Missing capability: ${missing.join(", ")}` });
          return;
        }
      }
    } catch (err) {
      req.log.error({ err }, "capability check failed");
      res.status(500).json({ error: "Capability check failed" });
      return;
    }
    try {
      const fullPool = await recordFacilityKnowledge(entries);
      // GET /ai-memory/facility is gated to `use-ai-tools` specifically so
      // ordinary staff can't bulk-read the shared pool. Returning the whole
      // pool here (as recordFacilityKnowledge does internally) would let any
      // authenticated user bypass that gate just by making one allowed write.
      // Callers without that capability only get back the (already
      // normalized/sanitized) rows they just submitted — never the rest of
      // the facility-wide pool. No current client feature reads this
      // response, so this can't break an existing UI.
      const knowledge = hasFullReadAccess ? fullPool : normalizeKnowledge(entries);
      res.json({ knowledge });
    } catch (err) {
      req.log.error({ err }, "failed to save facility knowledge");
      res.status(500).json({ error: "Failed to save facility knowledge" });
    }
  },
);

router.get(
  "/ai-memory/conversation",
  rateLimit({
    windowMs: CONVERSATION_READ_RATE_WINDOW_MS,
    max: CONVERSATION_READ_RATE_MAX,
    keyGenerator: (req) => `ai-mem-conv-read:${req.userId ?? req.ip ?? "unknown"}`,
    store: conversationReadRateStore,
  }),
  async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const turns = await listConversationTurns(userId);
      res.json({ turns });
    } catch (err) {
      req.log.error({ err }, "failed to get conversation history");
      res.status(500).json({ error: "Failed to get conversation history" });
    }
  },
);

router.post(
  "/ai-memory/conversation",
  rateLimit({
    windowMs: CONVERSATION_WRITE_RATE_WINDOW_MS,
    max: CONVERSATION_WRITE_RATE_MAX,
    keyGenerator: (req) => `ai-mem-conv-write:${req.userId ?? req.ip ?? "unknown"}`,
    store: conversationWriteRateStore,
  }),
  async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = AppendConversationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    try {
      const turns = await recordConversationTurns(userId, parsed.data.turns.slice(0, MAX_BATCH));
      res.json({ turns });
    } catch (err) {
      req.log.error({ err }, "failed to append conversation turns");
      res.status(500).json({ error: "Failed to append conversation turns" });
    }
  },
);

export default router;
