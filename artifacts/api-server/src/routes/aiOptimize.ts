import { AiOptimizeBody } from "@workspace/api-zod";
import * as z from "zod";

// Cap how much work the model is asked to do, and how much it can return, so a
// single request can't blow up cost/latency. Mirrors the photo endpoint guards.
export const MAX_RUNS = 200;
export const MAX_RECOMMENDATIONS = 12;
export const MAX_TITLE_CHARS = 120;
export const MAX_DETAIL_CHARS = 600;

export type OptimizeCategory = "run" | "break" | "efficiency";
export type OptimizeImpact = "high" | "medium" | "low";

export type RecommendationOut = {
  category: OptimizeCategory;
  title: string;
  detail: string;
  impact: OptimizeImpact;
  appliesTo: string | null;
};

// The model returns structured JSON but is not trustworthy, so validate each
// recommendation leniently (coerce strings/numbers, tolerate missing optional
// fields) and drop anything malformed. The whole response collapses to [] if
// the top-level shape is wrong. Category/impact are mapped to the allowed enums
// with sensible fallbacks, and free-text is trimmed + length-clamped.
const RecSchema = z.object({
  category: z.coerce.string().optional(),
  title: z.coerce.string().optional(),
  detail: z.coerce.string().optional(),
  impact: z.coerce.string().optional(),
  appliesTo: z.string().nullish(),
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

export function sanitizeRecommendations(raw: unknown): {
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

  const now = new Date(input.nowMs);
  const nowClock = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  const lines: string[] = [];
  lines.push(`DATE: ${input.date}`);
  lines.push(`CURRENT TIME: ${nowClock}`);
  if (input.runToTime) lines.push(`TARGET FINISH TIME: ${input.runToTime}`);
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
      '"impact":"high"|"medium"|"low","appliesTo":string|null}],"note":string}. ' +
      `Provide at most ${MAX_RECOMMENDATIONS} recommendations, ordered most impactful first, ` +
      "covering all three categories when the data supports it. " +
      "appliesTo should be a run label when the tip targets a specific run, else null. " +
      "If there is not enough data to analyze (e.g. no runs started), return an empty " +
      'recommendations array and put a short explanation in "note".',
  );

  return { system, user: lines.join("\n") };
}
