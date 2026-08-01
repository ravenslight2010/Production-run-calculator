// Candidate builder — matches parsed guide rows to known app brands and
// recipe-pool names so the review dialog can show confident matches and flag
// the ones that need manual attention.

import { buildNearDupNameMatcher, looseNameKey } from "@workspace/name-match";
import type { SauceGuideRow } from "./parseSauceGuide";
import type { DoughGuideRow } from "./parseDoughGuide";

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const lc = (s: string) => s.toLowerCase();

/**
 * Match a guide name label against the app's known names using:
 *   exact (case-insensitive) → loose key → near-duplicate.
 * Returns null when no confident single match is found.
 *
 * Pass `allowExtraToken: true` for brand matching: the dough/sauce guides
 * often label sub-brands with a one-word qualifier (e.g. "Lucia's Craft",
 * "Basha's Original") that the app stores under the base brand.  The extra-
 * token layer collapses those safely — the digit guard still blocks numeric
 * size qualifiers like "Lowe's 7"" from matching "Lowe's".
 */
export function matchGuideName(
  guideName: string,
  known: ReadonlyArray<string>,
  options?: { allowExtraToken?: boolean },
): string | null {
  const want = lc(norm(guideName));
  if (!want) return null;
  for (const k of known) if (lc(norm(k)) === want) return k;
  const wantKey = looseNameKey(guideName);
  if (wantKey) {
    const hits = known.filter((k) => looseNameKey(k) === wantKey);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null; // ambiguous
  }
  const matcher = buildNearDupNameMatcher(known as string[], {
    allowExtraToken: options?.allowExtraToken ?? false,
  });
  return matcher(guideName);
}

// ─── Sauce candidates ────────────────────────────────────────────────────────

export type SauceGuideCandidate = {
  id: string;
  guideBrandName: string;
  /** Matched app brand, or null if no confident match. */
  brand: string | null;
  /** Recipe name as written in the guide. */
  guideName: string;
  /** Matched sauce pool recipe name, or null. */
  matchedRecipeName: string | null;
  flavors: string[] | null;
  ozPerPizza: number;
  sourceLine: string;
};

export function buildSauceCandidates(
  rows: ReadonlyArray<SauceGuideRow>,
  brands: ReadonlyArray<string>,
  sauceRecipeNames: ReadonlyArray<string>,
): SauceGuideCandidate[] {
  return rows.map((row, i) => ({
    id: `sauce-${i}`,
    guideBrandName: row.brand,
    // allowExtraToken: guide sub-brands like "Lucia's Craft" fold to the
    // base brand "Lucia's"; digit guard blocks size qualifiers like "7\"".
    brand: matchGuideName(row.brand, brands, { allowExtraToken: true }),
    guideName: row.recipeName,
    matchedRecipeName: matchGuideName(row.recipeName, sauceRecipeNames),
    flavors: row.flavors,
    ozPerPizza: row.ozPerPizza,
    sourceLine: row.sourceLine,
  }));
}

// ─── Dough candidates ────────────────────────────────────────────────────────

export type DoughGuideCandidate = {
  id: string;
  guideBrandName: string;
  /** Matched app brand, or null if no confident match. */
  brand: string | null;
  /** Dough recipe name as written in the guide. */
  guideName: string;
  /** Matched dough pool recipe name, or null. */
  matchedDoughRecipeName: string | null;
  flavors: string[] | null;
  sourceLine: string;
};

export function buildDoughCandidates(
  rows: ReadonlyArray<DoughGuideRow>,
  brands: ReadonlyArray<string>,
  doughRecipeNames: ReadonlyArray<string>,
): DoughGuideCandidate[] {
  return rows.map((row, i) => ({
    id: `dough-${i}`,
    guideBrandName: row.brand,
    // allowExtraToken: guide sub-brands like "Lucia's Craft" fold to the
    // base brand "Lucia's"; digit guard blocks size qualifiers like "7\"".
    brand: matchGuideName(row.brand, brands, { allowExtraToken: true }),
    guideName: row.doughRecipeName,
    matchedDoughRecipeName: matchGuideName(row.doughRecipeName, doughRecipeNames),
    flavors: row.flavors,
    sourceLine: row.sourceLine,
  }));
}
