import * as z from "zod";
import type { ReorderItem } from "@workspace/inventory-math";
import type { IncidentCluster } from "@workspace/incident-cluster";
import {
  validateOptimizeBody,
  formatClock12,
  formatHHMM12,
  TIME_FORMAT_INSTRUCTION,
  type OptimizeInput,
} from "./aiOptimize";
import { MAX_FLAGGED_IN_PROMPT, type WasteFlaggedItem } from "./wasteInsight";

// Proactive shift-floor watcher. Same input contract as /ai/optimize (the whole
// live day), but a very different job: instead of a ranked list of advice the
// model is asked to decide whether RIGHT NOW there is exactly ONE timely nudge
// worth interrupting a manager for (falling behind plan, or a natural break /
// changeover window opening) — or nothing at all. The endpoint polls on a
// cadence while a day is running, so it must be conservative and stable.

export type ProactiveCategory = "run" | "break" | "efficiency";
export type ProactiveImpact = "high" | "medium" | "low";

// Bound free-text and the de-dup key so a single poll can't blow up payloads.
export const PROACTIVE_MAX_TITLE_CHARS = 100;
export const PROACTIVE_MAX_DETAIL_CHARS = 400;
export const PROACTIVE_MAX_KEY_CHARS = 64;

// How many recurring incident patterns to surface as grounding context. Kept
// small so the watcher "learns" from the handful of most-reported problems
// without flooding the prompt with one-off reports.
export const PROACTIVE_MAX_INCIDENT_PATTERNS = 5;
// Each grounded pattern's recommended-action hint is clamped to keep the section
// compact.
export const PROACTIVE_MAX_PATTERN_HINT_CHARS = 200;

// Factory-wide knobs that let a manager tune how aggressive the watcher is.
// Bounds keep the cadence sane so a misconfig can't hammer the (cost-capped) AI
// endpoint nor leave it effectively never polling. Kept in lockstep with the
// client defaults/bounds in each app's aiProactive.ts. Lives here (not in the
// db-bound ai.ts) so it stays unit-testable without binding the Postgres pool.
export const PROACTIVE_POLL_SECONDS_MIN = 30;
export const PROACTIVE_POLL_SECONDS_MAX = 3600;
export const PROACTIVE_COOLDOWN_SECONDS_MIN = 0;
export const PROACTIVE_COOLDOWN_SECONDS_MAX = 86_400;

export type ProactiveAlertSettingsInput = {
  enabled: boolean;
  pollSeconds: number;
  cooldownSeconds: number;
};

export function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Coerce a validated settings body into safe, in-bounds integers before
// persisting. Used by PUT /ai/proactive-settings.
export function clampProactiveSettings(
  input: ProactiveAlertSettingsInput,
): ProactiveAlertSettingsInput {
  return {
    enabled: input.enabled,
    pollSeconds: clampInt(input.pollSeconds, PROACTIVE_POLL_SECONDS_MIN, PROACTIVE_POLL_SECONDS_MAX),
    cooldownSeconds: clampInt(
      input.cooldownSeconds,
      PROACTIVE_COOLDOWN_SECONDS_MIN,
      PROACTIVE_COOLDOWN_SECONDS_MAX,
    ),
  };
}

// Upper bound for suggestedAction integer fields. Values above this are
// implausibly large for a single production shift and are treated as garbage.
export const SUGGESTED_ACTION_MAX = 9999;

export type ProactiveAlertSuggestedAction = {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
};

export type ProactiveAlert = {
  // Stable lowercase slug describing the *kind* of nudge (e.g. "behind-plan",
  // "break-window"). The same situation should reuse the same key so the client
  // can de-dup / cool down repeats. Never run-instance specific.
  key: string;
  category: ProactiveCategory;
  impact: ProactiveImpact;
  title: string;
  detail: string;
  // Optional ready-to-apply progress correction. Present only on "run" /
  // "behind-plan" nudges when the AI has enough confidence to suggest a
  // specific skids-completed + cases-on-skid value. Absent on stock/break nudges.
  suggestedAction?: ProactiveAlertSuggestedAction;
};

export type LowCaseCorrection = {
  runId: string;
  impliedCases: number;
  combinedProgressCases: number;
  casedTargetCases: number;
  suggestedAction: ProactiveAlertSuggestedAction;
};

export type { OptimizeInput };
export { validateOptimizeBody };

// A day is "active" once at least one run is started but not yet ended. The
// behind-plan and break/changeover nudges only make sense during an active day;
// the at-risk-stock nudge is useful even on an idle day (stock can expire
// overnight or first thing in the morning, before any run begins). Computed
// from the run statuses so both the route (cost short-circuit) and the prompt
// (which kinds of nudge to allow) reason off one shared definition.
export function isDayActive(input: OptimizeInput): boolean {
  return input.runs.some((r) => r.status === "running");
}

const SuggestedActionSchema = z.object({
  skidsCompleted: z.unknown().optional(),
  casesOnCurrentSkid: z.unknown().optional(),
});

const AlertSchema = z.object({
  key: z.coerce.string().optional(),
  category: z.coerce.string().optional(),
  impact: z.coerce.string().optional(),
  title: z.coerce.string().optional(),
  detail: z.coerce.string().optional(),
  suggested_action: z.unknown().optional(),
});
const ResponseSchema = z.object({
  alert: z.unknown().nullish(),
  note: z.coerce.string().optional(),
});

function mapCategory(raw: string | undefined): ProactiveCategory {
  const c = (raw ?? "").trim().toLowerCase();
  if (c.startsWith("break")) return "break";
  if (c.startsWith("eff") || c.startsWith("app") || c.startsWith("insight")) return "efficiency";
  return "run";
}

function mapImpact(raw: string | undefined): ProactiveImpact {
  const i = (raw ?? "").trim().toLowerCase();
  if (i.startsWith("high")) return "high";
  if (i.startsWith("low")) return "low";
  return "medium";
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// Turn an arbitrary model string into a stable lowercase slug usable as a
// de-dup key. Falls back to the category when nothing usable is provided.
export function slugifyKey(raw: string | undefined, fallback: string): string {
  const slug = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const result = slug || fallback;
  return result.length > PROACTIVE_MAX_KEY_CHARS
    ? result.slice(0, PROACTIVE_MAX_KEY_CHARS).replace(/-+$/g, "")
    : result;
}

const LOW_CASE_SHORTFALL_RATIO = 0.1;

/**
 * Deterministically checks whether a running line's recorded case count is
 * genuinely stale. Freezer/on-line WIP counts for eligibility, but is subtracted
 * back out of the correction so the suggested skid target remains cased-only.
 */
export function findLowCaseCorrection(input: OptimizeInput): LowCaseCorrection | null {
  for (const run of input.runs) {
    const pizzasPerCase = Number(run.pizzasPerCase);
    const casesPerSkid = Math.floor(Number(run.casesPerSkid));
    const netRunMin = Math.round(run.netElapsedSec / 60);
    if (
      run.status !== "running" ||
      run.stoppages.some((stoppage) => stoppage.open) ||
      !Number.isFinite(pizzasPerCase) ||
      pizzasPerCase <= 0 ||
      !Number.isFinite(casesPerSkid) ||
      casesPerSkid <= 0 ||
      !Number.isFinite(run.plannedPpm) ||
      run.plannedPpm <= 0 ||
      netRunMin <= 0
    ) {
      continue;
    }

    const casesMade = Math.max(0, Number(run.casesMade) || 0);
    // Older clients omit casesOnLine. Treat omission as zero so their payloads
    // continue to validate and retain the pre-WIP behavior safely.
    const casesOnLine = Math.max(0, Math.floor(Number(run.casesOnLine) || 0));
    const impliedCases = Math.floor((run.plannedPpm * netRunMin) / pizzasPerCase);
    const combinedProgressCases = casesMade + casesOnLine;
    const shortfallRatio =
      (impliedCases - combinedProgressCases) / Math.max(combinedProgressCases, 1);
    if (shortfallRatio <= LOW_CASE_SHORTFALL_RATIO) continue;

    const casedTargetCases = Math.max(casesMade, impliedCases - casesOnLine);
    const skidsCompleted = Math.floor(casedTargetCases / casesPerSkid);
    const casesOnCurrentSkid = Math.floor(casedTargetCases % casesPerSkid);
    if (
      skidsCompleted > SUGGESTED_ACTION_MAX ||
      casesOnCurrentSkid > SUGGESTED_ACTION_MAX
    ) {
      continue;
    }

    return {
      runId: run.id,
      impliedCases,
      combinedProgressCases,
      casedTargetCases,
      suggestedAction: { skidsCompleted, casesOnCurrentSkid },
    };
  }
  return null;
}

function isLowCaseAlertSignal(key: string, title: string, detail: string): boolean {
  if (
    key === "low-case-count" ||
    key === "case-count-low" ||
    key === "recorded-case-count-low"
  ) {
    return true;
  }
  const text = `${title} ${detail}`.toLowerCase();
  const namesRecordedProgress =
    /\b(?:case|skid)\s+count\b/.test(text) ||
    /\brecorded\s+(?:case|cases|skid|skids|output|production)\b/.test(text) ||
    /\b(?:case|skid)\s+(?:counter|recording)\b/.test(text);
  const claimsItIsLow =
    /\b(?:low|missing|stale|short|undercount|under-count|behind|not updated|not recorded)\b/.test(
      text,
    );
  return namesRecordedProgress && claimsItIsLow;
}

// The model returns structured JSON but is untrusted: validate leniently, drop a
// malformed alert (fall back to no alert), and length-clamp all free text. A
// missing/null alert is a valid "nothing to surface right now" outcome.
export function sanitizeProactiveAlert(raw: unknown, input?: OptimizeInput): {
  alert: ProactiveAlert | null;
  note?: string;
} {
  const top = ResponseSchema.safeParse(raw);
  if (!top.success) return { alert: null };
  const note = (top.data.note ?? "").trim();
  const withNote = (alert: ProactiveAlert | null) =>
    note ? { alert, note: clamp(note, PROACTIVE_MAX_DETAIL_CHARS) } : { alert };

  if (top.data.alert == null) return withNote(null);

  const parsed = AlertSchema.safeParse(top.data.alert);
  if (!parsed.success) return withNote(null);
  const a = parsed.data;
  const title = clamp(a.title ?? "", PROACTIVE_MAX_TITLE_CHARS);
  const detail = clamp(a.detail ?? "", PROACTIVE_MAX_DETAIL_CHARS);
  if (!title || !detail) return withNote(null);

  const category = mapCategory(a.category);
  const key = slugifyKey(a.key, category);
  const lowCaseCorrection = input ? findLowCaseCorrection(input) : null;

  // Suppress a low-recorded-count nudge outright when combined cased + on-line
  // progress is not actually low. The prompt requires the stable key, while the
  // narrow text check also catches a model that miskeys or omits the action.
  if (
    input &&
    category === "run" &&
    isLowCaseAlertSignal(key, title, detail) &&
    !lowCaseCorrection
  ) {
    return withNote(null);
  }

  // Parse the optional suggested_action. Drop the action (but keep the alert)
  // when: category is not "run" (actions only valid for behind-plan run nudges),
  // either field is missing/non-numeric/negative/implausibly large.
  let suggestedAction: ProactiveAlertSuggestedAction | undefined;
  if (a.suggested_action != null && category === "run") {
    const sa = SuggestedActionSchema.safeParse(a.suggested_action);
    if (sa.success) {
      const skids = Number(sa.data.skidsCompleted);
      const cases = Number(sa.data.casesOnCurrentSkid);
      if (
        Number.isFinite(skids) &&
        Number.isFinite(cases) &&
        skids >= 0 &&
        cases >= 0 &&
        skids <= SUGGESTED_ACTION_MAX &&
        cases <= SUGGESTED_ACTION_MAX
      ) {
        // At the live route boundary, never trust model arithmetic. An action is
        // valid only when the deterministic combined-progress check says the
        // recorded count is genuinely low, and the returned target is always the
        // server-computed cased-only target (implied cases minus current WIP).
        if (input) {
          if (!lowCaseCorrection) return withNote(null);
          suggestedAction = lowCaseCorrection.suggestedAction;
        } else {
          suggestedAction = {
            skidsCompleted: Math.round(skids),
            casesOnCurrentSkid: Math.round(cases),
          };
        }
      }
    }
  }

  return withNote({
    key,
    category,
    impact: mapImpact(a.impact),
    title,
    detail,
    ...(suggestedAction ? { suggestedAction } : {}),
  });
}

// Build the compact "recent incident patterns" grounding section from the
// deterministic incident clusters (see @workspace/incident-cluster). Only
// recurring patterns (2+ occurrences) are surfaced so a single one-off report
// doesn't bias the watcher; returns "" when there's nothing worth grounding.
// Pure + testable: the route does the DB read and clustering, this just formats.
export function buildIncidentPatternsSection(
  clusters: ReadonlyArray<IncidentCluster>,
): string {
  const recurring = clusters.filter((c) => c.incidentCount >= 2);
  if (recurring.length === 0) return "";
  const lines = recurring.slice(0, PROACTIVE_MAX_INCIDENT_PATTERNS).map((c) => {
    const hint = (c.recommendedAction || c.rootCauseHypothesis || "").trim();
    const hintText = hint ? `: ${clamp(hint, PROACTIVE_MAX_PATTERN_HINT_CHARS)}` : "";
    return `- [${c.severity}] ${c.theme} — reported ${c.incidentCount}x${hintText}`;
  });
  return [
    "RECENT REPORTED ISSUES (recurring problems staff have reported lately — " +
      "context only, to inform your timing and wording; do NOT invent a new kind " +
      "of nudge from these):",
    ...lines,
  ].join("\n");
}

// Shape the validated live-day input into a compact, model-friendly prompt.
// Mirrors the optimize prompt's run formatting so the two assistants reason over
// the same facts, but asks for a single timely decision instead of a list.
export function buildProactivePrompt(
  input: OptimizeInput,
  flaggedAtRisk: ReadonlyArray<WasteFlaggedItem> = [],
  lowStock: ReadonlyArray<ReorderItem> = [],
  incidentPatterns: ReadonlyArray<IncidentCluster> = [],
): {
  system: string;
  user: string;
} {
  const dayActive = isDayActive(input);

  const role =
    "You are a proactive production-line watcher for a frozen-pizza factory. " +
    "You run automatically every few minutes. ";

  // When a shift is running, all four kinds of nudge are in play. When the day
  // is idle (no run started yet) only the stock-related nudges (at-risk stock,
  // low stock / reorder) make sense — behind-plan / break nudges need a live run
  // — so the watcher is told to consider stock only.
  const system = dayActive
    ? role +
      "A shift is currently in progress. Your job is to decide whether, RIGHT " +
      "NOW, there is exactly ONE timely, actionable nudge worth interrupting a " +
      "busy shift manager for. Only four kinds of nudge qualify: (1) the line " +
      "is clearly falling behind the plan / target finish time and the manager " +
      "should act; or (2) a natural break or changeover window is opening now, " +
      "so a break/lunch can be taken without stalling the line; or (3) there is " +
      "ingredient/packaging stock that is already expired or expiring very soon " +
      "and today's production could be ordered to consume it first to avoid " +
      "waste; or (4) an ingredient/packaging item has dropped to or below its " +
      "reorder point and should be reordered now to avoid a stockout. The lists " +
      "of at-risk stock and low stock are given to you below — only raise the " +
      "matching nudge when its list is non-empty, and never invent items or " +
      "quantities. Be conservative: if nothing is clearly actionable at this " +
      "exact moment, return no alert. Prioritize a behind-plan or break-window " +
      "nudge over a stock nudge when more than one applies. Never nag about " +
      "minor things, and never suggest formula or recipe changes."
    : role +
      "No shift is running yet — the day is idle. The ONLY nudges you may raise " +
      "right now are stock-related: (1) an at-risk-stock / waste-avoidance " +
      "nudge — stock that is already expired or expiring very soon, so the " +
      "manager should plan today's production to consume it first; or (2) a " +
      "low-stock / reorder nudge — an item that has dropped to or below its " +
      "reorder point and should be reordered now to avoid a stockout. NEVER " +
      "raise a behind-plan or break/changeover nudge while the day is idle. The " +
      "lists of at-risk stock and low stock are given to you below — only raise " +
      "the matching nudge when its list is non-empty, and never invent items or " +
      "quantities. Be conservative: if there is no clearly at-risk or low " +
      "stock, return no alert. Never nag about minor things, and never suggest " +
      "formula or recipe changes.";

  const fmtRun = (r: OptimizeInput["runs"][number]): string => {
    const parts = [
      `label="${r.label}"`,
      `status=${r.status}`,
      `die=${r.dieType || "?"}`,
      `casesNeeded=${r.casesNeeded}`,
      `casesMade=${r.casesMade}`,
      `casesOnLine=${r.casesOnLine ?? 0}`,
      `casesLeft=${r.casesLeft}`,
      `plannedPPM=${r.plannedPpm}`,
      `actualPPM=${r.actualPpm ?? "n/a"}`,
      `minRemaining=${r.minutesRemaining ?? "n/a"}`,
      `netRunMin=${Math.round(r.netElapsedSec / 60)}`,
      `downtimeMin=${Math.round(r.downtimeSec / 60)}`,
      // Unit-conversion fields needed for the suggested_action calculation.
      // pizzasPerCase converts PPM (pizzas/min) to cases; casesPerSkid splits
      // a total case count into skidsCompleted + casesOnCurrentSkid.
      `pizzasPerCase=${r.pizzasPerCase ?? "n/a"}`,
      `casesPerSkid=${r.casesPerSkid ?? "n/a"}`,
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
  lines.push(`HISTORICAL BENCHMARK PPM: ${input.benchmarkPpm ?? "none (no history yet)"}`);
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

  lines.push("");
  lines.push("AT-RISK STOCK (expired or expiring soon):");
  if (flaggedAtRisk.length === 0) {
    lines.push("(none)");
  } else {
    for (const f of flaggedAtRisk.slice(0, MAX_FLAGGED_IN_PROMPT)) {
      const when =
        f.daysUntilExpiry == null
          ? "no date"
          : f.daysUntilExpiry < 0
            ? `expired ${Math.abs(f.daysUntilExpiry)}d ago`
            : `expires in ${f.daysUntilExpiry}d`;
      lines.push(
        `- ${f.name} [${f.category}] — ${f.qtyAtRisk} ${f.unit} at risk, ${when}` +
          (f.earliestExpiration ? ` (${f.earliestExpiration})` : ""),
      );
    }
  }

  lines.push("");
  lines.push("LOW STOCK (at or below reorder point — reorder now):");
  if (lowStock.length === 0) {
    lines.push("(none)");
  } else {
    for (const it of lowStock.slice(0, MAX_FLAGGED_IN_PROMPT)) {
      lines.push(
        `- ${it.name} [${it.category}] — ${it.onHand} ${it.unit} on hand` +
          ` (reorder point ${it.reorderThreshold}), suggest ordering ${it.suggestedQty} ${it.unit}`,
      );
    }
  }

  const incidentSection = buildIncidentPatternsSection(incidentPatterns);
  if (incidentSection) {
    lines.push("");
    lines.push(incidentSection);
  }

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"alert":{"key":string,"category":"run"|"break"|"efficiency","title":string,"detail":string,' +
      '"impact":"high"|"medium"|"low",' +
      '"suggested_action":{"skidsCompleted":integer,"casesOnCurrentSkid":integer}|omit}|null,"note":string}. ' +
      'Set "alert" to null when there is nothing clearly worth surfacing right now. ' +
      "When you do surface one, keep title short (a glanceable headline) and detail to one or two " +
      "plain-language sentences a floor manager can act on immediately. " +
      '"key" must be a short, stable lowercase slug naming the KIND of nudge (e.g. "behind-plan", ' +
      '"break-window", "downtime-spike", "stock-expiring", "reorder-now") — the SAME situation must ' +
      "always reuse the SAME key so repeats can be suppressed; never make the key specific to a run " +
      "instance or timestamp. " +
      'Use "category":"break" for a break/changeover window, "category":"efficiency" for an ' +
      'at-risk-stock / waste-avoidance nudge (use the key "stock-expiring") or a low-stock / reorder ' +
      'nudge (use the key "reorder-now"), otherwise "run". ' +
      'Include "suggested_action" ONLY when ALL of these are true: (1) the category is "run" and ' +
      "the nudge is about the line falling behind its recorded case count; (2) the day is active " +
      "and the affected run has no open stoppages; (3) pizzasPerCase and casesPerSkid are both known " +
      "(not n/a) for the affected run; (4) the planned throughput over the net elapsed time implies " +
      "meaningfully more cases than recorded — use plannedPPM (the machine's CONFIGURED speed, " +
      "which is INDEPENDENT of the recorded case count) as the throughput signal: " +
      "impliedCases = floor(plannedPPM × netRunMin / pizzasPerCase), " +
       "combinedProgress = casesMade + casesOnLine, then check whether " +
       "(impliedCases - combinedProgress) / max(combinedProgress, 1) > 0.10 " +
       "(implied total is more than 10% above all cased plus in-flight work). " +
      "Do NOT use actualPPM for this calculation — it is derived from casesMade and would be circular. " +
      "Only suggest a correction when the line appears to be running normally at its configured speed " +
      "but the recorded case count looks low, suggesting the counter may not have been updated. " +
       'Use the key "low-case-count" for this specific nudge. casesMade is the recorded/cased count; ' +
       "casesOnLine is work in progress and MUST NEVER be converted into completed skid output. " +
       "(5) You can express the cased-only correction as non-negative whole numbers: " +
       "correctedCasedCases = max(casesMade, impliedCases - casesOnLine), " +
       "skidsCompleted = floor(correctedCasedCases / casesPerSkid), " +
       "casesOnCurrentSkid = correctedCasedCases mod casesPerSkid. " +
      "Omit suggested_action entirely for stock, break, or efficiency nudges, when there are open " +
      "stoppages, when pizzasPerCase or casesPerSkid is n/a, or when you are not confident. " +
      TIME_FORMAT_INSTRUCTION,
  );

  return { system, user: lines.join("\n") };
}
