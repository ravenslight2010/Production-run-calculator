// Sauce Guide document parser — pure logic, no DOM/storage/fetch.
//
// Parses the plain-text sauce guide whose lines follow the pattern:
//   "Brand uses Recipe (on|for) Flavor1, Flavor2 & Flavor3 at 3.5oz"
//   "Brand uses Recipe (on|for) all varieties at 4oz"
//   "Brand uses Recipe (on|for) all other varieties at 4 oz"
//
// "their recipe" in the recipe position is normalised to the brand name.
// Multiple oz values joined by "and on/for" are split into separate rows.

export type SauceGuideRow = {
  /** Brand name exactly as written in the guide. */
  brand: string;
  /**
   * Sauce recipe name as written in the guide (may need matching to a pool
   * recipe). "their recipe" is normalised to the brand name.
   */
  recipeName: string;
  /**
   * Specific flavors this row applies to, or null when the guide says
   * "all varieties" / "all other varieties" (treat as whole-brand).
   */
  flavors: string[] | null;
  /** Sauce oz per pizza as written in the guide (> 0). */
  ozPerPizza: number;
  /** Raw source line, for display in the review dialog. */
  sourceLine: string;
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Normalise "their recipe" → brand name; otherwise return trimmed recipe text. */
function normaliseRecipeName(raw: string, brand: string): string {
  if (/^their(\s+\w+)?\s+recipe$/i.test(raw.trim())) return brand;
  return raw.trim();
}

/** Parse the flavors portion of a guide line. Returns null for "all / all other". */
function parseFlavors(raw: string): string[] | null {
  const t = norm(raw);
  // "all varieties", "all other varieties", "all other 12" varieties", etc.
  if (/^all(\s+(other\s+)?(\d+["'"]?\s*)?(varieties|sizes?|flavors?|9"|12"))?$/i.test(t)) return null;
  if (/^all\s+other/i.test(t)) return null;
  // Split by commas and & (ignore empty segments)
  return t
    .split(/[,&]/)
    .map((f) => norm(f))
    .filter(Boolean);
}

/**
 * Parse the sauce guide plain text (one rule per non-blank line) into
 * structured rows. Lines that don't match the expected pattern are skipped.
 */
export function parseSauceGuide(text: string): SauceGuideRow[] {
  const rows: SauceGuideRow[] = [];

  for (const rawLine of text.split("\n")) {
    const line = norm(rawLine);
    if (!line) continue;

    // Main pattern: Brand uses Recipe (on|for) Flavors at Noz
    // The recipe name runs up to the last "(on|for)" before "at \d+oz".
    // We use a greedy match for the recipe to allow multi-word recipe names.
    const m = line.match(
      /^(.+?)\s+uses\s+(.+?)\s+(?:on|for)\s+(.+?)\s+at\s+([\d.]+)\s*oz(.*)?$/i,
    );
    if (!m) continue;

    const brand = norm(m[1]);
    const recipeRaw = norm(m[2]);
    const flavorRaw = norm(m[3]);
    const oz = parseFloat(m[4]);
    const remainder = norm(m[5] ?? "");

    if (!brand || !recipeRaw || !(oz > 0)) continue;

    const recipeName = normaliseRecipeName(recipeRaw, brand);
    const flavors = parseFlavors(flavorRaw);

    rows.push({ brand, recipeName, flavors, ozPerPizza: oz, sourceLine: line });

    // "and on Flavor at Xoz" / "and for Flavor at Xoz" continuations
    const andPattern = /\band\s+(?:on|for)\s+(.+?)\s+at\s+([\d.]+)\s*oz/gi;
    let am: RegExpExecArray | null;
    while ((am = andPattern.exec(remainder)) !== null) {
      const fl2 = parseFlavors(norm(am[1]));
      const oz2 = parseFloat(am[2]);
      if (oz2 > 0) {
        rows.push({
          brand,
          recipeName,
          flavors: fl2,
          ozPerPizza: oz2,
          sourceLine: line,
        });
      }
    }
  }

  return rows;
}
