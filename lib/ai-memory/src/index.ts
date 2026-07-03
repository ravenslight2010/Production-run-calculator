// Shared cross-feature "corrections memory" logic. Pure and dependency-free so
// both clients, the server, and tests use exactly the same rules.
//
// A correction is a confirmed mapping "this messy name really means that
// canonical name", tagged by `domain` (ingredient / brand / flavor / die /
// item). The whole pool is fed into every name-resolving AI prompt so a fix
// staff make in one helper is honored by all of them.

export const MAX_CORRECTION_TEXT_LEN = 200;
export const DEFAULT_PROMPT_CORRECTION_LIMIT = 200;

export interface AiCorrection {
  domain: string;
  fromText: string;
  toText: string;
}

// Case-insensitive identity for a correction: same domain + same source name.
export function correctionKey(domain: string, fromText: string): string {
  return `${domain.trim().toLowerCase()}::${fromText.trim().toLowerCase()}`;
}

// Clean an untrusted/raw batch of corrections: trim, cap length, drop blanks,
// drop self-references (a mapping that restates the same name carries no info),
// and dedupe by identity key (last write wins). Optionally bound the count.
export function normalizeCorrections(
  raw: ReadonlyArray<Partial<AiCorrection> | null | undefined> | null | undefined,
  opts: { maxLen?: number; limit?: number } = {},
): AiCorrection[] {
  const maxLen = opts.maxLen ?? MAX_CORRECTION_TEXT_LEN;
  const byKey = new Map<string, AiCorrection>();
  for (const c of raw ?? []) {
    if (!c || typeof c !== "object") continue;
    const domain = (typeof c.domain === "string" ? c.domain : "").trim().slice(0, maxLen);
    const fromText = (typeof c.fromText === "string" ? c.fromText : "").trim().slice(0, maxLen);
    const toText = (typeof c.toText === "string" ? c.toText : "").trim().slice(0, maxLen);
    if (!domain || !fromText || !toText) continue;
    if (fromText.toLowerCase() === toText.toLowerCase()) continue;
    byKey.set(correctionKey(domain, fromText), { domain, fromText, toText });
  }
  let out = [...byKey.values()];
  if (typeof opts.limit === "number" && opts.limit >= 0 && out.length > opts.limit) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

// Drop incoherent corrections before they are fed to a prompt. Within a domain,
// a name that appears BOTH as a `fromText` (a label to read AS something else)
// AND as a `toText` (a target other labels are read as) makes the mapping
// direction ambiguous — it is part of a cycle (A=>B and B=>A) or a chain (A=>B
// and B=>C). Such learned memory can't be trusted, so every correction touching
// a conflicted name is removed rather than handed to the model. This keeps
// polluted/contradictory learned corrections from silently mis-renaming and
// colliding otherwise-valid names (e.g. on spec-sheet import). Pure and
// order-preserving for the survivors.
export function dropConflictingCorrections(
  corrections: ReadonlyArray<AiCorrection>,
): AiCorrection[] {
  const dl = (s: string) => s.trim().toLowerCase();
  const froms = new Map<string, Set<string>>();
  const tos = new Map<string, Set<string>>();
  for (const c of corrections) {
    const d = dl(c.domain);
    let f = froms.get(d);
    if (!f) froms.set(d, (f = new Set()));
    f.add(dl(c.fromText));
    let t = tos.get(d);
    if (!t) tos.set(d, (t = new Set()));
    t.add(dl(c.toText));
  }
  return corrections.filter((c) => {
    const d = dl(c.domain);
    const f = froms.get(d);
    const t = tos.get(d);
    const conflicted = (name: string) => !!f && !!t && f.has(name) && t.has(name);
    return !conflicted(dl(c.fromText)) && !conflicted(dl(c.toText));
  });
}

// Keep only corrections whose domain is in the allow-list (case-insensitive).
export function filterCorrectionsByDomain(
  corrections: ReadonlyArray<AiCorrection>,
  domains: ReadonlyArray<string>,
): AiCorrection[] {
  const set = new Set(domains.map((d) => d.trim().toLowerCase()));
  return corrections.filter((c) => set.has(c.domain.trim().toLowerCase()));
}

// Render a compact prompt block from the shared pool. Returns "" when empty so
// callers can append unconditionally. `corrections` should already be in
// priority order (most useful first); only the first `limit` are included.
export function buildCorrectionsBlock(
  corrections: ReadonlyArray<AiCorrection>,
  opts: { limit?: number; heading?: string } = {},
): string {
  const limit = opts.limit ?? DEFAULT_PROMPT_CORRECTION_LIMIT;
  const list = limit >= 0 ? corrections.slice(0, limit) : [...corrections];
  if (list.length === 0) return "";
  const heading =
    opts.heading ??
    "GLOBAL KNOWN CORRECTIONS (confirmed by staff across the whole app — read " +
      "the first name as the second whenever the first appears; honor these):";
  const lines = list.map((c) => `  - [${c.domain}] "${c.fromText}" => "${c.toText}"`);
  return [heading, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Facility-wide knowledge memory
// ---------------------------------------------------------------------------
//
// Distinct from the name-corrections pool above. A facility-knowledge entry is a
// durable, plain-language operational FACT every AI feature should know — e.g. a
// recurring downtime cause, a throughput/PPM trend, a recurring incident
// cluster, or an ingredient quirk. It is the "brain" all staff and all AI
// helpers share. Each entry is tagged by `domain` (a coarse topic such as
// "downtime", "throughput", "incident", "ingredient", "general") and carries a
// stable `key` so a feature can re-record the same observation and UPDATE it in
// place instead of piling up duplicates. As with corrections, the whole (capped)
// pool is rendered into a prompt block and appended to every AI prompt.

// Knowledge facts can be a sentence or two; allow more than a bare name but keep
// it bounded so one entry can't dominate the prompt.
export const MAX_KNOWLEDGE_FACT_LEN = 600;
// Domain/key are short identifiers.
export const MAX_KNOWLEDGE_DOMAIN_LEN = 60;
export const MAX_KNOWLEDGE_KEY_LEN = 120;
// How many entries to include in a prompt block by default.
export const DEFAULT_PROMPT_KNOWLEDGE_LIMIT = 80;

export interface FacilityKnowledge {
  // Coarse topic tag (e.g. "downtime", "throughput", "incident", "general").
  domain: string;
  // Stable identity WITHIN a domain so re-recording the same observation updates
  // it rather than creating a duplicate (e.g. "oven-1-jam", "ppm-trend").
  key: string;
  // The durable observation, in plain language.
  fact: string;
}

// Case-insensitive identity for a knowledge entry: same domain + same key.
export function knowledgeKey(domain: string, key: string): string {
  return `${domain.trim().toLowerCase()}::${key.trim().toLowerCase()}`;
}

// Collapse control characters (newlines, tabs, etc.) to a single space and
// trim. `buildKnowledgeBlock` renders exactly one line per entry — without
// this, a single knowledge entry could embed newlines to forge extra fake
// "- [domain] ..." bullet lines (including under a DIFFERENT, more-trusted
// domain than the one it was actually stored under), defeating any
// domain-based write allow-list downstream. Applied to every field so domain
// and key can't be used for the same trick either.
function sanitizeKnowledgeText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

// Clean an untrusted/raw batch of knowledge entries: sanitize control chars,
// trim, cap length, drop blanks, and dedupe by identity key (last write
// wins). Optionally bound the count. Mirrors normalizeCorrections so every
// caller shares identical rules.
export function normalizeKnowledge(
  raw: ReadonlyArray<Partial<FacilityKnowledge> | null | undefined> | null | undefined,
  opts: { factMaxLen?: number; domainMaxLen?: number; keyMaxLen?: number; limit?: number } = {},
): FacilityKnowledge[] {
  const factMax = opts.factMaxLen ?? MAX_KNOWLEDGE_FACT_LEN;
  const domainMax = opts.domainMaxLen ?? MAX_KNOWLEDGE_DOMAIN_LEN;
  const keyMax = opts.keyMaxLen ?? MAX_KNOWLEDGE_KEY_LEN;
  const byKey = new Map<string, FacilityKnowledge>();
  for (const e of raw ?? []) {
    if (!e || typeof e !== "object") continue;
    const domain = sanitizeKnowledgeText(typeof e.domain === "string" ? e.domain : "").slice(
      0,
      domainMax,
    );
    const key = sanitizeKnowledgeText(typeof e.key === "string" ? e.key : "").slice(0, keyMax);
    const fact = sanitizeKnowledgeText(typeof e.fact === "string" ? e.fact : "").slice(
      0,
      factMax,
    );
    if (!domain || !key || !fact) continue;
    byKey.set(knowledgeKey(domain, key), { domain, key, fact });
  }
  let out = [...byKey.values()];
  if (typeof opts.limit === "number" && opts.limit >= 0 && out.length > opts.limit) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

// Keep only knowledge whose domain is in the allow-list (case-insensitive).
// Useful when a helper only wants operationally-relevant topics.
export function filterKnowledgeByDomain(
  knowledge: ReadonlyArray<FacilityKnowledge>,
  domains: ReadonlyArray<string>,
): FacilityKnowledge[] {
  const set = new Set(domains.map((d) => d.trim().toLowerCase()));
  return knowledge.filter((e) => set.has(e.domain.trim().toLowerCase()));
}

// Render a compact prompt block from the shared knowledge pool. Returns "" when
// empty so callers can append unconditionally. `knowledge` should already be in
// priority order (most useful first); only the first `limit` are included.
export function buildKnowledgeBlock(
  knowledge: ReadonlyArray<FacilityKnowledge>,
  opts: { limit?: number; heading?: string } = {},
): string {
  const limit = opts.limit ?? DEFAULT_PROMPT_KNOWLEDGE_LIMIT;
  const list = limit >= 0 ? knowledge.slice(0, limit) : [...knowledge];
  if (list.length === 0) return "";
  const heading =
    opts.heading ??
    "FACILITY MEMORY (durable operational facts the whole team and every AI " +
      "feature have learned over time — treat these as known background and " +
      "factor them into your answer; do not contradict them without clear new " +
      "evidence):";
  const lines = list.map((e) => `  - [${e.domain}] ${e.fact}`);
  return [heading, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Per-user conversation memory
// ---------------------------------------------------------------------------
//
// Unlike the two factory-wide pools above, conversation memory is PER USER: a
// rolling, capped log of a single person's recent AI turns so their follow-up
// questions keep context for them only. Each turn is one message, either from
// the user or the assistant. Helpers keep only the most recent N turns (the
// window) and render them oldest-first as a short history block a conversational
// prompt can prepend.

export type ConversationRole = "user" | "assistant";

export const MAX_TURN_TEXT_LEN = 4000;
// How many turns to retain per user (rolling window). One Q + one A = 2 turns,
// so this keeps roughly the last ~10 exchanges.
export const DEFAULT_CONVERSATION_WINDOW = 20;
// How many of the retained turns to include in a prompt by default.
export const DEFAULT_PROMPT_HISTORY_LIMIT = 12;

export interface ConversationTurn {
  role: ConversationRole;
  text: string;
}

function coerceRole(raw: unknown): ConversationRole {
  return (typeof raw === "string" ? raw : "").trim().toLowerCase() === "assistant"
    ? "assistant"
    : "user";
}

// Clean an untrusted/raw batch of turns: coerce role, trim, cap length, drop
// blanks. Order is PRESERVED (turns are a sequence, never deduped). Unlike the
// pools above this keeps the LAST `window` entries, since a conversation cares
// about its most recent turns.
export function normalizeConversationTurns(
  raw: ReadonlyArray<{ role?: unknown; text?: unknown } | null | undefined> | null | undefined,
  opts: { maxLen?: number; window?: number } = {},
): ConversationTurn[] {
  const maxLen = opts.maxLen ?? MAX_TURN_TEXT_LEN;
  const out: ConversationTurn[] = [];
  for (const t of raw ?? []) {
    if (!t || typeof t !== "object") continue;
    const text = (typeof t.text === "string" ? t.text : "").trim().slice(0, maxLen);
    if (!text) continue;
    out.push({ role: coerceRole(t.role), text });
  }
  return trimConversationWindow(out, opts.window);
}

// Keep only the most recent `window` turns (the tail). A non-positive or
// undefined window means "no cap" — return the list unchanged.
export function trimConversationWindow(
  turns: ReadonlyArray<ConversationTurn>,
  window: number | undefined = DEFAULT_CONVERSATION_WINDOW,
): ConversationTurn[] {
  if (typeof window !== "number" || window <= 0 || turns.length <= window) {
    return [...turns];
  }
  return turns.slice(turns.length - window);
}

// Render a compact history block from a user's recent turns, oldest first.
// Returns "" when empty so callers can prepend unconditionally. Only the last
// `limit` turns are included (the most recent context matters most).
export function buildConversationBlock(
  turns: ReadonlyArray<ConversationTurn>,
  opts: { limit?: number; heading?: string } = {},
): string {
  const limit = opts.limit ?? DEFAULT_PROMPT_HISTORY_LIMIT;
  const list =
    typeof limit === "number" && limit >= 0 && turns.length > limit
      ? turns.slice(turns.length - limit)
      : [...turns];
  if (list.length === 0) return "";
  const heading =
    opts.heading ??
    "RECENT CONVERSATION (this user's earlier turns with the assistant, oldest " +
      "first — use them to keep context for follow-up questions):";
  const lines = list.map((t) => `  ${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`);
  return [heading, ...lines].join("\n");
}
