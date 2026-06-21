import { ReportIncidentBody } from "@workspace/api-zod";
import * as z from "zod";
import type { FacilityKnowledge } from "@workspace/ai-memory";
import { filterKnowledgeByDomain } from "@workspace/ai-memory";
import type { IncidentContext, IncidentRecurrence, IncidentSource } from "../lib/incidents";

// Bound how much text the model can return so a single report can't blow up
// cost/latency or store an enormous blob. Plenty for a plain-language answer.
export const MAX_DIAGNOSIS_CHARS = 1500;
export const MAX_WORKAROUND_CHARS = 1500;

// Shown to the user (and stored on the incident) when the AI can't be reached or
// returns something unusable. The incident is still recorded either way, so a
// manager always sees it — this just keeps the reporter from getting an error on
// top of an error.
export const FALLBACK_DIAGNOSIS =
  "We couldn't generate an automatic explanation right now, but your report has been logged and a manager has been notified.";
export const FALLBACK_WORKAROUND =
  "Try the action again. If it keeps happening, refresh or restart the app, check your connection, and let your manager know.";

export type ReportInput = z.infer<typeof ReportIncidentBody>;

export type ReportValidationResult =
  | { ok: true; data: ReportInput }
  | { ok: false; status: number; error: string };

// Validate the request body for POST /incidents. A user report should carry a
// description; a crash should carry an error message. We don't hard-reject a
// missing one (a crash with only a stack, or a terse report, is still useful),
// but we require at least *some* signal so empty submissions are turned away.
export function validateReportBody(body: unknown): ReportValidationResult {
  const parsed = ReportIncidentBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  const hasSignal = Boolean(
    (data.description && data.description.trim()) ||
      (data.errorMessage && data.errorMessage.trim()) ||
      (data.errorStack && data.errorStack.trim()),
  );
  if (!hasSignal) {
    return {
      ok: false,
      status: 400,
      error: "Please describe the problem before submitting.",
    };
  }
  return { ok: true, data };
}

// Assemble the jsonb context we persist from the validated body, dropping empty
// fields so the stored object stays tidy.
export function buildIncidentContext(data: ReportInput): IncidentContext {
  const ctx: IncidentContext = {};
  const description = data.description?.trim();
  const errorMessage = data.errorMessage?.trim();
  const errorStack = data.errorStack?.trim();
  const userAgent = data.userAgent?.trim();
  if (description) ctx.description = description;
  if (errorMessage) ctx.errorMessage = errorMessage;
  if (errorStack) ctx.errorStack = errorStack;
  if (userAgent) ctx.userAgent = userAgent;
  return ctx;
}

// Shape the report into a compact prompt. The model is told plainly that it
// cannot change code — a "fix" here means an explanation plus a safe recovery
// step (retry/refresh/restart/who to tell), never a code edit.
export function buildDiagnosisPrompt(params: {
  source: IncidentSource;
  screen: string;
  appPlatform: string;
  appVersion: string | null;
  context: IncidentContext;
}): { system: string; user: string } {
  const system =
    "You are a friendly in-app support assistant for a frozen-pizza production " +
    "tracking app used on a factory floor by line operators and shift managers. " +
    "A user has either reported a problem in their own words, or the app hit an " +
    "unexpected error that was captured automatically. Explain in plain, " +
    "non-technical language what most likely went wrong, then give one concrete, " +
    "safe thing the user can do right now. You CANNOT change or fix the app's " +
    "code — only suggest safe recovery steps such as retrying the action, " +
    "refreshing or restarting the app, checking the network connection, " +
    "re-entering a value, or telling a manager. Never invent specifics you " +
    "cannot see in the details. If a SIMILAR PAST INCIDENTS section is provided " +
    "and clearly matches this problem, acknowledge plainly that it has come up " +
    "before and base your workaround on the recovery step that worked then. " +
    "Be brief, calm, and reassuring. " +
    'Return ONLY JSON of the exact shape {"diagnosis":string,"workaround":string}.';

  const lines: string[] = [];
  lines.push(
    params.source === "auto_crash"
      ? "SOURCE: automatic crash capture (the app hit an uncaught error)"
      : "SOURCE: a user reported this problem in their own words",
  );
  lines.push(`PLATFORM: ${params.appPlatform}`);
  lines.push(`SCREEN: ${params.screen}`);
  if (params.appVersion) lines.push(`APP VERSION: ${params.appVersion}`);
  lines.push("");
  if (params.context.description) {
    lines.push("USER'S DESCRIPTION:");
    lines.push(params.context.description);
    lines.push("");
  }
  if (params.context.errorMessage) {
    lines.push("ERROR MESSAGE:");
    lines.push(params.context.errorMessage);
    lines.push("");
  }
  if (params.context.errorStack) {
    lines.push("ERROR STACK / TRACE (technical, for your analysis only):");
    lines.push(params.context.errorStack.slice(0, 4000));
    lines.push("");
  }
  lines.push(
    'Return ONLY JSON {"diagnosis":string,"workaround":string}. "diagnosis" is a ' +
      "short plain-language explanation of the likely cause (no jargon, no stack " +
      'traces). "workaround" is one safe next step the user can take now. Do not ' +
      "suggest editing code or settings the user can't reach.",
  );

  return { system, user: lines.join("\n") };
}

const DiagnosisSchema = z.object({
  diagnosis: z.coerce.string().optional(),
  workaround: z.coerce.string().optional(),
});

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// The model output isn't trustworthy: parse leniently, clamp lengths, and fall
// back to the canned strings if either field is missing/empty.
export function sanitizeDiagnosis(raw: unknown): {
  diagnosis: string;
  workaround: string;
} {
  const parsed = DiagnosisSchema.safeParse(raw);
  const diagnosis = parsed.success ? clamp(parsed.data.diagnosis ?? "", MAX_DIAGNOSIS_CHARS) : "";
  const workaround = parsed.success ? clamp(parsed.data.workaround ?? "", MAX_WORKAROUND_CHARS) : "";
  return {
    diagnosis: diagnosis || FALLBACK_DIAGNOSIS,
    workaround: workaround || FALLBACK_WORKAROUND,
  };
}

// ---------------------------------------------------------------------------
// History-aware diagnosis: recurring incidents get better, "we've seen this
// before" recovery steps. Each diagnosed incident is distilled into a stable
// signature and written into the shared facility-memory pool (domain below); a
// new report is matched against that pool so the prompt can be grounded in what
// resolved the same problem last time, and the reporter/manager get a "seen
// before" signal. All of this is PURE (no DB / network) so it's easy to unit
// test; the route owns the actual memory read/write.
// ---------------------------------------------------------------------------

// Facility-memory domain incidents are recorded under. Distinct from the AI
// name-corrections pool and from other knowledge domains.
export const INCIDENT_MEMORY_DOMAIN = "incidents";

// How many past incidents to surface to the prompt, and how alike a stored
// incident must be (token-overlap score) to count as "similar".
export const MAX_SIMILAR_INCIDENTS = 3;
export const SIMILARITY_THRESHOLD = 0.34;

const MAX_SIGNAL_CHARS = 200;

// Tiny stop-word list so a signature keys on the meaningful words ("save",
// "button", "undefined") rather than filler. Lower-cased, length >= 3.
const STOPWORDS = new Set(
  (
    "the and for with from that this then else does did has have had not but " +
    "you your when what why how got get the are was were will would should could " +
    "out off over under into onto its it's they them their there here just about"
  ).split(/\s+/),
);

// The most useful free-text signal for a report: the error message for a crash,
// otherwise the user's own words.
export function incidentSignalText(ctx: IncidentContext): string {
  return (ctx.errorMessage?.trim() || ctx.description?.trim() || "").slice(0, MAX_SIGNAL_CHARS);
}

function tokenize(text: string): string[] {
  const matches: string[] = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Significant tokens for a signature: de-duped and SORTED so word order doesn't
// matter ("save button" and "button save" collapse to the same signature).
function signatureTokens(text: string): string[] {
  return Array.from(new Set(tokenize(text))).sort().slice(0, 8);
}

export type IncidentSignatureInput = {
  screen: string;
  appPlatform: string;
  context: IncidentContext;
};

// A stable, fully lower-cased key for an incident: platform | screen | tokens.
// Re-recording the same kind of problem hits the same facility-memory row so the
// "seen Nx" count climbs instead of spawning duplicates.
export function incidentSignature(input: IncidentSignatureInput): string {
  const platform = input.appPlatform.trim().toLowerCase();
  const screen = input.screen.trim().toLowerCase();
  const tokens = signatureTokens(incidentSignalText(input.context));
  return `${platform}|${screen}|${tokens.join("-")}`.slice(0, 120);
}

function parseSignature(key: string): { platform: string; screen: string; tokens: string[] } {
  const [platform = "", screen = "", toks = ""] = key.toLowerCase().split("|");
  return { platform, screen, tokens: toks ? toks.split("-").filter(Boolean) : [] };
}

// Token-overlap similarity (intersection over union). Exported for focused unit
// tests of the recurrence-matching threshold; the route uses it via
// analyzeIncidentHistory.
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

// Pull the recorded occurrence count out of a stored incident fact
// ("Seen 3x on ..."). Defaults to 0 when absent/unparseable.
export function parseSeenCount(fact: string): number {
  const m = /seen\s+(\d+)x/i.exec(fact);
  const n = m ? Number.parseInt(m[1], 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Pull the "what helped last time" recovery step out of a stored fact.
export function parseLastWorkaround(fact: string): string | null {
  const m = /what helped last time:\s*(.+)$/i.exec(fact.trim());
  const text = m ? m[1].trim() : "";
  return text || null;
}

export type SimilarIncident = { key: string; fact: string; score: number; exact: boolean };

export type IncidentHistory = {
  signature: string;
  similar: SimilarIncident[];
  recurrence: IncidentRecurrence | null;
  // Occurrence count of the EXACT signature already in memory (0 if brand new);
  // the route increments this when it writes the incident back.
  priorExactCount: number;
};

// Match a fresh report against the incidents already in facility memory and
// derive the recurrence signal. Fail-safe by construction: an empty/garbage
// pool simply yields no matches and a null recurrence.
export function analyzeIncidentHistory(
  knowledge: ReadonlyArray<FacilityKnowledge>,
  input: IncidentSignatureInput,
): IncidentHistory {
  const signature = incidentSignature(input);
  const pool = filterKnowledgeByDomain(knowledge, [INCIDENT_MEMORY_DOMAIN]);
  const newParts = parseSignature(signature);

  const scored: SimilarIncident[] = pool.map((e) => {
    const key = e.key.toLowerCase();
    const exact = key === signature;
    const score = exact ? 1 : jaccard(newParts.tokens, parseSignature(key).tokens);
    return { key, fact: e.fact, score, exact };
  });

  const similar = scored
    .filter((s) => s.exact || s.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR_INCIDENTS);

  const exactMatch = scored.find((s) => s.exact) ?? null;
  const priorExactCount = exactMatch ? parseSeenCount(exactMatch.fact) : 0;

  let recurrence: IncidentRecurrence | null = null;
  if (similar.length > 0) {
    const count = priorExactCount > 0 ? priorExactCount : similar.length;
    recurrence = { count: Math.max(count, 1), lastWorkaround: parseLastWorkaround(similar[0].fact) };
  }

  return { signature, similar, recurrence, priorExactCount };
}

// Append a focused, ranked "similar past incidents" block to a built prompt so
// the model can lean on what worked before. Returns the prompt unchanged when
// there's no history.
export function appendIncidentHistoryBlock(
  userPrompt: string,
  similar: ReadonlyArray<SimilarIncident>,
): string {
  if (similar.length === 0) return userPrompt;
  const heading =
    "SIMILAR PAST INCIDENTS (recent reports that resemble this one. If this " +
    "problem has come up before, say so plainly and prefer the recovery step " +
    "that worked then):";
  const lines = similar.map((s) => `  - ${s.fact}`);
  return `${userPrompt}\n\n${[heading, ...lines].join("\n")}`;
}

// Distil an incident into the durable fact stored back into facility memory.
// `count` is the new occurrence count (prior + 1). Bounded so the pool stays
// compact regardless of how chatty a report was.
export function buildIncidentMemoryFact(
  input: IncidentSignatureInput,
  count: number,
  workaround: string,
): string {
  const signal = incidentSignalText(input.context) || "(no details captured)";
  const help = clamp(workaround, MAX_SIGNAL_CHARS) || "(no workaround captured)";
  return (
    `Seen ${count}x on "${input.screen}" (${input.appPlatform}). ` +
    `Problem: ${signal}. What helped last time: ${help}`
  );
}
