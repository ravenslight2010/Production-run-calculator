import { AiOptimizeBody } from "@workspace/api-zod";
import * as z from "zod";

// Cap how much work the model is asked to do, and how much it can return, so a
// single request can't blow up cost/latency. Mirrors the photo endpoint guards.
export const MAX_RUNS = 200;
export const MAX_RECOMMENDATIONS = 12;
export const MAX_TITLE_CHARS = 120;
export const MAX_DETAIL_CHARS = 600;
export const MAX_ACTION_LABEL_CHARS = 80;
// Upper bound on a run's case target an action may set. Generous, but guards
// against the model emitting absurd values that a one-tap apply would commit.
export const MAX_TARGET_CASES = 1_000_000;

export type OptimizeCategory = "run" | "break" | "efficiency";
export type OptimizeImpact = "high" | "medium" | "low";

// Optional one-tap action a manager can apply from a recommendation card. Each
// kind maps to an existing client mutation; the server only validates/sanitizes
// the shape (and cross-checks run ids), it never applies anything.
export type OptimizeActionKind =
  | "set_target_time"
  | "set_run_target"
  | "reorder_run";

export type OptimizeAction = {
  kind: OptimizeActionKind;
  label: string;
  // set_target_time
  time?: string;
  // set_run_target / reorder_run
  runId?: string;
  // set_run_target
  casesNeeded?: number;
  // reorder_run: move runId to immediately before beforeRunId, or last if null
  beforeRunId?: string | null;
};

export type RecommendationOut = {
  category: OptimizeCategory;
  title: string;
  detail: string;
  impact: OptimizeImpact;
  appliesTo: string | null;
  action: OptimizeAction | null;
};

// The model returns structured JSON but is not trustworthy, so validate each
// recommendation leniently (coerce strings/numbers, tolerate missing optional
// fields) and drop anything malformed. The whole response collapses to [] if
// the top-level shape is wrong. Category/impact are mapped to the allowed enums
// with sensible fallbacks, and free-text is trimmed + length-clamped.
const ActionSchema = z.object({
  kind: z.coerce.string().optional(),
  label: z.coerce.string().optional(),
  time: z.coerce.string().optional(),
  runId: z.coerce.string().optional(),
  casesNeeded: z.coerce.number().optional(),
  beforeRunId: z.coerce.string().nullish(),
});
const RecSchema = z.object({
  category: z.coerce.string().optional(),
  title: z.coerce.string().optional(),
  detail: z.coerce.string().optional(),
  impact: z.coerce.string().optional(),
  appliesTo: z.string().nullish(),
  action: z.unknown().optional(),
});
const ResponseSchema = z.object({
  recommendations: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});

function mapCategory(raw: string | undefined): OptimizeCategory {
  const c = (raw ?? "").trim().toLowerCase();
  if (c.startsWith("break")) return "break";
  if (c.startsWith("eff") || c.startsWith("app") || c.startsWith("insight")) return "efficiency";
  return "run";
}

function mapImpact(raw: string | undefined): OptimizeImpact {
  const i = (raw ?? "").trim().toLowerCase();
  if (i.startsWith("high")) return "high";
  if (i.startsWith("low")) return "low";
  return "medium";
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function mapActionKind(raw: string | undefined): OptimizeActionKind | null {
  const k = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!k) return null;
  if (k === "set_target_time" || k === "set_finish_time" || k === "target_time")
    return "set_target_time";
  if (k === "set_run_target" || k === "set_cases" || k === "bump_target")
    return "set_run_target";
  if (k === "reorder_run" || k === "move_run" || k === "reorder")
    return "reorder_run";
  // Fuzzy fallbacks (order matters: time before target so "finish time" wins).
  if (k.includes("time") || k.includes("finish")) return "set_target_time";
  if (k.includes("reorder") || k.includes("move") || k.includes("sequence") || k.includes("order"))
    return "reorder_run";
  if (k.includes("target") || k.includes("cases")) return "set_run_target";
  return null;
}

// Validate a model-proposed action against the allowed operations and the set of
// real run ids for this request. Returns null (drop the action, keep the card)
// for anything malformed, hallucinated, or out of bounds.
export function sanitizeAction(
  raw: unknown,
  knownRunIds: ReadonlySet<string>,
): OptimizeAction | null {
  if (raw == null) return null;
  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const kind = mapActionKind(a.kind);
  if (!kind) return null;
  const providedLabel = clamp(a.label ?? "", MAX_ACTION_LABEL_CHARS);

  if (kind === "set_target_time") {
    const time = (a.time ?? "").trim();
    if (!HHMM.test(time)) return null;
    return { kind, label: providedLabel || `Set finish time to ${time}`, time };
  }

  if (kind === "set_run_target") {
    const runId = (a.runId ?? "").trim();
    if (!runId || !knownRunIds.has(runId)) return null;
    const casesNeeded = Math.round(a.casesNeeded ?? NaN);
    if (!Number.isFinite(casesNeeded) || casesNeeded <= 0 || casesNeeded > MAX_TARGET_CASES)
      return null;
    return {
      kind,
      label: providedLabel || `Set target to ${casesNeeded} cases`,
      runId,
      casesNeeded,
    };
  }

  // reorder_run
  const runId = (a.runId ?? "").trim();
  if (!runId || !knownRunIds.has(runId)) return null;
  const beforeRaw = a.beforeRunId == null ? null : a.beforeRunId.trim();
  const beforeRunId = beforeRaw ? beforeRaw : null;
  if (beforeRunId !== null) {
    if (!knownRunIds.has(beforeRunId) || beforeRunId === runId) return null;
  }
  return { kind, label: providedLabel || "Reorder run", runId, beforeRunId };
}

export function sanitizeRecommendations(
  raw: unknown,
  knownRunIds: ReadonlySet<string> = new Set(),
): {
  recommendations: RecommendationOut[];
  note?: string;
} {
  const top = ResponseSchema.safeParse(raw);
  if (!top.success) return { recommendations: [] };
  const out: RecommendationOut[] = [];
  for (const item of top.data.recommendations ?? []) {
    if (out.length >= MAX_RECOMMENDATIONS) break;
    const parsed = RecSchema.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    const title = clamp(r.title ?? "", MAX_TITLE_CHARS);
    const detail = clamp(r.detail ?? "", MAX_DETAIL_CHARS);
    if (!title || !detail) continue;
    const appliesToRaw = (r.appliesTo ?? "").trim();
    out.push({
      category: mapCategory(r.category),
      title,
      detail,
      impact: mapImpact(r.impact),
      appliesTo: appliesToRaw ? clamp(appliesToRaw, MAX_TITLE_CHARS) : null,
      action: sanitizeAction(r.action, knownRunIds),
    });
  }
  const note = (top.data.note ?? "").trim();
  return note ? { recommendations: out, note: clamp(note, MAX_DETAIL_CHARS) } : { recommendations: out };
}

export type OptimizeInput = z.infer<typeof AiOptimizeBody>;

export type OptimizeValidationResult =
  | { ok: true; data: OptimizeInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/optimize.
export function validateOptimizeBody(body: unknown): OptimizeValidationResult {
  const parsed = AiOptimizeBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  const total =
    data.runs.length +
    (data.scheduledRuns?.length ?? 0) +
    (data.historyRuns?.length ?? 0);
  if (total > MAX_RUNS) {
    return { ok: false, status: 400, error: `Too many runs (max ${MAX_RUNS})` };
  }
  return { ok: true, data };
}

// ── Local wall-clock formatting for prompts ──────────────────────────────────
// The server runs in UTC, but every clock string shown to the model (and echoed
// back to the user in alerts/answers) must be the FACTORY's local time in
// 12-hour form. The client supplies tzOffsetMinutes (minutes EAST of UTC, i.e.
// -Date.getTimezoneOffset()); when absent we fall back to the server clock so
// old clients keep working.

function to12h(hours24: number, minutes: number): string {
  const period = hours24 >= 12 ? "PM" : "AM";
  const h = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${h}:${minutes.toString().padStart(2, "0")} ${period}`;
}

export function formatClock12(ms: number, tzOffsetMinutes?: number | null): string {
  if (tzOffsetMinutes == null || !Number.isFinite(tzOffsetMinutes)) {
    const d = new Date(ms);
    return to12h(d.getHours(), d.getMinutes());
  }
  const local = new Date(ms + tzOffsetMinutes * 60_000);
  return to12h(local.getUTCHours(), local.getUTCMinutes());
}

// Convert an "HH:MM" time-of-day string (e.g. the target finish time) to
// 12-hour form. Returns the input unchanged when it isn't a valid HH:MM.
export function formatHHMM12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return hhmm;
  return to12h(h, min);
}

// Standing instruction appended to prompts so the model never re-emits times in
// 24-hour form even when reasoning about durations.
export const TIME_FORMAT_INSTRUCTION =
  "In all prose (titles, details, answers, notes), write times of day using the " +
  "12-hour clock with AM/PM (e.g. 5:48 PM), matching the times given above — " +
  'never 24-hour form. EXCEPTION: machine-readable JSON fields such as "time" ' +
  'inside an action MUST stay in 24-hour "HH:MM" form exactly as specified.';

// Shape the validated input into a compact, model-friendly prompt. Heavy data
// shaping lives server-side (per the contract-first design) so both clients can
// stay thin and identical.
export function buildOptimizePrompt(input: OptimizeInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a production-line optimization assistant for a frozen-pizza factory. " +
    "You analyze the day's runs, the planned schedule, and recent history, then give " +
    "concrete, actionable recommendations a shift supervisor can act on now. " +
    "Focus on three areas: (1) run optimization — sequencing, pacing, catching up to plan, " +
    "die/changeover order; (2) break optimization — when to take breaks/lunch so they land " +
    "during natural lulls or changeovers and don't stall the line; (3) efficiency & app insights — " +
    "downtime patterns, recurring stoppage reasons, throughput vs. historical benchmark. " +
    "Be specific and quantitative when the data supports it. Never invent data. " +
    "Do not suggest changes to formulas or recipes.";

  const fmtRun = (r: OptimizeInput["runs"][number]): string => {
    const parts = [
      `id=${r.id}`,
      `label="${r.label}"`,
      `status=${r.status}`,
      `die=${r.dieType || "?"}`,
      `casesNeeded=${r.casesNeeded}`,
      `casesMade=${r.casesMade}`,
      `casesLeft=${r.casesLeft}`,
      `plannedPPM=${r.plannedPpm}`,
      `actualPPM=${r.actualPpm ?? "n/a"}`,
      `minRemaining=${r.minutesRemaining ?? "n/a"}`,
      `netRunMin=${Math.round(r.netElapsedSec / 60)}`,
      `downtimeMin=${Math.round(r.downtimeSec / 60)}`,
    ];
    const stops = (r.stoppages ?? [])
      .map((s) => `${s.reason}(${Math.round(s.durationSec / 60)}m${s.open ? ",open" : ""})`)
      .join(", ");
    if (stops) parts.push(`stoppages=[${stops}]`);
    return `- ${parts.join(" ")}`;
  };

  const nowClock = formatClock12(input.nowMs, input.tzOffsetMinutes);

  const lines: string[] = [];
  lines.push(`DATE: ${input.date}`);
  lines.push(`CURRENT TIME: ${nowClock}`);
  if (input.runToTime) lines.push(`TARGET FINISH TIME: ${formatHHMM12(input.runToTime)}`);
  lines.push(`TODAY PPM (aggregate): ${input.todayPpm ?? 0}`);
  lines.push(
    `HISTORICAL BENCHMARK PPM: ${input.benchmarkPpm ?? "none (no history yet)"}`,
  );
  lines.push("");
  lines.push("TODAY'S RUNS:");
  lines.push(input.runs.length ? input.runs.map(fmtRun).join("\n") : "(none)");

  if (input.scheduledRuns?.length) {
    lines.push("");
    lines.push("SCHEDULED (FUTURE) RUNS:");
    lines.push(
      input.scheduledRuns
        .map(
          (s) =>
            `- date=${s.date} "${s.brand} ${s.flavor}" die=${s.dieType || "?"} casesNeeded=${s.casesNeeded}`,
        )
        .join("\n"),
    );
  }

  if (input.historyRuns?.length) {
    lines.push("");
    lines.push("RECENT FINISHED RUNS (history):");
    lines.push(input.historyRuns.map(fmtRun).join("\n"));
  }

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"recommendations":[{"category":"run"|"break"|"efficiency","title":string,"detail":string,' +
      '"impact":"high"|"medium"|"low","appliesTo":string|null,"action":Action|null}],"note":string}. ' +
      `Provide at most ${MAX_RECOMMENDATIONS} recommendations, ordered most impactful first, ` +
      "covering all three categories when the data supports it. " +
      "appliesTo should be a run label when the tip targets a specific run, else null. " +
      "If there is not enough data to analyze (e.g. no runs started), return an empty " +
      'recommendations array and put a short explanation in "note".',
  );
  lines.push("");
  lines.push(
    'OPTIONAL "action": include an action object ONLY when the recommendation can be applied ' +
      "by exactly one of these operations a supervisor can tap to apply; otherwise set action to null. " +
      'Allowed shapes: ' +
      '(a) {"kind":"set_target_time","time":"HH:MM","label":string} — set the shift target finish time; ' +
      '(b) {"kind":"set_run_target","runId":string,"casesNeeded":number,"label":string} — change one run\'s target case count; ' +
      '(c) {"kind":"reorder_run","runId":string,"beforeRunId":string|null,"label":string} — move runId to immediately before beforeRunId (null = move it last). ' +
      "Use run ids EXACTLY as they appear (id=...) in TODAY'S RUNS above; never invent ids and only target today's runs. " +
      'label is a short imperative button caption, e.g. "Move Run 3 before Run 2" or "Set Run 2 target to 480 cases".',
  );
  lines.push("");
  lines.push(TIME_FORMAT_INSTRUCTION);

  return { system, user: lines.join("\n") };
}
