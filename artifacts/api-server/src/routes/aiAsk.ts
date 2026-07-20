import { AiAskBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  validateOptimizeBody,
  formatClock12,
  formatHHMM12,
  TIME_FORMAT_INSTRUCTION,
  type OptimizeInput,
} from "./aiOptimize";

// Bounds for the free-form "ask the AI about the day" endpoint, in the same
// spirit as the optimize guards: cap how much the model is asked to read and
// how much it can return so a single request can't blow up cost/latency.
export const MAX_QUESTION_CHARS = 1000;
export const MAX_ANSWER_CHARS = 2000;
export const MAX_NOTE_CHARS = 600;

export type AskInput = z.infer<typeof AiAskBody>;

export type AskValidationResult =
  | { ok: true; data: AskInput }
  | { ok: false; status: number; error: string };

// Validate POST /ai/ask. The body carries a question plus the full live
// day-state (reusing the OptimizeInput shape), so we validate the envelope with
// the generated schema and then reuse the optimize run-count cap on the nested
// day-state — one source of truth for "too many runs".
export function validateAskBody(body: unknown): AskValidationResult {
  const parsed = AiAskBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const question = parsed.data.question.trim();
  if (!question) {
    return { ok: false, status: 400, error: "Question is required" };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, status: 400, error: `Question too long (max ${MAX_QUESTION_CHARS} characters)` };
  }
  // Reuse the optimize validator for the day-state run-count cap.
  const dayValidation = validateOptimizeBody(parsed.data.dayState);
  if (!dayValidation.ok) {
    return { ok: false, status: dayValidation.status, error: dayValidation.error };
  }
  return { ok: true, data: { question, dayState: dayValidation.data } };
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// Shape the validated input into a compact, model-friendly Q&A prompt. The
// day-state context block mirrors the optimize prompt's per-run formatting so
// the model sees the same real facts; the instructions, however, are tuned for
// answering ONE plain-language question and for refusing to invent data.
export function buildAskPrompt(input: AskInput): { system: string; user: string } {
  const day = input.dayState;

  const system =
    "You are a helpful assistant for floor staff at a frozen-pizza factory. " +
    "A worker will ask you a plain-language question about today's production. " +
    "Answer ONLY from the real data provided below (today's runs, the schedule, " +
    "recent history, the facility memory, and this user's earlier turns). Be " +
    "concrete and quantitative when the data supports it, and keep the answer " +
    "short and clear — a sentence or two is usually enough. " +
    "NEVER invent, guess, or assume data that isn't given. If the data is " +
    "insufficient to answer, say so plainly and explain what's missing rather " +
    "than making something up. Do not suggest changes to formulas or recipes, " +
    "and do not take any actions — you only answer questions.";

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

  const nowClock = formatClock12(day.nowMs, day.tzOffsetMinutes);

  const lines: string[] = [];
  lines.push("DAY DATA (the only facts you may use):");
  lines.push(`DATE: ${day.date}`);
  lines.push(`CURRENT TIME: ${nowClock}`);
  if (day.runToTime) lines.push(`TARGET FINISH TIME: ${formatHHMM12(day.runToTime)}`);
  lines.push(`TODAY PPM (aggregate): ${day.todayPpm ?? 0}`);
  lines.push(`HISTORICAL BENCHMARK PPM: ${day.benchmarkPpm ?? "none (no history yet)"}`);
  lines.push("");
  lines.push("TODAY'S RUNS:");
  lines.push(day.runs.length ? day.runs.map(fmtRun).join("\n") : "(none)");

  if (day.scheduledRuns?.length) {
    lines.push("");
    lines.push("SCHEDULED (FUTURE) RUNS:");
    lines.push(
      day.scheduledRuns
        .map(
          (s) =>
            `- date=${s.date} "${s.brand} ${s.flavor}" die=${s.dieType || "?"} casesNeeded=${s.casesNeeded}`,
        )
        .join("\n"),
    );
  }

  if (day.historyRuns?.length) {
    lines.push("");
    lines.push("RECENT FINISHED RUNS (history):");
    lines.push(day.historyRuns.map(fmtRun).join("\n"));
  }

  lines.push("");
  lines.push(`QUESTION: ${input.question}`);
  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"answer":string,"note":string}. ' +
      'Put your plain-language reply in "answer". ' +
      'If the data above does not let you answer, set "answer" to a brief honest ' +
      'explanation that you cannot answer from the available data, and put what ' +
      'extra information would be needed in "note". Otherwise leave "note" empty. ' +
      TIME_FORMAT_INSTRUCTION,
  );

  return { system, user: lines.join("\n") };
}

// The model returns JSON but isn't trustworthy. Parse leniently: prefer a
// well-formed {answer, note}; if parsing fails entirely, fall back to using the
// raw content as the answer so a stray formatting slip never drops a real reply.
export function sanitizeAnswer(content: string): { answer: string; note?: string } {
  const raw = (content ?? "").trim();
  if (!raw) return { answer: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }

  const ResponseSchema = z.object({
    answer: z.coerce.string().optional(),
    note: z.coerce.string().optional(),
  });
  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }
  const answer = clamp(result.data.answer ?? "", MAX_ANSWER_CHARS);
  const note = clamp(result.data.note ?? "", MAX_NOTE_CHARS);
  // If the model produced neither an answer nor a note, fall back to the raw
  // content so we never return an empty reply for a non-empty response.
  if (!answer && !note) return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  return note ? { answer, note } : { answer };
}
