import { AiMatchImportBody } from "@workspace/api-zod";
import * as z from "zod";

// Bounds so a single request can't blow up cost/latency or return junk. Mirrors
// the photo / optimize / fill-missing endpoint guards.
export const MAX_KNOWN_BRANDS = 300;
export const MAX_KNOWN_FLAVORS = 2000;
export const MAX_UNMATCHED_BRANDS = 100;
export const MAX_UNMATCHED_FLAVORS = 200;

export type MatchImportInput = z.infer<typeof AiMatchImportBody>;

export type MatchImportValidationResult =
  | { ok: true; data: MatchImportInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/match-import.
export function validateMatchImportBody(body: unknown): MatchImportValidationResult {
  const parsed = AiMatchImportBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  if (data.unmatchedBrands.length === 0 && data.unmatchedFlavors.length === 0) {
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
  if (data.unmatchedBrands.length > MAX_UNMATCHED_BRANDS) {
    return {
      ok: false,
      status: 400,
      error: `Too many unmatched brands (max ${MAX_UNMATCHED_BRANDS})`,
    };
  }
  if (data.unmatchedFlavors.length > MAX_UNMATCHED_FLAVORS) {
    return {
      ok: false,
      status: 400,
      error: `Too many unmatched flavors (max ${MAX_UNMATCHED_FLAVORS})`,
    };
  }
  return { ok: true, data };
}

export type BrandMatch = { candidate: string; match: string };
export type FlavorMatch = { brand: string; candidate: string; match: string };

// The model returns structured JSON but is not trustworthy: parse leniently
// (coerce strings, tolerate extras), then drop anything whose candidate was not
// asked for OR whose match is not a real saved option. A brand match must be one
// of the known brands; a flavor match must be one of that brand's saved flavors.
// The whole response collapses to empty if the top-level shape is wrong.
const BrandMatchSchema = z.object({
  candidate: z.coerce.string().optional(),
  match: z.coerce.string().optional(),
});
const FlavorMatchSchema = z.object({
  brand: z.coerce.string().optional(),
  candidate: z.coerce.string().optional(),
  match: z.coerce.string().optional(),
});
const ResponseSchema = z.object({
  brandMatches: z.array(z.unknown()).optional(),
  flavorMatches: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});

function findCanonical(value: string, options: readonly string[]): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return options.find((o) => o.trim().toLowerCase() === v) ?? null;
}

export function sanitizeMatchImport(
  raw: unknown,
  input: MatchImportInput,
): { brandMatches: BrandMatch[]; flavorMatches: FlavorMatch[]; note?: string } {
  const top = ResponseSchema.safeParse(raw);
  if (!top.success) return { brandMatches: [], flavorMatches: [] };

  // Lower-cased lookup sets for the candidates we actually asked about.
  const askedBrands = new Set(input.unmatchedBrands.map((b) => b.trim().toLowerCase()));
  const askedFlavors = new Set(
    input.unmatchedFlavors.map(
      (f) => `${f.brand.trim().toLowerCase()}|||${f.flavor.trim().toLowerCase()}`,
    ),
  );
  // Canonical brand name -> its saved flavor list, looked up case-insensitively.
  const brandFlavorsLower = new Map<string, string[]>();
  for (const [brand, flavors] of Object.entries(input.brandFlavors)) {
    brandFlavorsLower.set(brand.trim().toLowerCase(), flavors ?? []);
  }

  const brandMatches: BrandMatch[] = [];
  const seenBrand = new Set<string>();
  for (const item of top.data.brandMatches ?? []) {
    const parsed = BrandMatchSchema.safeParse(item);
    if (!parsed.success) continue;
    const candidate = (parsed.data.candidate ?? "").trim();
    const candKey = candidate.toLowerCase();
    if (!candidate || seenBrand.has(candKey) || !askedBrands.has(candKey)) continue;
    const match = findCanonical(parsed.data.match ?? "", input.brands);
    if (!match) continue; // hallucinated / not a real saved brand
    seenBrand.add(candKey);
    brandMatches.push({ candidate, match });
    if (brandMatches.length >= input.unmatchedBrands.length) break;
  }

  const flavorMatches: FlavorMatch[] = [];
  const seenFlavor = new Set<string>();
  for (const item of top.data.flavorMatches ?? []) {
    const parsed = FlavorMatchSchema.safeParse(item);
    if (!parsed.success) continue;
    const brand = (parsed.data.brand ?? "").trim();
    const candidate = (parsed.data.candidate ?? "").trim();
    if (!brand || !candidate) continue;
    const key = `${brand.toLowerCase()}|||${candidate.toLowerCase()}`;
    if (seenFlavor.has(key) || !askedFlavors.has(key)) continue;
    const opts = brandFlavorsLower.get(brand.toLowerCase()) ?? [];
    const match = findCanonical(parsed.data.match ?? "", opts);
    if (!match) continue; // not a real saved flavor under that brand
    seenFlavor.add(key);
    flavorMatches.push({ brand, candidate, match });
    if (flavorMatches.length >= input.unmatchedFlavors.length) break;
  }

  const note = (top.data.note ?? "").trim();
  return note ? { brandMatches, flavorMatches, note } : { brandMatches, flavorMatches };
}

// Shape the validated input into a compact, model-friendly prompt. Heavy shaping
// lives server-side (contract-first design) so both clients stay thin/identical.
export function buildMatchImportPrompt(input: MatchImportInput): {
  system: string;
  user: string;
} {
  const system =
    "You match imported spreadsheet brand and flavor names to a frozen-pizza " +
    "factory's EXISTING saved brands and flavors. The imported names are messy " +
    "(typos, abbreviations, extra words, different word order, plural/singular, " +
    "punctuation). For each unmatched name, pick the single best EXISTING option " +
    "that clearly refers to the same product. Only return a match when you are " +
    "confident it is the same thing — if nothing clearly fits, omit it (do NOT " +
    "guess). NEVER invent a brand or flavor: every match must be copied verbatim " +
    "from the provided saved lists. A flavor match must come from the flavors of " +
    "the brand it is listed under. These are suggestions only — the user reviews them.";

  const lines: string[] = [];
  lines.push("SAVED BRANDS:");
  lines.push(input.brands.length ? input.brands.map((b) => `- ${b}`).join("\n") : "(none)");

  lines.push("");
  lines.push("SAVED FLAVORS BY BRAND:");
  const flavorLines = Object.entries(input.brandFlavors)
    .filter(([, flavors]) => (flavors?.length ?? 0) > 0)
    .map(([brand, flavors]) => `- ${brand}: ${flavors.join(", ")}`);
  lines.push(flavorLines.length ? flavorLines.join("\n") : "(none)");

  if (input.unmatchedBrands.length) {
    lines.push("");
    lines.push("UNMATCHED IMPORTED BRANDS (match each to a SAVED BRAND if possible):");
    lines.push(input.unmatchedBrands.map((b) => `- "${b}"`).join("\n"));
  }

  if (input.unmatchedFlavors.length) {
    lines.push("");
    lines.push(
      "UNMATCHED IMPORTED FLAVORS (match each to a SAVED FLAVOR of the given brand if possible):",
    );
    lines.push(
      input.unmatchedFlavors.map((f) => `- brand "${f.brand}" flavor "${f.flavor}"`).join("\n"),
    );
  }

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"brandMatches":[{"candidate":string,"match":string}],' +
      '"flavorMatches":[{"brand":string,"candidate":string,"match":string}],"note":string}. ' +
      "candidate echoes the imported name EXACTLY as given above; match is copied EXACTLY " +
      "from the saved lists. For flavorMatches, brand echoes the given brand exactly. " +
      "Omit any item you are not confident about. Use \"note\" only for a brief overall comment.",
  );

  return { system, user: lines.join("\n") };
}
