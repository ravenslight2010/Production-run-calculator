import { ProductionSheetPhotoBody } from "@workspace/api-zod";
import * as z from "zod";
import { MAX_IMAGE_BASE64_CHARS } from "./photoIdentify";

// Re-export the shared image-size cap so route + tests reference one source of
// truth (this vision endpoint uses the same provider posture as the other
// photo endpoints).
export { MAX_IMAGE_BASE64_CHARS };

// Bound free-text context and how much the model can return, in the same spirit
// as the other AI endpoint guards.
export const MAX_NOTES_CHARS = 600;
export const MAX_FIELD_CHARS = 120;
export const MAX_ROWS = 40;

export type ProductionSheetRowOut = {
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
  date: string | null;
  confidence: number;
};

export type ProductionSheetInput = z.infer<typeof ProductionSheetPhotoBody>;

export type ProductionSheetValidationResult =
  | { ok: true; data: ProductionSheetInput }
  | { ok: false; status: number; error: string };

// Validate and normalize the request body for POST /inventory/production-sheet-photo.
// Same size/shape guards as the other photo endpoints (image required, not too
// short, under the provider cap).
export function validateProductionSheetBody(body: unknown): ProductionSheetValidationResult {
  const parsed = ProductionSheetPhotoBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const { imageBase64 } = parsed.data;
  if (!imageBase64 || imageBase64.length < 16) {
    return { ok: false, status: 400, error: "imageBase64 required" };
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return { ok: false, status: 413, error: "Image too large" };
  }
  return { ok: true, data: parsed.data };
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// Shape the validated input into a vision-friendly prompt. The model is asked to
// transcribe the run rows from a paper production sheet and return a strict JSON
// shape; it is explicitly told this is advisory only and that it must never
// claim to record, schedule, or change anything.
export function buildProductionSheetPrompt(input: ProductionSheetInput): {
  system: string;
  userText: string;
} {
  const system =
    "You are a production-sheet reader for a frozen-pizza factory. " +
    "You look at a photo of a paper production/run sheet and transcribe the distinct run " +
    "rows it lists. Read carefully and be conservative: only report rows you can actually " +
    "read, and use a LOW confidence when the handwriting/print is unclear or a field is " +
    "missing. This is an ADVISORY transcription only — you never schedule, record, or " +
    "change anything; a person reviews every row before it is used.";

  const lines: string[] = [];
  lines.push(
    "Transcribe the run rows from this production sheet. For each distinct run, read the " +
      "brand, the flavor/variety, the die size or crust spec, the number of cases to make, " +
      "and the date if one is shown for that run. Leave a field blank (empty string) or the " +
      "date null when you cannot read it — never guess a value.",
  );
  const notes = clamp(input.notes ?? "", MAX_NOTES_CHARS);
  if (notes) {
    lines.push("");
    lines.push(`CONTEXT FROM THE USER (consider this): ${notes}`);
  }
  lines.push("");
  lines.push(
    "Respond ONLY with JSON of the exact shape: " +
      '{"rows":[{"brand":string,"flavor":string,"dieType":string,"casesNeeded":number,' +
      '"date":string|null,"confidence":number}]}. ' +
      "dieType is the die size / crust spec as written (empty string if none). casesNeeded is " +
      "a whole number of cases (0 if not readable). date is an ISO date YYYY-MM-DD or null. " +
      "confidence is 0..1. If you cannot read any rows at all, return {\"rows\":[]}.",
  );

  return { system, userText: lines.join("\n") };
}

const RowSchema = z.object({
  brand: z.coerce.string().optional(),
  flavor: z.coerce.string().optional(),
  dieType: z.coerce.string().optional(),
  casesNeeded: z.coerce.number().optional(),
  date: z.string().nullish(),
  confidence: z.coerce.number().optional(),
});
const SheetSchema = z.object({
  rows: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});

// Accept only a YYYY-MM-DD date; anything else collapses to null so a garbled
// date never reaches the schedule path.
function normDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

// The vision model is unreliable, so validate its structured output leniently
// rather than trusting the raw JSON. Each row needs at least a brand or flavor
// to be useful; cases are clamped to a non-negative integer, confidence to
// 0..1, and free-text is trimmed + clamped. Rows are capped. Always returns a
// usable array so a formatting slip never collapses a real reply.
export function sanitizeSheetRows(raw: unknown): {
  rows: ProductionSheetRowOut[];
  note?: string;
} {
  const top = SheetSchema.safeParse(raw);
  if (!top.success) return { rows: [] };
  const out: ProductionSheetRowOut[] = [];
  for (const item of top.data.rows ?? []) {
    if (out.length >= MAX_ROWS) break;
    const parsed = RowSchema.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    const brand = clamp(r.brand ?? "", MAX_FIELD_CHARS);
    const flavor = clamp(r.flavor ?? "", MAX_FIELD_CHARS);
    if (!brand && !flavor) continue;
    const dieType = clamp(r.dieType ?? "", MAX_FIELD_CHARS);
    let casesNeeded = r.casesNeeded ?? 0;
    if (!Number.isFinite(casesNeeded) || casesNeeded < 0) casesNeeded = 0;
    casesNeeded = Math.round(casesNeeded);
    let confidence = r.confidence ?? 0;
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));
    out.push({ brand, flavor, dieType, casesNeeded, date: normDate(r.date), confidence });
  }
  const note = clamp(top.data.note ?? "", MAX_NOTES_CHARS);
  return note ? { rows: out, note } : { rows: out };
}
