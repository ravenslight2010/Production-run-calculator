import { IdentifyInventoryPhotoBody } from "@workspace/api-zod";
import * as z from "zod";

// Cost/abuse guards for the paid AI vision endpoint. The API is unauthenticated,
// so cap how large each request can be before it reaches the model.
// Base64 inflates by ~33%, so ~8M chars ≈ a ~6 MB source image — far above any
// normal phone photo, while staying under the 10mb express.json body limit so we
// return a clean 413 here instead of a parser error.
export const MAX_IMAGE_BASE64_CHARS = 8_000_000;
export const MAX_CANDIDATES = 1000;

export type PhotoGuessOut = {
  name: string;
  qty: number;
  unit: string;
  category: "ingredient" | "packaging";
  matchedKey: string | null;
  confidence: number;
};

// The vision model is unreliable, so validate its structured output with a
// lenient Zod schema (coerces numeric strings, tolerates missing optional
// fields) rather than trusting the raw JSON. Anything that fails per-item
// validation is dropped; the whole response collapses to [] if the top-level
// shape is wrong. Post-parse we still clamp confidence and scrub matchedKey
// against the candidates the client actually sent.
const VisionGuessSchema = z.object({
  name: z.coerce.string(),
  qty: z.coerce.number().optional(),
  unit: z.coerce.string().optional(),
  category: z.coerce.string().optional(),
  matchedKey: z.string().nullish(),
  confidence: z.coerce.number().optional(),
});
const VisionResponseSchema = z.object({
  items: z.array(z.unknown()).optional(),
});

export function sanitizeGuesses(
  raw: unknown,
  candidateKeys: Set<string>,
): PhotoGuessOut[] {
  const top = VisionResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: PhotoGuessOut[] = [];
  for (const item of top.data.items ?? []) {
    const parsed = VisionGuessSchema.safeParse(item);
    if (!parsed.success) continue;
    const g = parsed.data;
    const name = g.name.trim();
    if (!name) continue;
    const qty = g.qty != null && Number.isFinite(g.qty) && g.qty > 0 ? g.qty : 0;
    const unit = (g.unit ?? "").trim() || "units";
    const category =
      (g.category ?? "").trim().toLowerCase() === "packaging" ? "packaging" : "ingredient";
    let matchedKey = g.matchedKey ?? null;
    if (matchedKey != null && !candidateKeys.has(matchedKey)) matchedKey = null;
    let confidence = g.confidence ?? 0;
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));
    out.push({ name, qty, unit, category, matchedKey, confidence });
  }
  return out;
}

export type IdentifyPhotoInput = z.infer<typeof IdentifyInventoryPhotoBody>;

export type PhotoValidationResult =
  | { ok: true; data: IdentifyPhotoInput; candidateKeys: Set<string> }
  | { ok: false; status: number; error: string };

// Validate and normalize the request body for POST /inventory/identify-photo.
// Returns the parsed payload plus the candidate key set on success, or the
// HTTP status + error message the route should respond with on failure.
export function validateIdentifyPhotoBody(body: unknown): PhotoValidationResult {
  const parsed = IdentifyInventoryPhotoBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const { imageBase64, candidates } = parsed.data;
  if (!imageBase64 || imageBase64.length < 16) {
    return { ok: false, status: 400, error: "imageBase64 required" };
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return { ok: false, status: 413, error: "Image too large" };
  }
  if (candidates && candidates.length > MAX_CANDIDATES) {
    return { ok: false, status: 400, error: `Too many candidates (max ${MAX_CANDIDATES})` };
  }
  const candidateKeys = new Set((candidates ?? []).map((c) => c.key));
  return { ok: true, data: parsed.data, candidateKeys };
}
