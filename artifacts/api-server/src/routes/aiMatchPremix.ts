import { AiMatchPremixBody } from "@workspace/api-zod";
import { sanitizePremixMatches, type PremixMatch } from "@workspace/premix-import";
import * as z from "zod";

// Bounds so a single request can't blow up cost/latency or return junk. Mirrors
// the match-import / parse-spec endpoint guards.
export const MAX_KNOWN_BRANDS = 300;
export const MAX_KNOWN_FLAVORS = 2000;
export const MAX_UNMATCHED_NAMES = 200;

export type MatchPremixInput = z.infer<typeof AiMatchPremixBody>;

export type MatchPremixValidationResult =
  | { ok: true; data: MatchPremixInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/match-premix.
export function validateMatchPremixBody(body: unknown): MatchPremixValidationResult {
  const parsed = AiMatchPremixBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  if (data.unmatchedNames.length === 0) {
    return { ok: false, status: 400, error: "Nothing to match" };
  }
  if (data.brands.length > MAX_KNOWN_BRANDS) {
    return { ok: false, status: 400, error: `Too many brands (max ${MAX_KNOWN_BRANDS})` };
  }
  const totalFlavors = Object.values(data.brandFlavors).reduce(
    (acc, list) => acc + (list?.length ?? 0),
    0,
  );
  if (totalFlavors > MAX_KNOWN_FLAVORS) {
    return { ok: false, status: 400, error: `Too many flavors (max ${MAX_KNOWN_FLAVORS})` };
  }
  if (data.unmatchedNames.length > MAX_UNMATCHED_NAMES) {
    return {
      ok: false,
      status: 400,
      error: `Too many unmatched names (max ${MAX_UNMATCHED_NAMES})`,
    };
  }
  return { ok: true, data };
}

/**
 * Canonicalize the model's output back to the known brand/flavor lists (drop
 * hallucinated brands) AND drop any match for a product name we did not ask
 * about. The deterministic canonicalization lives in @workspace/premix-import so
 * the server sanitizer and the client's local grounding agree exactly. Never
 * throws.
 */
export function sanitizeMatchPremix(raw: unknown, input: MatchPremixInput): PremixMatch[] {
  const asked = new Set(input.unmatchedNames.map((n) => n.trim().toLowerCase()));
  const canonical = sanitizePremixMatches(raw, {
    brands: input.brands,
    flavorsByBrand: input.brandFlavors,
    ingredients: [],
  });
  return canonical.filter((m) => asked.has(m.name.trim().toLowerCase()));
}

// Shape the validated input into a compact, model-friendly prompt. Heavy shaping
// lives server-side (contract-first design) so both clients stay thin/identical.
export function buildMatchPremixPrompt(input: MatchPremixInput): {
  system: string;
  user: string;
} {
  const system =
    "You match imported premix-sheet PRODUCT names to a frozen-pizza factory's " +
    "EXISTING saved brands and flavors. Each imported name names a single pizza " +
    "product (e.g. a brand plus a flavor) but is messy (typos, abbreviations, " +
    "extra words like 'Mix' or 'Veggie', different word order, punctuation). For " +
    "each imported name, identify the saved BRAND it belongs to and, when clear, " +
    "the saved FLAVOR under that brand. Only return a result when you are " +
    "confident which existing brand it is — if no saved brand clearly fits, omit " +
    "it (do NOT guess). NEVER invent a brand or flavor: the brand must be copied " +
    "verbatim from the saved brand list and the flavor (if given) from that " +
    "brand's saved flavor list. These are suggestions only — the user reviews them.";

  const lines: string[] = [];
  lines.push("SAVED BRANDS:");
  lines.push(input.brands.length ? input.brands.map((b) => `- ${b}`).join("\n") : "(none)");

  lines.push("");
  lines.push("SAVED FLAVORS BY BRAND:");
  const flavorLines = Object.entries(input.brandFlavors)
    .filter(([, flavors]) => (flavors?.length ?? 0) > 0)
    .map(([brand, flavors]) => `- ${brand}: ${flavors.join(", ")}`);
  lines.push(flavorLines.length ? flavorLines.join("\n") : "(none)");

  lines.push("");
  lines.push("IMPORTED PREMIX NAMES (match each to a SAVED BRAND + FLAVOR if possible):");
  lines.push(input.unmatchedNames.map((n) => `- "${n}"`).join("\n"));

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"matches":[{"name":string,"brand":string,"flavor":string}],"note":string}. ' +
      "name echoes the imported premix name EXACTLY as given above; brand is copied " +
      "EXACTLY from the saved brand list; flavor is copied EXACTLY from that brand's " +
      "saved flavors (use an empty string if no saved flavor clearly fits). Omit any " +
      'name whose brand you are not confident about. Use "note" only for a brief overall comment.',
  );

  return { system, user: lines.join("\n") };
}
