import * as z from "zod";
import { validateOptimizeBody, type OptimizeInput } from "./aiOptimize";

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

export type ProactiveAlert = {
  // Stable lowercase slug describing the *kind* of nudge (e.g. "behind-plan",
  // "break-window"). The same situation should reuse the same key so the client
  // can de-dup / cool down repeats. Never run-instance specific.
  key: string;
  category: ProactiveCategory;
  impact: ProactiveImpact;
  title: string;
  detail: string;
};

export type { OptimizeInput };
export { validateOptimizeBody };

const AlertSchema = z.object({
  key: z.coerce.string().optional(),
  category: z.coerce.string().optional(),
  impact: z.coerce.string().optional(),
  title: z.coerce.string().optional(),
  detail: z.coerce.string().optional(),
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

// The model returns structured JSON but is untrusted: validate leniently, drop a
// malformed alert (fall back to no alert), and length-clamp all free text. A
// missing/null alert is a valid "nothing to surface right now" outcome.
export function sanitizeProactiveAlert(raw: unknown): {
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
  return withNote({
    key: slugifyKey(a.key, category),
    category,
    impact: mapImpact(a.impact),
    title,
    detail,
  });
}

// Shape the validated live-day input into a compact, model-friendly prompt.
// Mirrors the optimize prompt's run formatting so the two assistants reason over
// the same facts, but asks for a single timely decision instead of a list.
export function buildProactivePrompt(input: OptimizeInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a proactive production-line watcher for a frozen-pizza factory. " +
    "You run automatically every few minutes while a shift is in progress. " +
    "Your job is to decide whether, RIGHT NOW, there is exactly ONE timely, " +
    "actionable nudge worth interrupting a busy shift manager for. Only two " +
    "kinds of nudge qualify: (1) the line is clearly falling behind the plan / " +
    "target finish time and the manager should act; or (2) a natural break or " +
    "changeover window is opening now, so a break/lunch can be taken without " +
    "stalling the line. Be conservative: if nothing is clearly actionable at " +
    "this exact moment, return no alert. Never invent data, never nag about " +
    "minor things, and never suggest formula or recipe changes.";

  const fmtRun = (r: OptimizeInput["runs"][number]): string => {
    const parts = [
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
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"alert":{"key":string,"category":"run"|"break"|"efficiency","title":string,"detail":string,' +
      '"impact":"high"|"medium"|"low"}|null,"note":string}. ' +
      'Set "alert" to null when there is nothing clearly worth surfacing right now. ' +
      "When you do surface one, keep title short (a glanceable headline) and detail to one or two " +
      "plain-language sentences a floor manager can act on immediately. " +
      '"key" must be a short, stable lowercase slug naming the KIND of nudge (e.g. "behind-plan", ' +
      '"break-window", "downtime-spike") — the SAME situation must always reuse the SAME key so ' +
      "repeats can be suppressed; never make the key specific to a run instance or timestamp. " +
      'Use "category":"break" for a break/changeover window, otherwise "run" or "efficiency".',
  );

  return { system, user: lines.join("\n") };
}
