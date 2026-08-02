import { and, asc, desc, eq } from "drizzle-orm";
import { db, facilityKnowledgeTable, aiConversationTurnsTable } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import {
  buildKnowledgeBlock,
  buildConversationBlock,
  filterKnowledgeByDomain,
  normalizeKnowledge,
  normalizeConversationTurns,
  DEFAULT_CONVERSATION_WINDOW,
  type ConversationTurn,
  type FacilityKnowledge,
} from "@workspace/ai-memory";
import { INCIDENT_MEMORY_DOMAIN } from "./incidentsAi";
import { loadCorrections, appendCorrectionsBlock } from "./aiCorrectionsContext";

// Shared AI-memory context builder — the single seam every AI prompt uses to get
// grounded by what the facility (and, in a conversation, the user) has learned.
//
// Two pools, both read-only here:
//   1. facility_knowledge — durable, factory-wide operational facts.
//   2. ai_conversation_turns — a single user's recent AI turns.
//
// FAIL-SAFE, exactly like aiCorrectionsContext: any DB error yields an empty
// list and the prompt is built without the memory block. The helper still works,
// it just doesn't get the extra hints — a memory outage never breaks an AI call.

type ContextLogger = {
  error: (obj: unknown, msg?: string) => void;
};

// Load the whole facility-knowledge pool, most-recently-updated first so the
// freshest facts win the prompt budget.
export async function loadFacilityKnowledge(log: ContextLogger): Promise<FacilityKnowledge[]> {
  try {
    const rows = await db
      .select()
      .from(facilityKnowledgeTable)
      .where(eq(facilityKnowledgeTable.scope, currentScope()))
      .orderBy(desc(facilityKnowledgeTable.updatedAt));
    return normalizeKnowledge(
      rows.map((r) => ({ domain: r.domain, key: r.key, fact: r.fact })),
    );
  } catch (err) {
    log.error({ err }, "failed to load facility knowledge for prompt");
    return [];
  }
}

// Domains that carry free-text authored by ANY signed-in user (not reviewed or
// confirmed by a manager) rather than a fixed, closed-vocabulary observation.
// `buildKnowledgeBlock` tells the model to treat every entry as a trusted,
// durable operational fact and "factor it into your answer" — so a domain
// whose fact string embeds a reporter's own words must never be folded into
// that trusted, general-purpose block for OTHER features. The incidents
// domain (`buildIncidentMemoryFact` embeds up to 200 chars of the reporter's
// error message/description verbatim) is the only such domain today; a
// low-privilege user could otherwise use a crash/issue report to plant
// prompt-injection-style text into every other AI feature's grounding.
// Incidents.ts already surfaces the same information appropriately — scoped,
// ranked, and explicitly framed as "similar past reports" rather than
// confirmed fact — via appendIncidentHistoryBlock, so no functionality is
// lost by excluding it here.
const UNTRUSTED_FREEFORM_DOMAINS = new Set([INCIDENT_MEMORY_DOMAIN]);

// Domains that hold data the raw REST surface (GET /ai-memory/facility)
// deliberately gates behind the `use-ai-tools` capability — forecast plans
// (aggregated demand/production predictions) and proactive-alert trigger
// history. Several AI-prompt routes are intentionally open to EVERY signed-in
// user (ask-the-day chat, end-of-day summary, anomaly narration — informational
// features every floor worker should get), but they all load the WHOLE
// facility-knowledge pool to ground their prompt. Without this exclusion, an
// ordinary staff account with no `use-ai-tools` capability could recover the
// privileged pool's contents indirectly by asking the model to repeat what it
// was told, defeating the REST endpoint's gate. Routes that already require
// `use-ai-tools` (optimize, proactive-alert, forecast, schedule-optimize, etc.)
// pass `allowPrivileged: true` to keep seeing this data — that's unchanged
// behavior for the audience the raw endpoint already trusts.
const PRIVILEGED_FACILITY_DOMAINS = new Set(["forecast", "proactive-alerts"]);

function excludeUntrustedFreeformDomains(
  knowledge: FacilityKnowledge[],
): FacilityKnowledge[] {
  return knowledge.filter((k) => !UNTRUSTED_FREEFORM_DOMAINS.has(k.domain.trim().toLowerCase()));
}

function excludePrivilegedDomains(knowledge: FacilityKnowledge[]): FacilityKnowledge[] {
  return knowledge.filter((k) => !PRIVILEGED_FACILITY_DOMAINS.has(k.domain.trim().toLowerCase()));
}

// Append the facility-memory block to a built user prompt. When `domains` is
// given, only those topics are included (this is an explicit opt-in, so it MAY
// include an otherwise-untrusted domain, e.g. incidents.ts building its own
// scoped block); otherwise the whole pool minus UNTRUSTED_FREEFORM_DOMAINS is
// used. `allowPrivileged` (default true, to preserve existing behavior for
// every current call site) gates PRIVILEGED_FACILITY_DOMAINS in that
// whole-pool fallback path — pass `false` for a route reachable by users who
// lack `use-ai-tools`, so it can't be used to exfiltrate the privileged pool.
// When nothing applies the prompt is returned unchanged.
export function appendFacilityMemoryBlock(
  userPrompt: string,
  knowledge: FacilityKnowledge[],
  domains?: string[],
  allowPrivileged: boolean = true,
): string {
  let scoped =
    domains && domains.length > 0
      ? filterKnowledgeByDomain(knowledge, domains)
      : excludeUntrustedFreeformDomains(knowledge);
  if (!domains?.length && !allowPrivileged) {
    scoped = excludePrivilegedDomains(scoped);
  }
  const block = buildKnowledgeBlock(scoped);
  return block ? `${userPrompt}\n\n${block}` : userPrompt;
}

// Load a single user's most recent conversation turns, oldest first (ready to
// render). `limit` caps how many are returned (defaults to the rolling window).
export async function loadConversationTurns(
  log: ContextLogger,
  userId: string,
  limit: number = DEFAULT_CONVERSATION_WINDOW,
): Promise<ConversationTurn[]> {
  if (!userId) return [];
  try {
    // Pull the newest `limit` rows, then flip to oldest-first for rendering.
    const rows = await db
      .select()
      .from(aiConversationTurnsTable)
      .where(eq(aiConversationTurnsTable.userId, userId))
      .orderBy(desc(aiConversationTurnsTable.createdAt), desc(aiConversationTurnsTable.id))
      .limit(Math.max(0, limit));
    const oldestFirst = rows.reverse();
    return normalizeConversationTurns(
      oldestFirst.map((r) => ({ role: r.role, text: r.content })),
      { window: limit },
    );
  } catch (err) {
    log.error({ err }, "failed to load conversation turns for prompt");
    return [];
  }
}

// Prepend the user's recent-conversation block to a built prompt. When the user
// has no history the prompt is returned unchanged.
export function appendConversationBlock(
  userPrompt: string,
  turns: ConversationTurn[],
): string {
  const block = buildConversationBlock(turns);
  return block ? `${userPrompt}\n\n${block}` : userPrompt;
}

// Convenience: load all context pools and ground a prompt in one call — the
// "one shared context builder" every AI feature can lean on.
//
// Order: facility memory → corrections → conversation history (most recent last
// so the model sees the freshest signal closest to the query).
//
// Facility memory is always appended. Corrections (factory-wide confirmed
// name equivalences — merges, renames) are appended by default so every AI
// feature automatically knows "Old Name" = "New Name"; pass
// `correctionDomains: false` for the rare intentionally un-grounded route that
// must not receive this context, or a string array to restrict to those domains.
// Conversation history is only appended when a userId is supplied (conversational
// features). Fully fail-safe via the individual loaders above.
export async function groundPromptWithMemory(
  log: ContextLogger,
  userPrompt: string,
  opts: {
    facilityDomains?: string[];
    userId?: string;
    conversationLimit?: number;
    allowPrivilegedFacilityDomains?: boolean;
    // Corrections to include in the grounded prompt:
    //   undefined (default) = all domains — every confirmed merge/rename
    //   string[]            = only those domains (targeted import/match AIs)
    //   false               = skip corrections (intentionally un-grounded route)
    correctionDomains?: string[] | false;
  } = {},
): Promise<string> {
  const knowledge = await loadFacilityKnowledge(log);
  let grounded = appendFacilityMemoryBlock(
    userPrompt,
    knowledge,
    opts.facilityDomains,
    opts.allowPrivilegedFacilityDomains ?? true,
  );
  if (opts.correctionDomains !== false) {
    const corrections = await loadCorrections(log);
    grounded = appendCorrectionsBlock(grounded, corrections, opts.correctionDomains);
  }
  if (opts.userId) {
    const turns = await loadConversationTurns(log, opts.userId, opts.conversationLimit);
    grounded = appendConversationBlock(grounded, turns);
  }
  return grounded;
}

// ---------------------------------------------------------------------------
// Write side — the single shared write path AI features use to record back into
// memory. Best-effort: callers may await for the returned state, but a write
// failure should never crash the feature that triggered it.
// ---------------------------------------------------------------------------

// Hard cap on total facility rows so the pool (and every prompt built from it)
// stays bounded no matter how many features record observations. When exceeded,
// the oldest-updated rows are pruned.
export const MAX_FACILITY_ROWS = 500;

// Upsert a batch of facility-knowledge facts (case-insensitive match on
// domain + key, last write wins), then prune to MAX_FACILITY_ROWS. Returns the
// full updated pool.
export async function recordFacilityKnowledge(
  entries: Array<{ domain: string; key: string; fact: string; source?: string | null }>,
): Promise<FacilityKnowledge[]> {
  const normalized = normalizeKnowledge(entries);
  // Preserve the optional source tag, which normalizeKnowledge drops.
  const sourceByKey = new Map<string, string | null>();
  for (const e of entries) {
    const domain = (e.domain ?? "").trim().toLowerCase();
    const key = (e.key ?? "").trim().toLowerCase();
    if (domain && key) sourceByKey.set(`${domain}::${key}`, e.source ?? null);
  }

  if (normalized.length > 0) {
    for (const e of normalized) {
      const source = sourceByKey.get(`${e.domain.toLowerCase()}::${e.key.toLowerCase()}`) ?? null;
      const [existing] = await db
        .select()
        .from(facilityKnowledgeTable)
        .where(
          and(
            eq(facilityKnowledgeTable.domain, e.domain),
            eq(facilityKnowledgeTable.key, e.key),
            eq(facilityKnowledgeTable.scope, currentScope()),
          ),
        );
      if (existing) {
        await db
          .update(facilityKnowledgeTable)
          .set({ fact: e.fact, source, updatedAt: new Date() })
          .where(eq(facilityKnowledgeTable.id, existing.id));
      } else {
        await db
          .insert(facilityKnowledgeTable)
          .values({ domain: e.domain, key: e.key, fact: e.fact, source, scope: currentScope() });
      }
    }
    await pruneFacilityKnowledge();
  }

  return listFacilityKnowledge();
}

// Return the whole pool as API shape, most-recently-updated first.
export async function listFacilityKnowledge(): Promise<FacilityKnowledge[]> {
  const rows = await db
    .select()
    .from(facilityKnowledgeTable)
    .where(eq(facilityKnowledgeTable.scope, currentScope()))
    .orderBy(desc(facilityKnowledgeTable.updatedAt));
  return rows.map((r) => ({ domain: r.domain, key: r.key, fact: r.fact }));
}

async function pruneFacilityKnowledge(): Promise<void> {
  const ids = await db
    .select({ id: facilityKnowledgeTable.id })
    .from(facilityKnowledgeTable)
    .where(eq(facilityKnowledgeTable.scope, currentScope()))
    .orderBy(desc(facilityKnowledgeTable.updatedAt), desc(facilityKnowledgeTable.id));
  if (ids.length <= MAX_FACILITY_ROWS) return;
  const stale = ids.slice(MAX_FACILITY_ROWS).map((r) => r.id);
  for (const id of stale) {
    await db.delete(facilityKnowledgeTable).where(eq(facilityKnowledgeTable.id, id));
  }
}

// Append a batch of turns for one user, then trim that user's log to the rolling
// window so it never grows without bound. Returns the user's recent turns
// (oldest first) after the trim.
export async function recordConversationTurns(
  userId: string,
  turns: Array<{ role: string; text: string }>,
  window: number = DEFAULT_CONVERSATION_WINDOW,
): Promise<ConversationTurn[]> {
  if (!userId) return [];
  const normalized = normalizeConversationTurns(turns, { window });
  if (normalized.length > 0) {
    await db
      .insert(aiConversationTurnsTable)
      .values(normalized.map((t) => ({ userId, role: t.role, content: t.text })));
    await trimUserConversation(userId, window);
  }
  return listConversationTurns(userId, window);
}

// Return a user's recent turns, oldest first.
export async function listConversationTurns(
  userId: string,
  limit: number = DEFAULT_CONVERSATION_WINDOW,
): Promise<ConversationTurn[]> {
  const rows = await db
    .select()
    .from(aiConversationTurnsTable)
    .where(eq(aiConversationTurnsTable.userId, userId))
    .orderBy(asc(aiConversationTurnsTable.createdAt), asc(aiConversationTurnsTable.id));
  const mapped = rows.map((r) => ({ role: r.role, text: r.content }));
  return normalizeConversationTurns(mapped, { window: limit });
}

async function trimUserConversation(userId: string, window: number): Promise<void> {
  if (window <= 0) return;
  const ids = await db
    .select({ id: aiConversationTurnsTable.id })
    .from(aiConversationTurnsTable)
    .where(eq(aiConversationTurnsTable.userId, userId))
    .orderBy(desc(aiConversationTurnsTable.createdAt), desc(aiConversationTurnsTable.id));
  if (ids.length <= window) return;
  const stale = ids.slice(window).map((r) => r.id);
  for (const id of stale) {
    await db.delete(aiConversationTurnsTable).where(eq(aiConversationTurnsTable.id, id));
  }
}
