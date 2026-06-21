import { QualityCheckPhotoBody } from "@workspace/api-zod";
import * as z from "zod";
import { MAX_IMAGE_BASE64_CHARS } from "./photoIdentify";

// Re-export the shared image-size cap so route + tests reference one source of
// truth (the quality endpoint uses the same vision-provider posture as the
// stock-intake photo endpoint).
export { MAX_IMAGE_BASE64_CHARS };

// Bound how much free-text context the user can attach and how much the model
// can return, in the same spirit as the other AI endpoint guards.
export const MAX_NOTES_CHARS = 600;
export const MAX_SUMMARY_CHARS = 600;
export const MAX_ISSUE_TYPE_CHARS = 60;
export const MAX_ISSUE_DETAIL_CHARS = 300;
export const MAX_ISSUES = 12;

export type QualityStatus = "pass" | "warn" | "fail";
export type QualitySeverity = "minor" | "major" | "critical";

export type QualityIssueOut = {
  type: string;
  severity: QualitySeverity;
  detail: string;
};

export type QualityAssessmentOut = {
  summary: string;
  status: QualityStatus;
  confidence: number;
  issues: QualityIssueOut[];
};

export type QualityCheckInput = z.infer<typeof QualityCheckPhotoBody>;

export type QualityValidationResult =
  | { ok: true; data: QualityCheckInput }
  | { ok: false; status: number; error: string };

// Validate and normalize the request body for POST /inventory/quality-photo.
// Same size/shape guards as the stock-intake photo endpoint (image required,
// not too short, under the provider cap). Returns the parsed payload on success
// or the HTTP status + message the route should respond with on failure.
export function validateQualityPhotoBody(body: unknown): QualityValidationResult {
  const parsed = QualityCheckPhotoBody.safeParse(body);
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
// assess a finished product for quality/defects and return a strict JSON shape;
// it is explicitly told this is advisory only and that it must never claim to
// record or change anything.
export function buildQualityPrompt(input: QualityCheckInput): {
  system: string;
  userText: string;
} {
  const product =
    input.productType === "crust"
      ? "a finished pizza crust (par-baked or pressed shell)"
      : input.productType === "other"
        ? "a finished product"
        : "a finished pizza";

  const system =
    "You are a quality-control assistant for a frozen-pizza production facility. " +
    `You look at a photo of ${product} and assess its quality and any visible defects. ` +
    "Focus on: overall size/diameter and shape (round, even, not undersized/oversized), " +
    "topping coverage and distribution (sauce, cheese, pepperoni — even, complete, not bare " +
    "or overloaded), and appearance defects (burning, raw/pale spots, broken/cracked crust, " +
    "off-center toppings, foreign material). " +
    "Be conservative and honest: only call out what you can actually see, and use a LOW " +
    "confidence when the photo is unclear or you are unsure. This is an ADVISORY check only — " +
    "you never record, grade, accept, or reject anything; a person reviews your assessment.";

  const lines: string[] = [];
  lines.push(
    "Assess the product in this photo for quality and visible defects. " +
      "Decide an overall status: \"pass\" (looks good, no real issues), \"warn\" (minor " +
      "issues worth noting), or \"fail\" (clear defects). List each specific issue you see.",
  );
  const notes = clamp(input.notes ?? "", MAX_NOTES_CHARS);
  if (notes) {
    lines.push("");
    lines.push(`CONTEXT FROM THE USER (consider this): ${notes}`);
  }
  lines.push("");
  lines.push(
    "Respond ONLY with JSON of the exact shape: " +
      '{"summary":string,"status":"pass"|"warn"|"fail","confidence":number,' +
      '"issues":[{"type":string,"severity":"minor"|"major"|"critical","detail":string}]}. ' +
      "summary is one or two plain-language sentences. confidence is 0..1. " +
      "type is a short category (e.g. size, topping coverage, appearance, burn). " +
      'If the product looks good, return status "pass" with an empty issues array. ' +
      "If you cannot assess the photo at all (too dark/blurry/not a product), return a low " +
      'confidence, status "warn", and explain in summary.',
  );

  return { system, userText: lines.join("\n") };
}

function mapStatus(raw: string | undefined): QualityStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("fail") || s.startsWith("rej")) return "fail";
  if (s.startsWith("warn") || s.startsWith("caut")) return "warn";
  if (s.startsWith("pass") || s.startsWith("ok") || s.startsWith("good")) return "pass";
  return "warn";
}

function mapSeverity(raw: string | undefined): QualitySeverity {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("crit") || s.startsWith("sev")) return "critical";
  if (s.startsWith("maj") || s.startsWith("high")) return "major";
  return "minor";
}

const IssueSchema = z.object({
  type: z.coerce.string().optional(),
  severity: z.coerce.string().optional(),
  detail: z.coerce.string().optional(),
});
const AssessmentSchema = z.object({
  summary: z.coerce.string().optional(),
  status: z.coerce.string().optional(),
  confidence: z.coerce.number().optional(),
  issues: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});

// The vision model is unreliable, so validate its structured output leniently
// rather than trusting the raw JSON. Confidence is clamped to 0..1, status and
// severities are mapped to the allowed enums, free-text is trimmed + clamped,
// and malformed issues are dropped. Always returns a usable assessment so a
// formatting slip never collapses a real reply.
export function sanitizeAssessment(raw: unknown): {
  assessment: QualityAssessmentOut;
  note?: string;
} {
  const top = AssessmentSchema.safeParse(raw);
  const empty: QualityAssessmentOut = {
    summary: "",
    status: "warn",
    confidence: 0,
    issues: [],
  };
  if (!top.success) return { assessment: empty };
  const a = top.data;

  const issues: QualityIssueOut[] = [];
  for (const item of a.issues ?? []) {
    if (issues.length >= MAX_ISSUES) break;
    const parsed = IssueSchema.safeParse(item);
    if (!parsed.success) continue;
    const detail = clamp(parsed.data.detail ?? "", MAX_ISSUE_DETAIL_CHARS);
    if (!detail) continue;
    const type = clamp(parsed.data.type ?? "", MAX_ISSUE_TYPE_CHARS) || "issue";
    issues.push({ type, severity: mapSeverity(parsed.data.severity), detail });
  }

  let confidence = a.confidence ?? 0;
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const assessment: QualityAssessmentOut = {
    summary: clamp(a.summary ?? "", MAX_SUMMARY_CHARS),
    status: mapStatus(a.status),
    confidence,
    issues,
  };
  const note = clamp(a.note ?? "", MAX_NOTES_CHARS);
  return note ? { assessment, note } : { assessment };
}
