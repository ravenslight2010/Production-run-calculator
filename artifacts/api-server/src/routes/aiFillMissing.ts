import { AiFillMissingBody } from "@workspace/api-zod";
import * as z from "zod";

// Bounds so a single request can't blow up cost/latency or return junk. Mirrors
// the photo / optimize endpoint guards.
export const MAX_FILL_FIELDS = 60;
export const MAX_CONTEXT_ITEMS = 80;
export const MAX_VALUE_CHARS = 80;
export const MAX_RATIONALE_CHARS = 300;

export type FillMissingSuggestion = {
  key: string;
  value: string;
  rationale: string;
};

export type FillMissingInput = z.infer<typeof AiFillMissingBody>;

export type FillMissingValidationResult =
  | { ok: true; data: FillMissingInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/fill-missing.
export function validateFillMissingBody(body: unknown): FillMissingValidationResult {
  const parsed = AiFillMissingBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  if (data.fields.length === 0) {
    return { ok: false, status: 400, error: "No fields to fill" };
  }
  if (data.fields.length > MAX_FILL_FIELDS) {
    return { ok: false, status: 400, error: `Too many fields (max ${MAX_FILL_FIELDS})` };
  }
  if ((data.context?.length ?? 0) > MAX_CONTEXT_ITEMS) {
    return { ok: false, status: 400, error: `Too much context (max ${MAX_CONTEXT_ITEMS})` };
  }
  return { ok: true, data };
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// The model returns structured JSON but is not trustworthy: validate each
// suggestion leniently (coerce strings, tolerate extras), drop anything for an
// unrequested key or a select value not in the allowed option set, and keep at
// most one suggestion per requested key. The whole response collapses to [] if
// the top-level shape is wrong.
const SuggestionSchema = z.object({
  key: z.coerce.string().optional(),
  value: z.coerce.string().optional(),
  rationale: z.coerce.string().optional(),
});
const ResponseSchema = z.object({
  suggestions: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});

export type RequestedField = {
  key: string;
  kind: "number" | "text" | "select";
  options?: string[];
};

export function sanitizeFillMissingSuggestions(
  raw: unknown,
  requested: ReadonlyArray<RequestedField>,
): { suggestions: FillMissingSuggestion[]; note?: string } {
  const top = ResponseSchema.safeParse(raw);
  if (!top.success) return { suggestions: [] };

  const byKey = new Map<string, RequestedField>();
  for (const f of requested) byKey.set(f.key, f);

  const seen = new Set<string>();
  const out: FillMissingSuggestion[] = [];
  for (const item of top.data.suggestions ?? []) {
    const parsed = SuggestionSchema.safeParse(item);
    if (!parsed.success) continue;
    const s = parsed.data;
    const key = (s.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    const field = byKey.get(key);
    if (!field) continue; // hallucinated / unrequested key

    let value = clamp(s.value ?? "", MAX_VALUE_CHARS);
    if (!value) continue;

    if (field.kind === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) continue;
      value = String(n);
    } else if (field.kind === "select") {
      const opts = field.options ?? [];
      const match = opts.find((o) => o.toLowerCase() === value.toLowerCase());
      if (!match) continue; // not an allowed option
      value = match;
    }

    const rationale = clamp(s.rationale ?? "", MAX_RATIONALE_CHARS);
    if (!rationale) continue;

    seen.add(key);
    out.push({ key, value, rationale });
    if (out.length >= requested.length) break;
  }

  const note = (top.data.note ?? "").trim();
  return note ? { suggestions: out, note: clamp(note, MAX_RATIONALE_CHARS) } : { suggestions: out };
}

// Shape the validated input into a compact, model-friendly prompt. Heavy shaping
// lives server-side (contract-first design) so both clients stay thin/identical.
export function buildFillMissingPrompt(input: FillMissingInput): {
  system: string;
  user: string;
} {
  const system =
    "You help a frozen-pizza factory supervisor fill in blank production run-setup " +
    "fields with sensible, typical values. You are given the run's brand/flavor/die and " +
    "the fields already filled in, plus a list of blank fields that need a value. " +
    "For EACH blank field, propose one concrete value and a short, plain-language reason. " +
    "Use typical industry/product norms; never invent units or change fields not asked for. " +
    "For 'select' fields, choose ONLY from the provided options. For 'number' fields, return " +
    "a single non-negative number. Keep values realistic for a commercial pizza line. " +
    "These are suggestions only — the supervisor reviews and confirms each one.";

  const lines: string[] = [];
  lines.push(`PRODUCT: ${input.brand || "(blank)"} / ${input.flavor || "(blank)"}`);
  if (input.dieType) lines.push(`DIE/SIZE: ${input.dieType}`);

  if (input.context?.length) {
    lines.push("");
    lines.push("ALREADY KNOWN:");
    lines.push(
      input.context.map((c) => `- ${c.label} (${c.key}) = ${c.value}`).join("\n"),
    );
  }

  lines.push("");
  lines.push("BLANK FIELDS NEEDING A VALUE:");
  lines.push(
    input.fields
      .map((f) => {
        const opts = f.kind === "select" && f.options?.length
          ? ` options=[${f.options.join(", ")}]`
          : "";
        return `- key=${f.key} "${f.label}" kind=${f.kind}${opts}`;
      })
      .join("\n"),
  );

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"suggestions":[{"key":string,"value":string,"rationale":string}],"note":string}. ' +
      "Use the EXACT key strings shown above; never invent keys and only answer for the listed fields. " +
      "value is always a string (a plain number for number fields, one of the listed options for select fields). " +
      "rationale is one short sentence. If a field cannot be reasonably suggested, omit it and " +
      'briefly say so in "note".',
  );

  return { system, user: lines.join("\n") };
}
