import { AiMixAssistantBody } from "@workspace/api-zod";
import * as z from "zod";

// Bounds for the Mixes helper, in the same spirit as the other AI endpoints: cap
// how much the model is asked to read and how much it can return so a single
// request can't blow up cost/latency.
export const MAX_QUESTION_CHARS = 1000;
export const MAX_ANSWER_CHARS = 2000;
export const MAX_NOTE_CHARS = 600;
export const MAX_MIXES = 200;
export const MAX_COMPONENTS_PER_MIX = 120;

export type MixAssistInput = z.infer<typeof AiMixAssistantBody>;

export type MixAssistValidationResult =
  | { ok: true; data: MixAssistInput }
  | { ok: false; status: number; error: string };

// Validate POST /ai/mix-assistant. The body carries a question plus the current
// mix definitions. Validate the envelope with the generated schema, then enforce
// the cost caps so a pathological payload can't blow up a single AI call.
export function validateMixAssistBody(body: unknown): MixAssistValidationResult {
  const parsed = AiMixAssistantBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const question = parsed.data.question.trim();
  if (!question) {
    return { ok: false, status: 400, error: "Question is required" };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Question too long (max ${MAX_QUESTION_CHARS} characters)`,
    };
  }
  if (parsed.data.mixes.length > MAX_MIXES) {
    return { ok: false, status: 400, error: `Too many mixes (max ${MAX_MIXES})` };
  }
  for (const m of parsed.data.mixes) {
    if (m.components.length > MAX_COMPONENTS_PER_MIX) {
      return {
        ok: false,
        status: 400,
        error: `A mix has too many components (max ${MAX_COMPONENTS_PER_MIX})`,
      };
    }
  }
  return { ok: true, data: { ...parsed.data, question } };
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function fmtComponents(components: MixAssistInput["mixes"][number]["components"]): string {
  const real = components.filter((c) => c.ingredient.trim());
  if (real.length === 0) return "    (no ingredients)";
  return real.map((c) => `    - ${c.ingredient.trim()}: ${c.perPizza} lbs/pizza`).join("\n");
}

// Shape the validated input into a compact, model-friendly prompt. The mix
// context block lists each mix's product, ingredient rows, and batch settings so
// the model can answer honestly. The instructions are tuned for plain-language
// Q&A and for refusing to invent data. Advisory only — no structured apply.
export function buildMixAssistPrompt(input: MixAssistInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a helpful assistant for floor staff at a frozen-pizza factory. A " +
    "worker will ask a plain-language question about the factory's MIXES — " +
    "manager-defined ingredient blends prepared ahead of a run, each tied to a " +
    "product (brand + flavor). Answer ONLY from the real mix data provided below " +
    "(and the facility memory). Be concrete and quantitative when the data " +
    "supports it, and keep the answer short and clear. NEVER invent, guess, or " +
    "assume mixes, ingredients, or amounts that aren't given. If the data is " +
    "insufficient to answer, say so plainly and explain what's missing rather " +
    "than making something up. You are ADVISORY ONLY: never claim to have " +
    "changed, saved, or applied anything — you only give the worker the numbers " +
    "and explanation to act on themselves.";

  const lines: string[] = [];
  lines.push("MIX DATA (the only facts you may use):");
  lines.push("");
  lines.push("MIXES:");
  if (input.mixes.length === 0) {
    lines.push("  (none — no mixes have been defined yet)");
  } else {
    for (const m of input.mixes) {
      const product = `${(m.brand ?? "").trim()} ${(m.flavor ?? "").trim()}`.trim();
      const name = m.name.trim() ? ` "${m.name.trim()}"` : "";
      const parts: string[] = [];
      if (product) parts.push(`product="${product}"`);
      if (m.batchSize != null) parts.push(`batchSize=${m.batchSize}`);
      if (m.daysEarly != null) parts.push(`daysEarly=${m.daysEarly}`);
      if (m.amountAlreadyMade != null) parts.push(`amountAlreadyMade=${m.amountAlreadyMade}`);
      if (m.enabled === false) parts.push("enabled=false");
      lines.push(`  [mix]${name} ${parts.join(" ")}`.trimEnd());
      lines.push(fmtComponents(m.components));
    }
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
      'extra information would be needed in "note". Otherwise leave "note" empty.',
  );

  return { system, user: lines.join("\n") };
}

// The model returns JSON but isn't trustworthy. Parse leniently: prefer a
// well-formed {answer, note}; if parsing fails entirely, fall back to using the
// raw content as the answer so a stray formatting slip never drops a real reply.
export function sanitizeMixAnswer(content: string): { answer: string; note?: string } {
  const raw = (content ?? "").trim();
  if (!raw) return { answer: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }

  const Schema = z.object({
    answer: z.coerce.string().optional(),
    note: z.coerce.string().optional(),
  });
  const result = Schema.safeParse(parsed);
  if (!result.success) {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }
  const answer = clamp(result.data.answer ?? "", MAX_ANSWER_CHARS);
  const note = clamp(result.data.note ?? "", MAX_NOTE_CHARS);
  if (!answer && !note) return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  return { answer, ...(note ? { note } : {}) };
}
