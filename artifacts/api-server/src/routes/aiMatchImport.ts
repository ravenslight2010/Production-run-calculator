import { AiMatchImportBody } from "@workspace/api-zod";
import {
  canonicalize,
  specImportBrandMatchKey,
  specImportNameMatchKey,
} from "@workspace/spec-import";
import * as z from "zod";

// Bounds so a single request can't blow up cost/latency or return junk. Mirrors
// the photo / optimize / fill-missing endpoint guards.
export const MAX_KNOWN_BRANDS = 300;
export const MAX_KNOWN_FLAVORS = 2000;
export const MAX_UNMATCHED_BRANDS = 100;
export const MAX_UNMATCHED_FLAVORS = 200;
export const MAX_KNOWN_INGREDIENTS = 3000;
export const MAX_KNOWN_TYPES = 500;
export const MAX_UNMATCHED_INGREDIENTS = 300;
export const MAX_UNMATCHED_TYPES = 100;

export type MatchImportInput = z.infer<typeof AiMatchImportBody>;

// The brand/flavor fields are required by the contract; the ingredient /
// applicator / pepperoni fields are an additive, optional extension, so normalize
// them to concrete arrays/maps up front to keep the rest of the file tidy.
function ingredientCandidates(input: MatchImportInput): { kind: "dough" | "sauce" | "cheese"; name: string }[] {
  return (input.unmatchedIngredients ?? []) as { kind: "dough" | "sauce" | "cheese"; name: string }[];
}
function knownIngredientsFor(input: MatchImportInput, kind: string): string[] {
  return (input.knownIngredients ?? {})[kind] ?? [];
}

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
  const ingCands = data.unmatchedIngredients ?? [];
  const appCands = data.unmatchedAppTypes ?? [];
  const pepCands = data.unmatchedPepTypes ?? [];
  if (
    data.unmatchedBrands.length === 0 &&
    data.unmatchedFlavors.length === 0 &&
    ingCands.length === 0 &&
    appCands.length === 0 &&
    pepCands.length === 0
  ) {
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
  const totalKnownIngredients = Object.values(data.knownIngredients ?? {}).reduce(
    (acc, list) => acc + (list?.length ?? 0),
    0,
  );
  if (totalKnownIngredients > MAX_KNOWN_INGREDIENTS) {
    return { ok: false, status: 400, error: `Too many ingredients (max ${MAX_KNOWN_INGREDIENTS})` };
  }
  if ((data.knownAppTypes ?? []).length > MAX_KNOWN_TYPES) {
    return { ok: false, status: 400, error: `Too many applicator types (max ${MAX_KNOWN_TYPES})` };
  }
  if ((data.knownPepTypes ?? []).length > MAX_KNOWN_TYPES) {
    return { ok: false, status: 400, error: `Too many pepperoni types (max ${MAX_KNOWN_TYPES})` };
  }
  if (ingCands.length > MAX_UNMATCHED_INGREDIENTS) {
    return {
      ok: false,
      status: 400,
      error: `Too many unmatched ingredients (max ${MAX_UNMATCHED_INGREDIENTS})`,
    };
  }
  if (appCands.length > MAX_UNMATCHED_TYPES || pepCands.length > MAX_UNMATCHED_TYPES) {
    return {
      ok: false,
      status: 400,
      error: `Too many unmatched types (max ${MAX_UNMATCHED_TYPES})`,
    };
  }
  return { ok: true, data };
}

export type BrandMatch = { candidate: string; match: string };
export type FlavorMatch = { brand: string; candidate: string; match: string };
export type NameMatch = { candidate: string; match: string };
export type IngredientMatch = { kind: "dough" | "sauce" | "cheese"; candidate: string; match: string };

export type DeterministicMatchImportResult = {
  resolved: {
    brandMatches: BrandMatch[];
    flavorMatches: FlavorMatch[];
    ingredientMatches: IngredientMatch[];
    appTypeMatches: NameMatch[];
    pepTypeMatches: NameMatch[];
  };
  unresolved: MatchImportInput;
};

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
  ingredientMatches: z.array(z.unknown()).optional(),
  appTypeMatches: z.array(z.unknown()).optional(),
  pepTypeMatches: z.array(z.unknown()).optional(),
  note: z.coerce.string().optional(),
});
const IngredientMatchSchema = z.object({
  kind: z.coerce.string().optional(),
  candidate: z.coerce.string().optional(),
  match: z.coerce.string().optional(),
});
const NameMatchSchema = z.object({
  candidate: z.coerce.string().optional(),
  match: z.coerce.string().optional(),
});

function findCanonical(value: string, options: readonly string[]): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return options.find((o) => o.trim().toLowerCase() === v) ?? null;
}

/**
 * Resolve the high-confidence part of an import match request without a model.
 * The client normally performs this pass already, but keeping it at the route
 * boundary makes the cost gate trustworthy for older clients and for callers
 * that construct the request directly.
 *
 * Loose-key matches are accepted only when they identify one saved option.
 * The shared canonicalizer then supplies its guarded fuzzy layer. Fuzzy matches
 * are suggestions, not learned aliases, and brand product-line conflicts remain
 * blocked by the same safety rule used for model output.
 */
export function resolveDeterministicMatchImport(
  input: MatchImportInput,
): DeterministicMatchImportResult {
  const resolveName = (
    candidate: string,
    options: readonly string[],
    kind:
      | "brand"
      | "flavor"
      | "doughIngredient"
      | "sauceIngredient"
      | "cheeseIngredient"
      | "appType"
      | "pepType",
  ): string | null => {
    const raw = candidate.trim();
    if (!raw) return null;
    const keyOf = kind === "brand" ? specImportBrandMatchKey : specImportNameMatchKey;
    const key = keyOf(raw);
    const looseHits = options.filter((option) => key && keyOf(option) === key);
    if (looseHits.length === 1) return looseHits[0]!;
    const result = canonicalize(raw, options, [], kind);
    return result.source === "new" ? null : result.value;
  };

  const brandMatches: BrandMatch[] = [];
  const unresolvedBrands: string[] = [];
  for (const candidate of input.unmatchedBrands) {
    const match = resolveName(candidate, input.brands, "brand");
    if (match && !conflictingProductLine(candidate, match)) brandMatches.push({ candidate, match });
    else unresolvedBrands.push(candidate);
  }

  const flavorMatches: FlavorMatch[] = [];
  const unresolvedFlavors: MatchImportInput["unmatchedFlavors"] = [];
  for (const item of input.unmatchedFlavors) {
    const brand = resolveName(item.brand, input.brands, "brand");
    const options = brand
      ? input.brandFlavors[brand] ?? input.brandFlavors[item.brand] ?? []
      : [];
    const match = resolveName(item.flavor, options, "flavor");
    if (brand && match) flavorMatches.push({ brand, candidate: item.flavor, match });
    else unresolvedFlavors.push(item);
  }

  const ingredientMatches: IngredientMatch[] = [];
  const unresolvedIngredients: NonNullable<MatchImportInput["unmatchedIngredients"]> = [];
  for (const item of input.unmatchedIngredients ?? []) {
    const options = input.knownIngredients?.[item.kind] ?? [];
    const match = resolveName(item.name, options, `${item.kind}Ingredient`);
    if (match) ingredientMatches.push({ kind: item.kind, candidate: item.name, match });
    else unresolvedIngredients.push(item);
  }

  const resolveFlat = (
    candidates: readonly string[],
    options: readonly string[],
  ): { matches: NameMatch[]; unresolved: string[] } => {
    const matches: NameMatch[] = [];
    const unresolved: string[] = [];
    for (const candidate of candidates) {
      const match = resolveName(candidate, options, "appType");
      if (match) matches.push({ candidate, match });
      else unresolved.push(candidate);
    }
    return { matches, unresolved };
  };
  const app = resolveFlat(input.unmatchedAppTypes ?? [], input.knownAppTypes ?? []);
  const pep = resolveFlat(input.unmatchedPepTypes ?? [], input.knownPepTypes ?? []);

  return {
    resolved: {
      brandMatches,
      flavorMatches,
      ingredientMatches,
      appTypeMatches: app.matches,
      pepTypeMatches: pep.matches,
    },
    unresolved: {
      ...input,
      unmatchedBrands: unresolvedBrands,
      unmatchedFlavors: unresolvedFlavors,
      unmatchedIngredients: unresolvedIngredients,
      unmatchedAppTypes: app.unresolved,
      unmatchedPepTypes: pep.unresolved,
    },
  };
}

// Product-line qualifiers that make two same-company brands DIFFERENT products
// (e.g. "Basha's Original" vs "Basha's Ultra Thin Crust"). Multi-word phrases are
// listed before their single-word substrings so the longest phrase wins and its
// substring isn't double-counted from the same span.
const PRODUCT_LINE_QUALIFIERS = [
  "ultra thin crust",
  "ultra thin",
  "thin crust",
  "deep dish",
  "gluten free",
  "hand tossed",
  "stuffed crust",
  "brick oven",
  "wood fired",
  "new york style",
  "original",
  "classic",
  "traditional",
  "thin",
  "pan",
] as const;

function normalizeBrandText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function productLineQualifiers(name: string): Set<string> {
  let text = ` ${normalizeBrandText(name)} `;
  const found = new Set<string>();
  for (const q of PRODUCT_LINE_QUALIFIERS) {
    const needle = ` ${q} `;
    if (text.includes(needle)) {
      found.add(q);
      // Blank out the matched span so a shorter substring qualifier (e.g. "thin")
      // isn't also counted from inside a longer one (e.g. "ultra thin crust").
      text = text.split(needle).join("  ");
    }
  }
  return found;
}

// Generic words carrying no brand identity — dropped before the structural
// comparison so "Basha Pizzas" == "Basha" and "Basha Foods" == "Basha".
const GENERIC_BRAND_WORDS = new Set([
  "pizza",
  "pizzas",
  "recipe",
  "recipes",
  "spec",
  "specs",
  "co",
  "inc",
  "llc",
  "ltd",
  "company",
  "foods",
  "brand",
  "brands",
  "the",
]);

// Distinguishing tokens of a brand: normalized, generic/noise words removed.
function brandTokens(name: string): string[] {
  return normalizeBrandText(name)
    .split(" ")
    .filter((t) => t.length > 1 && !GENERIC_BRAND_WORDS.has(t));
}

// Two brand names refer to DIFFERENT product lines and the match AI must NOT fold
// them together (or their identical flavor names overwrite each other). This is a
// deterministic safety net so the guarantee does not depend on the model obeying
// the prompt. Two complementary signals, EITHER of which flags a conflict:
//   1. Lexicon: their known product-line qualifier sets differ (Original / Ultra
//      Thin / Deep Dish / …), including qualified-vs-bare. Catches sibling lines
//      even when the company stem itself is typo'd apart.
//   2. Structural (dictionary-free): after a shared leading company stem, the
//      names diverge into distinct distinguishing tokens (e.g. "Basha Stone
//      Fired" vs "Basha Artisan", or a qualified extension of a bare sibling).
//      Catches product-line qualifiers not in the lexicon.
// Identical distinguishing-token sets (typos/word-order/generic-suffix only) are
// NOT a conflict, so genuine typo matches still go through.
export function conflictingProductLine(a: string, b: string): boolean {
  const qa = productLineQualifiers(a);
  const qb = productLineQualifiers(b);
  if (qa.size !== qb.size) return true;
  for (const q of qa) if (!qb.has(q)) return true;

  const ta = brandTokens(a);
  const tb = brandTokens(b);
  if (!ta.length || !tb.length) return false;

  const sa = new Set(ta);
  const sb = new Set(tb);
  if (sa.size === sb.size && [...sa].every((t) => sb.has(t))) return false;

  // Diverge only after a shared company stem; a differing FIRST token is treated
  // as a company-name typo (let the AI/fuzzy layers decide), not a line split.
  let i = 0;
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) i++;
  if (i === 0) return false;
  return ta.length > i || tb.length > i;
}

export function sanitizeMatchImport(
  raw: unknown,
  input: MatchImportInput,
): {
  brandMatches: BrandMatch[];
  flavorMatches: FlavorMatch[];
  ingredientMatches: IngredientMatch[];
  appTypeMatches: NameMatch[];
  pepTypeMatches: NameMatch[];
  note?: string;
} {
  const top = ResponseSchema.safeParse(raw);
  if (!top.success) {
    return {
      brandMatches: [],
      flavorMatches: [],
      ingredientMatches: [],
      appTypeMatches: [],
      pepTypeMatches: [],
    };
  }

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
    // Never fold a qualified product-line sibling onto a differently-qualified
    // (or bare) saved brand — e.g. "Basha's Ultra Thin Crust" must not merge into
    // "Basha's Original" or "Basha", or their shared flavor names collide.
    if (conflictingProductLine(candidate, match)) continue;
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

  // Recipe-kind-scoped ingredient matches: candidate must have been asked under
  // that kind; match must be a saved ingredient in that kind's known pool.
  const ingCands = ingredientCandidates(input);
  const askedIngredients = new Set(
    ingCands.map((c) => `${c.kind}|||${c.name.trim().toLowerCase()}`),
  );
  const ingredientMatches: IngredientMatch[] = [];
  const seenIngredient = new Set<string>();
  for (const item of top.data.ingredientMatches ?? []) {
    const parsed = IngredientMatchSchema.safeParse(item);
    if (!parsed.success) continue;
    const kind = (parsed.data.kind ?? "").trim().toLowerCase();
    if (kind !== "dough" && kind !== "sauce" && kind !== "cheese") continue;
    const candidate = (parsed.data.candidate ?? "").trim();
    if (!candidate) continue;
    const key = `${kind}|||${candidate.toLowerCase()}`;
    if (seenIngredient.has(key) || !askedIngredients.has(key)) continue;
    const match = findCanonical(parsed.data.match ?? "", knownIngredientsFor(input, kind));
    if (!match) continue;
    seenIngredient.add(key);
    ingredientMatches.push({ kind, candidate, match });
    if (ingredientMatches.length >= ingCands.length) break;
  }

  const collectFlatMatches = (
    items: unknown[],
    asked: ReadonlyArray<string>,
    known: ReadonlyArray<string>,
  ): NameMatch[] => {
    const askedSet = new Set(asked.map((a) => a.trim().toLowerCase()));
    const seen = new Set<string>();
    const out: NameMatch[] = [];
    for (const item of items) {
      const parsed = NameMatchSchema.safeParse(item);
      if (!parsed.success) continue;
      const candidate = (parsed.data.candidate ?? "").trim();
      const candKey = candidate.toLowerCase();
      if (!candidate || seen.has(candKey) || !askedSet.has(candKey)) continue;
      const match = findCanonical(parsed.data.match ?? "", known);
      if (!match) continue;
      seen.add(candKey);
      out.push({ candidate, match });
      if (out.length >= asked.length) break;
    }
    return out;
  };

  const appTypeMatches = collectFlatMatches(
    top.data.appTypeMatches ?? [],
    input.unmatchedAppTypes ?? [],
    input.knownAppTypes ?? [],
  );
  const pepTypeMatches = collectFlatMatches(
    top.data.pepTypeMatches ?? [],
    input.unmatchedPepTypes ?? [],
    input.knownPepTypes ?? [],
  );

  const note = (top.data.note ?? "").trim();
  const base = { brandMatches, flavorMatches, ingredientMatches, appTypeMatches, pepTypeMatches };
  return note ? { ...base, note } : base;
}

// Shape the validated input into a compact, model-friendly prompt. Heavy shaping
// lives server-side (contract-first design) so both clients stay thin/identical.
export function buildMatchImportPrompt(input: MatchImportInput): {
  system: string;
  user: string;
} {
  const system =
    "You match imported spreadsheet names to a frozen-pizza factory's EXISTING " +
    "saved names (brands, flavors, recipe ingredients, applicator/topping types, " +
    "pepperoni types). The imported names are messy " +
    "(typos, abbreviations, extra words, different word order, plural/singular, " +
    "punctuation). For each unmatched name, pick the single best EXISTING option " +
    "that clearly refers to the same thing. Only return a match when you are " +
    "confident it is the same thing — if nothing clearly fits, omit it (do NOT " +
    "guess). NEVER invent a name: every match must be copied verbatim " +
    "from the provided saved lists. NEVER fold a brand that carries a product-line " +
    "qualifier (Original, Ultra Thin, Thin Crust, Deep Dish, Gluten Free, etc.) " +
    "onto a saved brand with a DIFFERENT qualifier or none at all — 'Basha's Ultra " +
    "Thin Crust' is NOT 'Basha's Original' and NOT a bare 'Basha'; leave it " +
    "unmatched so it stays a separate brand. A flavor match must come from the flavors of " +
    "the brand it is listed under, and an ingredient match must come from the " +
    "saved ingredients of the same recipe kind. These are suggestions only — the user reviews them.";

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

  const ingCands = ingredientCandidates(input);
  const appCands = input.unmatchedAppTypes ?? [];
  const pepCands = input.unmatchedPepTypes ?? [];

  if (ingCands.length) {
    lines.push("");
    lines.push("SAVED INGREDIENTS BY RECIPE KIND:");
    for (const kind of ["dough", "sauce", "cheese"] as const) {
      const known = knownIngredientsFor(input, kind);
      if (known.length) lines.push(`- ${kind}: ${known.join(", ")}`);
    }
    lines.push("");
    lines.push(
      "UNMATCHED IMPORTED INGREDIENTS (match each to a SAVED INGREDIENT of the given recipe kind if possible):",
    );
    lines.push(ingCands.map((c) => `- kind "${c.kind}" ingredient "${c.name}"`).join("\n"));
  }

  if (appCands.length) {
    lines.push("");
    lines.push("SAVED APPLICATOR/TOPPING TYPES:");
    lines.push((input.knownAppTypes ?? []).map((t) => `- ${t}`).join("\n") || "(none)");
    lines.push("");
    lines.push("UNMATCHED IMPORTED APPLICATOR/TOPPING TYPES (match each to a SAVED type if possible):");
    lines.push(appCands.map((t) => `- "${t}"`).join("\n"));
  }

  if (pepCands.length) {
    lines.push("");
    lines.push("SAVED PEPPERONI TYPES:");
    lines.push((input.knownPepTypes ?? []).map((t) => `- ${t}`).join("\n") || "(none)");
    lines.push("");
    lines.push("UNMATCHED IMPORTED PEPPERONI TYPES (match each to a SAVED type if possible):");
    lines.push(pepCands.map((t) => `- "${t}"`).join("\n"));
  }

  const extraShape =
    ingCands.length || appCands.length || pepCands.length
      ? '"ingredientMatches":[{"kind":string,"candidate":string,"match":string}],' +
        '"appTypeMatches":[{"candidate":string,"match":string}],' +
        '"pepTypeMatches":[{"candidate":string,"match":string}],'
      : "";

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"brandMatches":[{"candidate":string,"match":string}],' +
      '"flavorMatches":[{"brand":string,"candidate":string,"match":string}],' +
      extraShape +
      '"note":string}. ' +
      "candidate echoes the imported name EXACTLY as given above; match is copied EXACTLY " +
      "from the saved lists. For flavorMatches, brand echoes the given brand exactly; for " +
      "ingredientMatches, kind echoes the given recipe kind exactly. " +
      "Omit any item you are not confident about. Use \"note\" only for a brief overall comment.",
  );

  return { system, user: lines.join("\n") };
}
