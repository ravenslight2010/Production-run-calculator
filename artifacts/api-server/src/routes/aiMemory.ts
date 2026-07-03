import { Router, type IRouter, type Request, type Response } from "express";
import { SaveFacilityKnowledgeBody, AppendConversationBody } from "@workspace/api-zod";
import { requireCapability } from "../middlewares/requireCapability";
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

router.post("/ai-memory/facility", async (req: Request, res: Response) => {
  const parsed = SaveFacilityKnowledgeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const entries = parsed.data.knowledge.slice(0, MAX_BATCH);
  if (entries.some((e) => !matchesWriteRule(e))) {
    res.status(403).json({ error: "Entry not writable via this endpoint" });
    return;
  }
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const needed = await requiredCapabilitiesFor(entries);
    if (needed.size > 0) {
      const { role } = await getOrCreateUserRole(userId);
      const def = await getRole(role);
      const held = new Set(def?.capabilities ?? []);
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
    const knowledge = await recordFacilityKnowledge(entries);
    res.json({ knowledge });
  } catch (err) {
    req.log.error({ err }, "failed to save facility knowledge");
    res.status(500).json({ error: "Failed to save facility knowledge" });
  }
});

router.get("/ai-memory/conversation", async (req: Request, res: Response) => {
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
});

router.post("/ai-memory/conversation", async (req: Request, res: Response) => {
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
});

export default router;
