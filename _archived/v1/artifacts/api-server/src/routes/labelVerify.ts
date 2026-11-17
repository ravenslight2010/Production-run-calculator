import { VerifyLabelPhotoBody } from "@workspace/api-zod";
import * as z from "zod";
import { MAX_IMAGE_BASE64_CHARS } from "./photoIdentify";

// Re-export the shared image-size cap so route + tests reference one source of
// truth (this vision endpoint uses the same provider posture as the other
// photo endpoints).
export { MAX_IMAGE_BASE64_CHARS };

export const MAX_NOTES_CHARS = 600;
export const MAX_SUMMARY_CHARS = 600;
export const MAX_VALUE_CHARS = 160;

export type LabelVerdict = "pass" | "warn" | "fail";
export type LabelFieldMatch = "match" | "mismatch" | "unreadable";

// The fields we ask the model to read + compare, in display order. The label
// prompt and per-field sanitizing both key off this list so the wire shape is
// deterministic regardless of what the model returns.
export const LABEL_FIELDS = [
  "brand",
  "flavor",
  "dieType",
  "date",
  "lotCode",
  "caseCount",
] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

const FIELD_LABELS: Record<LabelField, string> = {
  brand: "brand",
  flavor: "flavor",
  dieType: "die size",
  date: "date",
  lotCode: "lot code",
  caseCount: "case count",
};

export type LabelFieldCheckOut = {
  field: string;
  expected: string | null;
  observed: string | null;
  match: LabelFieldMatch;
};

export type LabelVerifyResultOut = {
  verdict: LabelVerdict;
  summary: string;
  confidence: number;
  fields: LabelFieldCheckOut[];
};

export type LabelVerifyInput = z.infer<typeof VerifyLabelPhotoBody>;

export type LabelVerifyValidationResult =
  | { ok: true; data: LabelVerifyInput }
  | { ok: false; status: number; error: string };

// Validate and normalize the request body for POST /inventory/label-verify.
// Same size/shape guards as the other photo endpoints.
export function validateLabelVerifyBody(body: unknown): LabelVerifyValidationResult {
  const parsed = VerifyLabelPhotoBody.safeParse(body);
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

// Normalize an expected-value map into clamped strings keyed by LABEL_FIELD,
// dropping blanks. caseCount becomes its string form. Returned in field order.
export function expectedToMap(
  expected: LabelVerifyInput["expected"] | undefined,
): Partial<Record<LabelField, string>> {
  const out: Partial<Record<LabelField, string>> = {};
  if (!expected) return out;
  for (const field of LABEL_FIELDS) {
    const raw = field === "caseCount" ? expected.caseCount : expected[field];
    if (raw == null) continue;
    const val = clamp(String(raw), MAX_VALUE_CHARS);
    if (val) out[field] = val;
  }
  return out;
}

// Shape the validated input into a vision-friendly prompt. The model is asked to
// read the label fields and compare each provided expected value, returning a
// strict JSON shape. Explicitly advisory: it never accepts/rejects anything.
export function buildLabelVerifyPrompt(input: LabelVerifyInput): {
  system: string;
  userText: string;
} {
  const expected = expectedToMap(input.expected);

  const system =
    "You are a label/pallet verification assistant for a frozen-pizza factory. " +
    "You look at a photo of a finished-product label or pallet placard, read the visible " +
    "fields, and compare them against the expected values provided. Be conservative and " +
    "honest: read only what you can actually see, and mark a field unreadable rather than " +
    "guessing. This is an ADVISORY check only — you never accept, reject, ship, or hold " +
    "anything; a person reviews your result and decides what to do.";

  const lines: string[] = [];
  const expectedLines = LABEL_FIELDS.filter((f) => expected[f] != null).map(
    (f) => `- ${FIELD_LABELS[f]} (${f}): "${expected[f]}"`,
  );
  if (expectedLines.length) {
    lines.push("EXPECTED VALUES (compare the label against these):");
    lines.push(expectedLines.join("\n"));
  } else {
    lines.push(
      "No expected values were provided — just read the label fields you can see and report them.",
    );
  }
  const notes = clamp(input.notes ?? "", MAX_NOTES_CHARS);
  if (notes) {
    lines.push("");
    lines.push(`CONTEXT FROM THE USER (consider this): ${notes}`);
  }
  lines.push("");
  lines.push(
    "Read these label fields and compare each to the expected value when one is given: " +
      "brand, flavor, dieType (die size), date, lotCode, caseCount. " +
      "Respond ONLY with JSON of the exact shape: " +
      '{"verdict":"pass"|"warn"|"fail","summary":string,"confidence":number,' +
      '"fields":[{"field":string,"observed":string|null,"match":"match"|"mismatch"|"unreadable"}]}. ' +
      'For each field, set observed to what you read (null if you cannot read it). Set match to ' +
      '"match" when it agrees with the expected value, "mismatch" when it clearly differs, or ' +
      '"unreadable" when you could not read it (or no expected value was given to compare). ' +
      'verdict is "pass" when every compared field matches, "fail" when any clearly mismatches, ' +
      'and "warn" when something is unreadable/uncertain but nothing clearly mismatches. ' +
      "summary is one or two plain-language sentences. confidence is 0..1.",
  );

  return { system, userText: lines.join("\n") };
}

function mapVerdict(raw: string | undefined): LabelVerdict {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("fail") || s.startsWith("rej") || s.startsWith("mismatch")) return "fail";
  if (s.startsWith("pass") || s.startsWith("ok") || s.startsWith("match")) return "pass";
  return "warn";
}

function mapMatch(raw: string | undefined): LabelFieldMatch {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("match") || s === "ok" || s === "pass") return "match";
  if (s.startsWith("mismatch") || s.startsWith("diff") || s.startsWith("fail")) return "mismatch";
  return "unreadable";
}

const FieldSchema = z.object({
  field: z.coerce.string().optional(),
  observed: z.string().nullish(),
  match: z.coerce.string().optional(),
});
const VerifySchema = z.object({
  verdict: z.coerce.string().optional(),
  summary: z.coerce.string().optional(),
  confidence: z.coerce.number().optional(),
  fields: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});

// The vision model is unreliable, so canonicalize its output deterministically:
// one row per KNOWN field (in fixed order), expected values come from the server
// (never trusted from the model), observed is clamped, match is mapped to the
// allowed enum, and the overall verdict is RECOMPUTED from the per-field results
// rather than trusting the model's verdict — so a "pass" can never hide a
// mismatch. Always returns a usable result.
export function sanitizeLabelVerification(
  raw: unknown,
  expected: Partial<Record<LabelField, string>>,
): { result: LabelVerifyResultOut; note?: string } {
  const top = VerifySchema.safeParse(raw);
  const fallback: LabelVerifyResultOut = {
    verdict: "warn",
    summary: "",
    confidence: 0,
    fields: LABEL_FIELDS.map((field) => ({
      field,
      expected: expected[field] ?? null,
      observed: null,
      match: "unreadable" as LabelFieldMatch,
    })),
  };
  if (!top.success) return { result: fallback };
  const a = top.data;

  // Index the model's field rows by normalized field name.
  const observedByField = new Map<string, { observed: string | null; match: LabelFieldMatch }>();
  for (const item of a.fields ?? []) {
    const parsed = FieldSchema.safeParse(item);
    if (!parsed.success) continue;
    const key = (parsed.data.field ?? "").trim().toLowerCase();
    if (!key) continue;
    const matchField = LABEL_FIELDS.find((f) => f.toLowerCase() === key);
    if (!matchField || observedByField.has(matchField)) continue;
    const observedRaw = parsed.data.observed;
    const observed =
      typeof observedRaw === "string" && observedRaw.trim()
        ? clamp(observedRaw, MAX_VALUE_CHARS)
        : null;
    observedByField.set(matchField, { observed, match: mapMatch(parsed.data.match) });
  }

  const fields: LabelFieldCheckOut[] = LABEL_FIELDS.map((field) => {
    const exp = expected[field] ?? null;
    const seen = observedByField.get(field);
    let match: LabelFieldMatch = seen?.match ?? "unreadable";
    // Only fields with an expected value can be a true match/mismatch; without
    // an expected value the comparison is moot, so it's "unreadable" (i.e. not
    // checked) regardless of what the model claimed.
    if (exp == null) match = "unreadable";
    else if (seen?.observed == null) match = "unreadable";
    return { field, expected: exp, observed: seen?.observed ?? null, match };
  });

  // Recompute verdict from the per-field results (never trust the model's).
  const compared = fields.filter((f) => f.expected != null);
  const anyMismatch = compared.some((f) => f.match === "mismatch");
  const anyUnreadable = compared.some((f) => f.match === "unreadable");
  let verdict: LabelVerdict;
  if (compared.length === 0) verdict = mapVerdict(a.verdict);
  else if (anyMismatch) verdict = "fail";
  else if (anyUnreadable) verdict = "warn";
  else verdict = "pass";

  let confidence = a.confidence ?? 0;
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const result: LabelVerifyResultOut = {
    verdict,
    summary: clamp(a.summary ?? "", MAX_SUMMARY_CHARS),
    confidence,
    fields,
  };
  const note = clamp(a.note ?? "", MAX_NOTES_CHARS);
  return note ? { result, note } : { result };
}
