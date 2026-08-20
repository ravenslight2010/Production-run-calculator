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

// Collapse multi-hop correction chains and remove cycles so the pool stays
// consistent without manual manager intervention.
//
// Given a pool for one domain:
//   A→B + B→C  (chain)  → becomes  A→C + B→C  (B→C unchanged; A now points to
//                                    the terminal so B no longer straddles both
//                                    sides and dropConflictingCorrections passes)
//   A→B + B→A  (cycle)  → both deleted (no valid unambiguous correction exists)
//
// Works per-domain. Returns the collapsed pool — the caller is responsible for
// persisting the diff (updating changed entries, deleting removed ones). Pure
// and side-effect-free.
export function collapseChains(corrections: ReadonlyArray<AiCorrection>): AiCorrection[] {
  const dl = (s: string) => s.trim().toLowerCase();

  // Group by domain (lowercase key).
  const byDomain = new Map<string, AiCorrection[]>();
  for (const c of corrections) {
    const d = dl(c.domain);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(c);
  }

  const result: AiCorrection[] = [];

  for (const entries of byDomain.values()) {
    // Map: lowercase fromText → correction (last write per key wins, mirrors
    // normalizeCorrections dedup).
    const fromMap = new Map<string, AiCorrection>();
    for (const c of entries) {
      fromMap.set(dl(c.fromText), c);
    }

    // ---- Cycle detection via iterative DFS ----
    // Track which lowercase names participate in a cycle so we can drop them.
    const inCycle = new Set<string>();
    const globalVisited = new Set<string>();

    for (const startNode of fromMap.keys()) {
      if (globalVisited.has(startNode)) continue;

      const path: string[] = [];
      const onPath = new Set<string>();
      let node = startNode;

      while (true) {
        if (onPath.has(node)) {
          // Cycle: mark every node from where the cycle begins back to `node`.
          const cycleStart = path.lastIndexOf(node);
          for (let i = cycleStart; i < path.length; i++) inCycle.add(path[i]);
          break;
        }
        if (globalVisited.has(node) || !fromMap.has(node)) break;
        path.push(node);
        onPath.add(node);
        node = dl(fromMap.get(node)!.toText);
      }
      for (const n of path) globalVisited.add(n);
    }

    // ---- Resolve each non-cycle entry to its chain terminal ----
    for (const c of entries) {
      const fromLower = dl(c.fromText);
      if (inCycle.has(fromLower)) continue; // part of a cycle → drop

      // Follow the chain until we reach a terminal (not a fromText key) or a
      // cycle entry. Guard against infinite loops with a visited set.
      let terminalToText = c.toText;
      let curLower = dl(c.toText);
      const seen = new Set<string>([fromLower]);

      while (fromMap.has(curLower) && !inCycle.has(curLower) && !seen.has(curLower)) {
        seen.add(curLower);
        const next = fromMap.get(curLower)!;
        terminalToText = next.toText;
        curLower = dl(next.toText);
      }

      if (dl(terminalToText) === dl(c.toText)) {
        // Already pointing to the terminal — no change.
        result.push(c);
      } else {
        // Intermediate hop: rewrite to point directly to the terminal.
        result.push({ domain: c.domain, fromText: c.fromText, toText: terminalToText });
      }
    }
  }

  return result;
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

// ---------------------------------------------------------------------------
// Manager-facing AI memory health check
// ---------------------------------------------------------------------------
//
// This is intentionally pure: the API reads the current rows and canonical
// master-data records, calls this analysis for a preview, then re-runs it inside
// its repair transaction. Keeping the judgement here makes it testable and,
// importantly, prevents a UI from inventing its own destructive rules.

export type CorrectionHealthStatus =
  | "healthy"
  | "duplicate"
  | "covered-by-merge"
  | "outdated-target"
  | "chain"
  | "cycle"
  | "orphaned"
  | "needs-review";

export type FacilityKnowledgeHealthStatus =
  | "exact-duplicate"
  | "stale-source-reference"
  | "superseded-name-reference"
  | "needs-review";

export type SafeCorrectionRepair =
  | {
      action: "delete";
      correctionId: number;
      reason: "duplicate" | "cycle";
      before: AiCorrection;
    }
  | {
      action: "retarget";
      correctionId: number;
      reason: "outdated-target" | "chain";
      before: AiCorrection;
      after: AiCorrection;
    };

export interface AiCorrectionAuditRow extends AiCorrection {
  id: number;
}

export interface FacilityKnowledgeAuditRow extends FacilityKnowledge {
  id: number;
  source?: string | null;
}

export interface CanonicalNameAlias extends AiCorrection {
  // The source is displayed as evidence only. It never changes the analysis
  // result, and it is deliberately broad so legacy import/merge sources can be
  // identified without coupling this library to database tables.
  source?: string;
}

export interface CorrectionHealthFinding {
  entry: AiCorrectionAuditRow;
  status: CorrectionHealthStatus;
  evidence: string[];
  safeRepair?: SafeCorrectionRepair;
}

export interface FacilityKnowledgeHealthFinding {
  entry: FacilityKnowledgeAuditRow;
  status: FacilityKnowledgeHealthStatus;
  evidence: string[];
}

export interface AiMemoryHealthReport {
  correctionFindings: CorrectionHealthFinding[];
  facilityKnowledgeFindings: FacilityKnowledgeHealthFinding[];
  safeRepairs: SafeCorrectionRepair[];
  summary: Record<CorrectionHealthStatus | FacilityKnowledgeHealthStatus, number>;
  conversationHistoryExcluded: true;
}

export interface AiMemoryHealthInput {
  corrections: ReadonlyArray<AiCorrectionAuditRow>;
  facilityKnowledge: ReadonlyArray<FacilityKnowledgeAuditRow>;
  canonicalAliases: ReadonlyArray<CanonicalNameAlias>;
  activeNamesByDomain: Readonly<Record<string, ReadonlyArray<string>>>;
  // Names that were deliberately merged away but do not carry a target in the
  // legacy tombstone record. Their absence from current menus must never cause a
  // historical correction to be deleted.
  mergedAwayNames?: ReadonlyArray<string>;
  // Facility source values currently emitted by live features. An unknown source
  // is review-only; it is never a deletion candidate.
  knownFacilitySources?: ReadonlyArray<string>;
}

function healthTextKey(raw: string): string {
  return raw.trim().toLocaleLowerCase();
}

function healthAliasKey(domain: string, fromText: string): string {
  return `${healthTextKey(domain)}::${healthTextKey(fromText)}`;
}

function terminalFor(
  start: string,
  aliases: Map<string, CanonicalNameAlias>,
): CanonicalNameAlias | undefined {
  let current = start;
  let last: CanonicalNameAlias | undefined;
  const seen = new Set<string>();
  while (!seen.has(healthTextKey(current))) {
    seen.add(healthTextKey(current));
    const next = aliases.get(healthTextKey(current));
    if (!next) return last;
    last = next;
    current = next.toText;
  }
  return undefined;
}

function cycleEntryIds(corrections: ReadonlyArray<AiCorrectionAuditRow>): Set<number> {
  const byDomain = new Map<string, AiCorrectionAuditRow[]>();
  for (const entry of corrections) {
    const domain = healthTextKey(entry.domain);
    const group = byDomain.get(domain) ?? [];
    group.push(entry);
    byDomain.set(domain, group);
  }

  const inCycle = new Set<number>();
  for (const group of byDomain.values()) {
    // A duplicate source cannot form one unambiguous graph edge. Leave it to the
    // duplicate rule, which safely keeps the first stored row.
    const byFrom = new Map<string, AiCorrectionAuditRow>();
    for (const entry of group) {
      const key = healthTextKey(entry.fromText);
      if (!byFrom.has(key)) byFrom.set(key, entry);
    }
    for (const start of byFrom.keys()) {
      const path: string[] = [];
      const onPath = new Set<string>();
      let node = start;
      while (byFrom.has(node) && !onPath.has(node)) {
        path.push(node);
        onPath.add(node);
        node = healthTextKey(byFrom.get(node)!.toText);
      }
      if (!onPath.has(node)) continue;
      const cycleAt = path.lastIndexOf(node);
      for (const name of path.slice(cycleAt)) {
        inCycle.add(byFrom.get(name)!.id);
      }
    }
  }
  return inCycle;
}

function containsNameReference(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use word boundaries for ordinary labels, but retain a lower-risk substring
  // match for names that are entirely punctuation or other non-word characters.
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(text);
}

// Analyze correction and facility-knowledge rows without writing anything.
// `safeRepairs` intentionally contains corrections only: natural language facts
// can be duplicated or refer to stale labels, but their meaning needs a human.
export function auditAiMemory(input: AiMemoryHealthInput): AiMemoryHealthReport {
  const canonicalByDomain = new Map<string, Map<string, CanonicalNameAlias>>();
  const ambiguousCanonicalKeys = new Set<string>();
  for (const alias of input.canonicalAliases) {
    const domain = healthTextKey(alias.domain);
    const from = healthTextKey(alias.fromText);
    const key = healthAliasKey(domain, from);
    let byFrom = canonicalByDomain.get(domain);
    if (!byFrom) canonicalByDomain.set(domain, (byFrom = new Map()));
    const existing = byFrom.get(from);
    if (existing && healthTextKey(existing.toText) !== healthTextKey(alias.toText)) {
      ambiguousCanonicalKeys.add(key);
    } else if (!existing) {
      byFrom.set(from, alias);
    }
  }

  const activeByDomain = new Map<string, Set<string>>();
  for (const [domain, names] of Object.entries(input.activeNamesByDomain)) {
    activeByDomain.set(healthTextKey(domain), new Set(names.map(healthTextKey)));
  }
  const mergedAway = new Set((input.mergedAwayNames ?? []).map(healthTextKey));

  const duplicateIds = new Set<number>();
  const seenExact = new Set<string>();
  for (const entry of input.corrections) {
    const exact = `${healthAliasKey(entry.domain, entry.fromText)}::${healthTextKey(entry.toText)}`;
    if (seenExact.has(exact)) duplicateIds.add(entry.id);
    else seenExact.add(exact);
  }
  const cycles = cycleEntryIds(input.corrections);
  const correctionsByDomainFrom = new Map<string, AiCorrectionAuditRow>();
  for (const entry of input.corrections) {
    const key = healthAliasKey(entry.domain, entry.fromText);
    if (!correctionsByDomainFrom.has(key)) correctionsByDomainFrom.set(key, entry);
  }

  const correctionFindings: CorrectionHealthFinding[] = [];
  const safeRepairs: SafeCorrectionRepair[] = [];
  for (const entry of input.corrections) {
    const domain = healthTextKey(entry.domain);
    const fromKey = healthAliasKey(domain, entry.fromText);
    const aliases = canonicalByDomain.get(domain) ?? new Map<string, CanonicalNameAlias>();
    const canonical = !ambiguousCanonicalKeys.has(fromKey)
      ? terminalFor(entry.fromText, aliases)
      : undefined;
    const targetCanonical = !ambiguousCanonicalKeys.has(healthAliasKey(domain, entry.toText))
      ? terminalFor(entry.toText, aliases)
      : undefined;
    const directNext = correctionsByDomainFrom.get(healthAliasKey(domain, entry.toText));
    const active = activeByDomain.get(domain);
    const targetIsActive = !!active?.has(healthTextKey(entry.toText));
    const isHistoricMergedSource =
      (domain === "ingredient" || domain === "die") && mergedAway.has(healthTextKey(entry.fromText));

    let finding: CorrectionHealthFinding;
    if (duplicateIds.has(entry.id)) {
      const safeRepair: SafeCorrectionRepair = {
        action: "delete",
        correctionId: entry.id,
        reason: "duplicate",
        before: entry,
      };
      finding = {
        entry,
        status: "duplicate",
        evidence: ["An earlier row has the same domain, source, and target."],
        safeRepair,
      };
    } else if (cycles.has(entry.id)) {
      const safeRepair: SafeCorrectionRepair = {
        action: "delete",
        correctionId: entry.id,
        reason: "cycle",
        before: entry,
      };
      finding = {
        entry,
        status: "cycle",
        evidence: ["The source/target graph returns to this name, so the correction is ambiguous."],
        safeRepair,
      };
    } else if (canonical && healthTextKey(canonical.toText) !== healthTextKey(entry.toText)) {
      const after = { ...entry, toText: canonical.toText };
      const safeRepair: SafeCorrectionRepair = {
        action: "retarget",
        correctionId: entry.id,
        reason: "outdated-target",
        before: entry,
        after,
      };
      finding = {
        entry,
        status: "outdated-target",
        evidence: [
          `Canonical ${canonical.source ?? "merge"} record maps "${entry.fromText}" to "${canonical.toText}".`,
        ],
        safeRepair,
      };
    } else if (
      directNext &&
      healthTextKey(directNext.toText) !== healthTextKey(entry.fromText) &&
      healthTextKey(directNext.toText) !== healthTextKey(entry.toText)
    ) {
      const after = { ...entry, toText: directNext.toText };
      const safeRepair: SafeCorrectionRepair = {
        action: "retarget",
        correctionId: entry.id,
        reason: "chain",
        before: entry,
        after,
      };
      finding = {
        entry,
        status: "chain",
        evidence: [`"${entry.toText}" is also corrected to "${directNext.toText}".`],
        safeRepair,
      };
    } else if (targetCanonical && healthTextKey(targetCanonical.toText) !== healthTextKey(entry.toText)) {
      const after = { ...entry, toText: targetCanonical.toText };
      const safeRepair: SafeCorrectionRepair = {
        action: "retarget",
        correctionId: entry.id,
        reason: "outdated-target",
        before: entry,
        after,
      };
      finding = {
        entry,
        status: "outdated-target",
        evidence: [
          `The target "${entry.toText}" was subsequently merged into "${targetCanonical.toText}".`,
        ],
        safeRepair,
      };
    } else if (canonical) {
      finding = {
        entry,
        status: "covered-by-merge",
        evidence: [
          `Canonical ${canonical.source ?? "merge"} record already confirms this mapping.`,
        ],
      };
    } else if (targetIsActive || isHistoricMergedSource) {
      finding = {
        entry,
        status: "healthy",
        evidence: isHistoricMergedSource
          ? ["The source is a preserved merged-away label; historical aliases are retained."]
          : ["The target is active master data."],
      };
    } else if (active?.size) {
      finding = {
        entry,
        status: "orphaned",
        evidence: [
          `The target "${entry.toText}" is not active in the matching master-data domain.`,
          "Historical sources are retained; this entry needs manager review.",
        ],
      };
    } else {
      finding = {
        entry,
        status: "needs-review",
        evidence: ["No authoritative active-name set exists for this correction domain."],
      };
    }
    correctionFindings.push(finding);
    if (finding.safeRepair) safeRepairs.push(finding.safeRepair);
  }

  const knownSources = new Set((input.knownFacilitySources ?? []).map(healthTextKey));
  const factFirstSeen = new Map<string, number>();
  const factKey = (entry: FacilityKnowledgeAuditRow) =>
    `${healthTextKey(entry.domain)}::${healthTextKey(entry.fact).replace(/\s+/g, " ")}`;
  const allAliases = [...canonicalByDomain.values()].flatMap((items) => [...items.values()]);
  const facilityKnowledgeFindings = input.facilityKnowledge.map((entry) => {
    const duplicate = factFirstSeen.has(factKey(entry));
    if (!duplicate) factFirstSeen.set(factKey(entry), entry.id);
    const text = `${entry.key} ${entry.fact} ${entry.source ?? ""}`;
    const replaced = allAliases.find(
      (alias) =>
        healthTextKey(alias.fromText) !== healthTextKey(alias.toText) &&
        containsNameReference(text, alias.fromText),
    );
    const staleSource =
      !!entry.source?.trim() && knownSources.size > 0 && !knownSources.has(healthTextKey(entry.source));
    if (duplicate) {
      return {
        entry,
        status: "exact-duplicate" as const,
        evidence: [`Matches facility fact row ${factFirstSeen.get(factKey(entry))}. Review before removing either fact.`],
      };
    }
    if (replaced) {
      return {
        entry,
        status: "superseded-name-reference" as const,
        evidence: [
          `References "${replaced.fromText}", which a confirmed merge maps to "${replaced.toText}".`,
          "Natural-language facts are never changed automatically.",
        ],
      };
    }
    if (staleSource) {
      return {
        entry,
        status: "stale-source-reference" as const,
        evidence: [
          `The source "${entry.source}" is not emitted by a current facility-memory feature.`,
          "Natural-language facts are never changed automatically.",
        ],
      };
    }
    return {
      entry,
      status: "needs-review" as const,
      evidence: ["Natural-language facility knowledge requires manager judgement."],
    };
  });

  const summary = Object.create(null) as AiMemoryHealthReport["summary"];
  for (const finding of correctionFindings) summary[finding.status] = (summary[finding.status] ?? 0) + 1;
  for (const finding of facilityKnowledgeFindings) {
    summary[finding.status] = (summary[finding.status] ?? 0) + 1;
  }
  return {
    correctionFindings,
    facilityKnowledgeFindings,
    safeRepairs,
    summary,
    conversationHistoryExcluded: true,
  };
}
