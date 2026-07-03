// @workspace/spec-import — pure, platform-agnostic logic for the Excel
// spec-sheet / recipe importer and its learned-memory layer.
//
// This package holds NO platform IO (no xlsx read, no localStorage / AsyncStorage,
// no fetch). Web and mobile glue read the workbook into a SheetGrid[], call the
// AI parse endpoint, then feed the structured result through these helpers to
// canonicalize names (using learned aliases + fuzzy matching), decide what is new
// vs an update, and collect the alias mappings worth remembering. Keeping the
// logic here means both apps stay thin and behave identically (replit.md parity).

// ── Core data shapes ────────────────────────────────────────────────────────

export type RecipeRow = { ingredient: string; lbs: number };

export type ParsedApplicator = { type: string; ozPerPizza: number };
export type ParsedPepperoni = { type: string; sticks: number; ozPerPizza: number };

/** One brand+flavor spec sheet, as interpreted by the AI (pre-canonicalization). */
export type ParsedProfile = {
  brand: string;
  flavor: string;
  dieType?: string;
  sauceOzPerPizza?: number;
  /**
   * Name of the sauce when the spec sheet names a specific one (e.g. BBQ,
   * Ranch). Bought/ready-made sauces have no mixing recipe in the workbook —
   * the apply step records this name (when no mixed sauce recipe exists) so
   * needs/consumption pull the sauce as-is by name instead of generic "Sauce".
   */
  sauceName?: string;
  applicators: ParsedApplicator[];
  pepperonis: ParsedPepperoni[];
};

/** One brand+flavor profile a recipe should be tied to. */
export type ParsedRecipeTarget = { brand: string; flavor: string };

/** One dough / sauce / cheese recipe, as interpreted by the AI. */
export type ParsedRecipe = {
  kind: "dough" | "sauce" | "cheese";
  name: string;
  /** Single brand/flavor this recipe ties to (simple case). */
  brand?: string;
  flavor?: string;
  /**
   * Brand+flavor profiles this ONE recipe applies to. A single recipe (e.g. a
   * dough mixing procedure) often serves many brand/flavor combinations; listing
   * them here keeps it one recipe tied to every profile instead of duplicating
   * the recipe per brand/flavor. Unioned with the singular brand/flavor above.
   */
  targets?: ParsedRecipeTarget[];
  /**
   * Brands this recipe covers "all flavors of" (a catch-all/whole-brand target the
   * sanitizer lifted out of `targets[]` — e.g. a dough sheet noting "used for
   * Hannaford and Lucia" or a cheese tab labelled "All Varieties"). Unlike the
   * singular `brand`, this holds MULTIPLE brands so a shared recipe used across
   * several customers fans to every real flavor of EACH at apply time instead of
   * collapsing to one. recipeApplyTargets() resolves these against the pool.
   */
  brandAnchors?: string[];
  /** Dough only: target doughball weight in oz. */
  doughballOz?: number;
  /** Cheese only: applicator slot (1-4) the recipe should tie to. */
  app?: number;
  rows: RecipeRow[];
};

/**
 * One flavor-grounding correction/flag the sanitizer made — e.g. an
 * AI-paraphrased flavor snapped back to what the sheet actually says, or an
 * invented flavor kept-but-flagged. `brand`/`flavor` identify the profile the
 * warning concerns (its FINAL, post-correction names) so review screens can
 * attach the warning to that profile's row; `message` is the human-readable
 * explanation.
 */
export type SpecImportWarning = { brand: string; flavor: string; message: string };

export type ParsedSpecImport = {
  profiles: ParsedProfile[];
  recipes: ParsedRecipe[];
  note?: string;
  /**
   * Grounding corrections/flags from sanitizeParsedSpecImport. Kept separate
   * from `note` so review UIs can surface them prominently (per-profile amber
   * callouts) instead of burying them in free text.
   */
  warnings?: SpecImportWarning[];
};

/**
 * Merge several parsed spec imports (e.g. from importing multiple workbooks at
 * once) into one combined result. Profiles are de-duplicated by brand+flavor and
 * recipes by kind+name, both case-insensitively, with LATER entries winning so a
 * more recent file overrides an earlier one — matching the single-file
 * overwrite-by-name apply semantics. Notes are concatenated. Pure.
 */
export function mergeParsedSpecImports(list: ParsedSpecImport[]): ParsedSpecImport {
  const profileMap = new Map<string, ParsedProfile>();
  const recipeMap = new Map<string, ParsedRecipe>();
  const notes: string[] = [];
  const warningMap = new Map<string, SpecImportWarning>();
  // Nameless recipes (kept so the review can rescue them) must not collide on an
  // empty name key, or several distinct ones would collapse into one. Give each
  // a unique synthetic key so they all survive to the review screen.
  let anon = 0;
  for (const item of list) {
    for (const p of item.profiles) {
      profileMap.set(`${p.brand.trim().toLowerCase()}|${p.flavor.trim().toLowerCase()}`, p);
    }
    for (const r of item.recipes) {
      const nm = r.name.trim().toLowerCase();
      recipeMap.set(nm ? `${r.kind}|${nm}` : `${r.kind}|__anon${anon++}`, r);
    }
    if (item.note && item.note.trim()) notes.push(item.note.trim());
    for (const w of item.warnings ?? []) {
      warningMap.set(
        `${w.brand.trim().toLowerCase()}|${w.flavor.trim().toLowerCase()}|${w.message.trim().toLowerCase()}`,
        w,
      );
    }
  }
  const result: ParsedSpecImport = {
    profiles: [...profileMap.values()],
    recipes: [...recipeMap.values()],
  };
  if (notes.length) result.note = notes.join("\n");
  // Bounded so a flood of per-file corrections can't bloat the merged payload.
  if (warningMap.size) result.warnings = [...warningMap.values()].slice(0, 30);
  return result;
}

// ── Embedded applicator blends (deterministic unpack) ───────────────────────
//
// Many spec grids pack a full blend recipe INSIDE one applicator cell — a mix
// name followed by number+ingredient pairs, e.g. "Aldo's Cheese Mix 1.75
// Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan". The AI prompt asks
// the model to split these (clean name → applicator type, pairs → cheese
// recipe), but model compliance is probabilistic; this pass runs AFTER
// sanitization and deterministically unpacks any composition the model left
// embedded, so no import ever lands a raw blend string as an applicator type.

/** A blend composition parsed out of a single applicator-type string. */
export type EmbeddedBlend = { name: string; rows: RecipeRow[] };

const BLEND_PAIR_RE = /(\d+(?:\.\d+)?)\s+([A-Za-z][^,()]*)/g;

/**
 * Parse an applicator-type string that embeds a blend composition. Returns the
 * clean mix name plus its ingredient rows, or null when the string is a plain
 * type name. Guards against false positives: needs 2+ number+ingredient pairs
 * (a lone "Lowes 7in" or supplier code never qualifies), per-part numbers must
 * be plausible lbs ratios (0 < n <= 100 — product codes like 28501 are
 * skipped), and the leading name must be non-trivial. Pure.
 */
export function parseEmbeddedBlend(type: string): EmbeddedBlend | null {
  const text = (type ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  BLEND_PAIR_RE.lastIndex = 0;
  let firstIdx: number | null = null;
  const rows: RecipeRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = BLEND_PAIR_RE.exec(text))) {
    const lbs = Number(m[1]);
    const ingredient = m[2].replace(/[\s,;:.–-]+$/g, "").trim();
    if (!Number.isFinite(lbs) || lbs <= 0 || lbs > 100) continue;
    if (ingredient.length < 3 || !/[A-Za-z]{3}/.test(ingredient)) continue;
    if (firstIdx === null) firstIdx = m.index;
    rows.push({ ingredient, lbs });
  }
  if (firstIdx === null || rows.length < 2) return null;
  const name = text
    .slice(0, firstIdx)
    .replace(/[\s,;:(–-]+$/g, "")
    .trim();
  if (name.length < 4) return null;
  return { name, rows };
}

/**
 * Deterministically unpack every embedded applicator blend in a parsed import:
 * the applicator's `type` becomes the clean mix name and the composition is
 * emitted ONCE as a cheese-kind library recipe (apply-time routing then files
 * "mix"-named ones under the Mix category). A clean name the AI already
 * emitted a cheese recipe for is reused, never duplicated; the same base name
 * with a DIFFERENT composition becomes a distinct "(variant N)" recipe.
 *
 * IMPORTANT: run this ONCE over the fully MERGED workbook parse (after
 * mergeParsedSpecImports), never per chunk — variant naming is only consistent
 * within a single pass, and a per-chunk pass would let two chunks emit the same
 * base name for different compositions, which the later-wins recipe merge then
 * collapses into one (losing a variant and mislinking applicators). Pure.
 */
export function extractEmbeddedApplicatorBlends(parsed: ParsedSpecImport): ParsedSpecImport {
  // Every taken cheese-recipe name (pre-existing AND newly generated) so a
  // generated variant name can never silently collide with either.
  const takenCheese = new Set(
    parsed.recipes.filter((r) => r.kind === "cheese").map((r) => r.name.trim().toLowerCase()),
  );
  const added: ParsedRecipe[] = [];
  const variantsByBase = new Map<string, ParsedRecipe[]>();
  const sameRows = (a: RecipeRow[], b: RecipeRow[]) =>
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.ingredient.toLowerCase() === b[i].ingredient.toLowerCase() &&
        Math.abs(x.lbs - b[i].lbs) < 1e-9,
    );

  const profiles = parsed.profiles.map((p) => ({
    ...p,
    applicators: p.applicators.map((a) => {
      const blend = parseEmbeddedBlend(a.type);
      if (!blend) return a;
      const baseLower = blend.name.toLowerCase();
      const variants = variantsByBase.get(baseLower) ?? [];
      // Same composition already extracted in this pass → reuse its name.
      const match = variants.find((v) => sameRows(v.rows, blend.rows));
      if (match) return { ...a, type: match.name };
      // The AI already emitted a cheese recipe under this clean name (and no
      // extracted variant claimed it) — trust its version, just clean the type.
      if (variants.length === 0 && takenCheese.has(baseLower)) {
        return { ...a, type: blend.name };
      }
      // New composition: base name if free, else the next free "(variant N)".
      let name = blend.name;
      for (let n = 2; takenCheese.has(name.trim().toLowerCase()); n++) {
        name = `${blend.name} (variant ${n})`;
      }
      const rec: ParsedRecipe = { kind: "cheese", name, rows: blend.rows };
      added.push(rec);
      takenCheese.add(name.trim().toLowerCase());
      variants.push(rec);
      variantsByBase.set(baseLower, variants);
      return { ...a, type: name };
    }),
  }));

  return { ...parsed, profiles, recipes: [...parsed.recipes, ...added] };
}

/**
 * Every brand+flavor profile a recipe should tie to: the union of its singular
 * brand/flavor and its `targets` list, trimmed and de-duplicated
 * (case-insensitive). Entries missing a brand or flavor are dropped. Shared by
 * both apps' apply step so one recipe ties to many profiles identically.
 */
export function recipeTargets(r: ParsedRecipe): ParsedRecipeTarget[] {
  const out: ParsedRecipeTarget[] = [];
  const seen = new Set<string>();
  const add = (brand?: string, flavor?: string) => {
    const b = (brand ?? "").trim();
    const f = (flavor ?? "").trim();
    if (!b || !f) return;
    const key = `${b.toLowerCase()}\u0000${f.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ brand: b, flavor: f });
  };
  add(r.brand, r.flavor);
  for (const t of r.targets ?? []) add(t.brand, t.flavor);
  return out;
}

/**
 * The brand+flavor profiles a recipe should tie to AT APPLY TIME. When the
 * recipe carries explicit targets (a singular brand+flavor and/or a `targets`
 * list), those win unchanged — a value the sheet actually specifies is never
 * broadened. Only when `recipeTargets(r)` is empty does a conservative
 * same-import fallback kick in:
 *
 *   - If the recipe carries a brand but no flavor (so `recipeTargets` dropped it
 *     for lacking a flavor), it links to EVERY profile in THIS import that shares
 *     that brand — i.e. "one dough/sauce/cheese procedure for all flavors of the
 *     product". This is the apply-time backstop for a shared recipe the AI failed
 *     to populate `targets[]` for.
 *   - A recipe with no brand anchor at all stays unlinked: broadcasting it across
 *     unrelated products (e.g. every "Pepperoni" profile) would be ambiguous, so
 *     non-equivalent profiles are never linked.
 *
 * Pure + non-mutating. Both apps' apply step MUST call this (not `recipeTargets`
 * directly) so the fallback stays identical across web and mobile.
 */
export function recipeApplyTargets(
  r: ParsedRecipe,
  profiles: ReadonlyArray<ParsedProfile>,
): ParsedRecipeTarget[] {
  const explicit = recipeTargets(r);
  const out: ParsedRecipeTarget[] = [...explicit];
  const seen = new Set(
    out.map((t) => `${t.brand.toLowerCase()}\u0000${t.flavor.toLowerCase()}`),
  );
  // Fan one brand out to every same-brand profile in the pool, appending only
  // profiles not already covered by an explicit (or prior-anchor) target.
  const fanBrand = (brand: string): void => {
    const wantBrand = brand.trim().toLowerCase();
    if (!wantBrand) return;
    for (const p of profiles) {
      const pb = p.brand.trim();
      const pf = p.flavor.trim();
      if (!pb || !pf) continue;
      if (pb.toLowerCase() !== wantBrand) continue;
      const key = `${pb.toLowerCase()}\u0000${pf.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ brand: pb, flavor: pf });
    }
  };
  // Fan every catch-all brand anchor the sanitizer captured (may be MANY brands,
  // e.g. a dough "used for Hannaford and Lucia"). These add to any explicit
  // per-flavor targets rather than replacing them.
  for (const b of r.brandAnchors ?? []) fanBrand(b);
  if (out.length) return out;
  // No explicit target and no anchors. A singular brand without a flavor is the
  // only remaining safe anchor: link to every same-brand profile in the pool.
  const brand = (r.brand ?? "").trim();
  if (!brand) return [];
  fanBrand(brand);
  return out;
}

// ── Tombstone filtering (respect merged-away / deleted names on import) ───────

/** The parsed items an import skipped because they were previously merged/deleted away. */
export type SpecImportSkipped = {
  profiles: ParsedProfile[];
  recipes: ParsedRecipe[];
};

/**
 * Split a parsed import into what should apply (`kept`) versus what the user has
 * previously merged or deleted away (`skipped`). A live import must respect the
 * same tombstones the sync merge does, or re-importing a sheet resurrects names
 * the user deliberately removed. The tombstone semantics live in each app's glue
 * (they read localStorage / AsyncStorage), so this pure helper takes predicates
 * and stays platform-agnostic. Non-mutating; preserves the note.
 */
export function partitionTombstonedParse(
  parsed: ParsedSpecImport,
  isProfileTombstoned: (brand: string, flavor: string) => boolean,
  isRecipeTombstoned: (kind: ParsedRecipe["kind"], name: string) => boolean,
): { kept: ParsedSpecImport; skipped: SpecImportSkipped } {
  const keptProfiles: ParsedProfile[] = [];
  const skippedProfiles: ParsedProfile[] = [];
  for (const p of parsed.profiles) {
    if (isProfileTombstoned(p.brand ?? "", p.flavor ?? "")) skippedProfiles.push(p);
    else keptProfiles.push(p);
  }
  const keptRecipes: ParsedRecipe[] = [];
  const skippedRecipes: ParsedRecipe[] = [];
  for (const r of parsed.recipes) {
    // A blank name can't have been merged away, so never skip it here — the
    // review screen surfaces it for naming instead.
    if (r.name && r.name.trim() && isRecipeTombstoned(r.kind, r.name)) skippedRecipes.push(r);
    else keptRecipes.push(r);
  }
  const kept: ParsedSpecImport = { profiles: keptProfiles, recipes: keptRecipes };
  if (parsed.note) kept.note = parsed.note;
  if (parsed.warnings?.length) kept.warnings = parsed.warnings;
  return { kept, skipped: { profiles: skippedProfiles, recipes: skippedRecipes } };
}

// ── Would-drop / "needs attention" detection for the review screen ────────────

/** Why a recipe would be dropped at apply time (so the review can flag it). */
export type RecipeApplyIssue = "missing-name" | "no-rows";

/**
 * The reason a recipe would silently vanish at apply time, or null if it will
 * apply. `applySpecImport` skips recipes with a blank name or no rows; the review
 * screen uses this to flag them "needs attention" so nothing disappears quietly.
 * Pure.
 */
export function recipeApplyIssue(r: ParsedRecipe): RecipeApplyIssue | null {
  if (!r.name || !r.name.trim()) return "missing-name";
  if (!r.rows || r.rows.length === 0) return "no-rows";
  return null;
}

/** Why a profile would be dropped at apply time, or null if it will apply. */
export type ProfileApplyIssue = "missing-brand" | "missing-flavor";

/** The reason a profile would not apply (blank brand/flavor), or null. Pure. */
export function profileApplyIssue(p: ParsedProfile): ProfileApplyIssue | null {
  if (!p.brand || !p.brand.trim()) return "missing-brand";
  if (!p.flavor || !p.flavor.trim()) return "missing-flavor";
  return null;
}

// ── Learned aliases ─────────────────────────────────────────────────────────

export type SpecAliasKind =
  | "brand"
  | "flavor"
  | "appType"
  | "pepType"
  | "cheeseIngredient"
  | "doughIngredient"
  | "sauceIngredient";

export const SPEC_ALIAS_KINDS: SpecAliasKind[] = [
  "brand",
  "flavor",
  "appType",
  "pepType",
  "cheeseIngredient",
  "doughIngredient",
  "sauceIngredient",
];

export type SpecImportAlias = {
  kind: SpecAliasKind;
  externalName: string;
  canonicalName: string;
  /** Disambiguator within a kind (e.g. the canonical brand for a flavor); null otherwise. */
  context: string | null;
};

const NUL = "\u0000";

/** Case-insensitive identity key for an alias. */
export function specAliasKey(
  kind: string,
  externalName: string,
  context: string | null,
): string {
  return `${kind}${NUL}${externalName.trim().toLowerCase()}${NUL}${(context ?? "").trim().toLowerCase()}`;
}

/**
 * Look up a learned canonical name for a raw label, or null. Context is matched
 * case-insensitively too (so a flavor alias is scoped to its brand).
 */
export function pickAlias(
  aliases: ReadonlyArray<SpecImportAlias>,
  kind: SpecAliasKind,
  externalName: string,
  context: string | null = null,
): string | null {
  const want = specAliasKey(kind, externalName, context);
  for (const a of aliases) {
    if (a.kind !== kind) continue;
    if (specAliasKey(a.kind, a.externalName, a.context ?? null) === want) {
      return a.canonicalName;
    }
  }
  return null;
}

/**
 * Drop incoherent learned aliases before they are applied. Within a `kind`, a
 * name that appears BOTH as an `externalName` (a label to be renamed away) AND as
 * a `canonicalName` (a rename target) makes the mapping direction ambiguous — it
 * is part of a cycle (A→B and B→A) or a chain (A→B and B→C). Such learned memory
 * cannot be trusted (which direction wins?), so every alias touching a conflicted
 * name is removed rather than applied. This keeps polluted/contradictory learned
 * aliases from silently mis-renaming and colliding otherwise-valid names on
 * import. Context is intentionally ignored so cross-context cycles are caught too.
 * Pure and order-preserving for the survivors.
 */
export function dropConflictingSpecAliases(
  aliases: ReadonlyArray<SpecImportAlias>,
): SpecImportAlias[] {
  const dl = (s: string) => s.trim().toLowerCase();
  const froms = new Map<string, Set<string>>();
  const tos = new Map<string, Set<string>>();
  for (const a of aliases) {
    const k = dl(a.kind);
    let f = froms.get(k);
    if (!f) froms.set(k, (f = new Set()));
    f.add(dl(a.externalName));
    let t = tos.get(k);
    if (!t) tos.set(k, (t = new Set()));
    t.add(dl(a.canonicalName));
  }
  return aliases.filter((a) => {
    const k = dl(a.kind);
    const f = froms.get(k);
    const t = tos.get(k);
    const conflicted = (name: string) => !!f && !!t && f.has(name) && t.has(name);
    return !conflicted(dl(a.externalName)) && !conflicted(dl(a.canonicalName));
  });
}

// ── Name canonicalization (alias → exact → fuzzy → new) ──────────────────────

function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const prev = new Array<number>(bl + 1);
  const cur = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bl; j++) prev[j] = cur[j];
  }
  return prev[bl];
}

export type CanonicalSource = "alias" | "exact" | "fuzzy" | "new";

export type CanonicalResult = {
  /** The resolved canonical name. For "new" this is the trimmed raw label. */
  value: string;
  source: CanonicalSource;
  /** The original raw label (trimmed). */
  externalName: string;
};

/**
 * Resolve a raw spreadsheet label to a canonical app name. Priority:
 *   1. learned alias  2. case-insensitive exact match in the known list
 *   3. confident fuzzy match (edit-distance ratio <= 0.34)  4. new (create)
 * "new" returns the raw label so callers can add it as a brand-new option.
 */
export function canonicalize(
  raw: string,
  known: ReadonlyArray<string>,
  aliases: ReadonlyArray<SpecImportAlias>,
  kind: SpecAliasKind,
  context: string | null = null,
): CanonicalResult {
  const externalName = (raw ?? "").trim();
  if (!externalName) return { value: "", source: "new", externalName };

  // Ignore incoherent (cyclic/chained) learned aliases so polluted memory can't
  // mis-rename or collide otherwise-valid names; such labels fall through to the
  // exact/fuzzy/new path instead.
  const aliased = pickAlias(dropConflictingSpecAliases(aliases), kind, externalName, context);
  if (aliased) return { value: aliased, source: "alias", externalName };

  const lower = externalName.toLowerCase();
  const exact = known.find((k) => k.trim().toLowerCase() === lower);
  if (exact) return { value: exact, source: "exact", externalName };

  let best: { value: string; ratio: number } | null = null;
  for (const k of known) {
    const dist = levenshtein(lower, k.trim().toLowerCase());
    const ratio = dist / Math.max(lower.length, k.length, 1);
    if (best === null || ratio < best.ratio) best = { value: k, ratio };
  }
  if (best && best.ratio <= 0.34) {
    return { value: best.value, source: "fuzzy", externalName };
  }
  return { value: externalName, source: "new", externalName };
}

/**
 * From a set of resolved names, collect the alias pairs worth persisting: only
 * mappings that resolved to an EXISTING canonical name (alias / exact / fuzzy)
 * where the raw label differs from the canonical one (case-insensitively).
 * "new" creations and self-references carry no information and are skipped.
 * Deduped by identity key (last write wins).
 */
export function collectSpecAliases(
  resolved: ReadonlyArray<{ kind: SpecAliasKind; result: CanonicalResult; context?: string | null }>,
): SpecImportAlias[] {
  const byKey = new Map<string, SpecImportAlias>();
  for (const r of resolved) {
    if (r.result.source === "new") continue;
    const externalName = r.result.externalName.trim();
    const canonicalName = r.result.value.trim();
    if (!externalName || !canonicalName) continue;
    if (externalName.toLowerCase() === canonicalName.toLowerCase()) continue;
    const context = r.context != null ? String(r.context).trim() || null : null;
    byKey.set(specAliasKey(r.kind, externalName, context), {
      kind: r.kind,
      externalName,
      canonicalName,
      context,
    });
  }
  return [...byKey.values()];
}

// ── Workbook → compact prompt text ───────────────────────────────────────────

export type SheetGrid = { name: string; rows: string[][] };

export type GridTextLimits = {
  maxSheets?: number;
  maxRows?: number;
  maxCols?: number;
  maxCellChars?: number;
  maxTotalChars?: number;
};

/**
 * Per-CELL char clamp applied when a workbook is flattened to prompt text.
 * Exported so producers of prompt-bound grids (the spec exporter's
 * "Brand: flavor, flavor…" target rows) can wrap long single-cell lines under
 * this limit instead of getting silently truncated here — a clipped targets
 * cell loses trailing flavors and the AI has to guess them back.
 */
export const PROMPT_MAX_CELL_CHARS = 240;

const DEFAULT_LIMITS: Required<GridTextLimits> = {
  maxSheets: 24,
  maxRows: 1000,
  maxCols: 60,
  maxCellChars: PROMPT_MAX_CELL_CHARS,
  // Per-chunk prompt budget. Must stay under the server's MAX_WORKBOOK_CHARS
  // (60k), but the real ceiling is the AI's OUTPUT side: parse output is
  // roughly input-proportional, and dense sheets (one spec profile per row)
  // make a big chunk demand hundreds of JSON objects back. Verified end-to-end:
  // ~56k chunks truncated past the completion cap (non-JSON → empty), and even
  // ~30k chunks (~240 profiles) were flaky — the model sometimes returned
  // valid-but-empty JSON. ~16k chunks (~100-130 profiles) parsed correctly
  // every time. splitGridsForPrompt sends multiple chunks, so nothing is
  // dropped — smaller chunks just mean more (reliable) calls.
  maxTotalChars: 16000,
};

/** Clamp a row's cells the same way for prompt text + chunking (shared so they
 * never drift): cap columns, collapse whitespace, clamp cell length, drop
 * trailing empties. Returns the cleaned cells (may be empty → caller skips). */
function cleanRowCells(row: ReadonlyArray<string>, lim: Required<GridTextLimits>): string[] {
  const cells = row.slice(0, lim.maxCols).map((c) => {
    const s = (c ?? "").toString().replace(/\s+/g, " ").trim();
    return s.length > lim.maxCellChars ? s.slice(0, lim.maxCellChars) : s;
  });
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

// ── Truncated-cell detection (pre-import warning) ────────────────────────────

/** One workbook cell whose tail gets cut by the per-cell prompt clamp. */
export type TruncatedCell = {
  /** Sheet the cell lives on. */
  sheet: string;
  /** 1-based row number within the sheet (as a user would count in Excel). */
  row: number;
  /** The kept head of the cell text (what the AI will actually see). */
  preview: string;
  /** How many characters get cut off the end. */
  cutChars: number;
};

/**
 * Report every cell that cleanRowCells would truncate when the grids are
 * flattened to prompt text — i.e. cells whose whitespace-collapsed text is
 * longer than the per-cell clamp (PROMPT_MAX_CELL_CHARS by default). The AI
 * never sees a truncated cell's tail and has to guess it, so callers surface
 * these to the user BEFORE the import is confirmed ("some cells were too long
 * and were shortened — check these rows"). Detection intentionally mirrors
 * cleanRowCells exactly (same column cap, same whitespace collapse) so it never
 * drifts from what the prompt path actually does. Pure.
 */
export function findTruncatedCells(
  grids: ReadonlyArray<SheetGrid>,
  limits: GridTextLimits = {},
): TruncatedCell[] {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const out: TruncatedCell[] = [];
  for (const sheet of grids) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      for (const c of row.slice(0, lim.maxCols)) {
        const s = (c ?? "").toString().replace(/\s+/g, " ").trim();
        if (s.length > lim.maxCellChars) {
          out.push({
            sheet: sheet.name,
            row: r + 1,
            preview: s.slice(0, lim.maxCellChars),
            cutChars: s.length - lim.maxCellChars,
          });
        }
      }
    }
  }
  return out;
}

/** Max sheet/row locations spelled out in the truncated-cells warning before
 * collapsing to "+N more" (keeps the review note readable for messy sheets). */
export const TRUNCATED_NOTE_MAX_LOCATIONS = 5;

/**
 * Plain-language warning for the import review screen when some cells were too
 * long and got shortened before the AI read them, or null when nothing was
 * truncated. Lists up to TRUNCATED_NOTE_MAX_LOCATIONS affected sheet/row spots
 * ("Sheet1 row 4") then collapses the rest to "+N more". Shared by web and
 * mobile so the wording stays identical (parity). Pure.
 */
export function formatTruncatedCellsNote(truncated: ReadonlyArray<TruncatedCell>): string | null {
  if (!truncated.length) return null;
  const seen = new Set<string>();
  const spots: string[] = [];
  for (const t of truncated) {
    const label = `${t.sheet} row ${t.row}`;
    if (seen.has(label)) continue;
    seen.add(label);
    spots.push(label);
  }
  const shown = spots.slice(0, TRUNCATED_NOTE_MAX_LOCATIONS);
  const extra = spots.length - shown.length;
  const where = extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
  const n = truncated.length;
  return `${n === 1 ? "1 cell was" : `${n} cells were`} too long and ${n === 1 ? "was" : "were"} shortened before reading — double-check ${spots.length === 1 ? "this row" : "these rows"}: ${where}.`;
}

// ── Overflow-column detection (pre-import warning) ───────────────────────────

/** One sheet row holding non-empty cells past the column cap — those cells are
 * dropped entirely before the AI reads the workbook. */
export type OverflowColumnRow = {
  /** Sheet the row lives on. */
  sheet: string;
  /** 1-based row number within the sheet (as a user would count in Excel). */
  row: number;
  /** How many non-empty cells in this row sit past the column cap. */
  droppedCells: number;
};

/**
 * Report every row with non-empty cells beyond the column cap (maxCols,
 * 60 by default) — the sibling of findTruncatedCells for the OTHER silent-loss
 * path: cleanRowCells slices each row to maxCols, so a wide user-authored
 * layout (e.g. one flavor per column) loses whole columns and the AI never
 * sees them at all. Callers surface these to the user BEFORE the import is
 * confirmed. "Non-empty" mirrors cleanRowCells' whitespace collapse so a cell
 * of pure whitespace past the cap doesn't trigger a false warning. Pure.
 */
export function findOverflowColumnRows(
  grids: ReadonlyArray<SheetGrid>,
  limits: GridTextLimits = {},
): OverflowColumnRow[] {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const out: OverflowColumnRow[] = [];
  for (const sheet of grids) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      let dropped = 0;
      for (const c of row.slice(lim.maxCols)) {
        const s = (c ?? "").toString().replace(/\s+/g, " ").trim();
        if (s.length > 0) dropped++;
      }
      if (dropped > 0) {
        out.push({ sheet: sheet.name, row: r + 1, droppedCells: dropped });
      }
    }
  }
  return out;
}

/**
 * Plain-language warning for the import review screen when some rows had data
 * past the column cap that was dropped entirely (never reached the AI), or
 * null when nothing overflowed. Lists up to TRUNCATED_NOTE_MAX_LOCATIONS
 * affected sheet/row spots then collapses the rest to "+N more" — same shape
 * as formatTruncatedCellsNote. Shared by web and mobile so the wording stays
 * identical (parity). Pure.
 */
export function formatOverflowColumnsNote(
  overflow: ReadonlyArray<OverflowColumnRow>,
  maxCols: number = DEFAULT_LIMITS.maxCols,
): string | null {
  if (!overflow.length) return null;
  const seen = new Set<string>();
  const spots: string[] = [];
  let cells = 0;
  for (const o of overflow) {
    cells += o.droppedCells;
    const label = `${o.sheet} row ${o.row}`;
    if (seen.has(label)) continue;
    seen.add(label);
    spots.push(label);
  }
  const shown = spots.slice(0, TRUNCATED_NOTE_MAX_LOCATIONS);
  const extra = spots.length - shown.length;
  const where = extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
  return `${cells === 1 ? "1 cell sits" : `${cells} cells sit`} past column ${maxCols} and ${cells === 1 ? "was" : "were"} not read at all — move that data into the first ${maxCols} columns and re-import, or double-check ${spots.length === 1 ? "this row" : "these rows"}: ${where}.`;
}

// ── Junk-file sanity check (pre-AI guard) ────────────────────────────────────

/** Cap on how much cell text gridSanityIssue samples — enough to judge a file
 * without walking a giant workbook end to end. */
const SANITY_SAMPLE_MAX_CHARS = 20000;
/** Below this much sampled text the binary heuristics don't apply (a tiny
 * legit sheet must never be misflagged; the empty-workbook check still runs). */
const SANITY_MIN_SAMPLE_CHARS = 16;
/** Control characters above this fraction of the sample mean binary content —
 * real spreadsheet text has essentially none, random bytes read as text land
 * around 10%+. */
const SANITY_MAX_CONTROL_FRACTION = 0.02;
/** Word-like characters (letters/digits/whitespace/common punctuation) below
 * this fraction mean symbol soup, not tabular data — real sheets in any
 * language sit near 100%. */
const SANITY_MIN_WORDLIKE_FRACTION = 0.35;

/** Plain-language message for a workbook with no readable rows at all. */
export const GRID_SANITY_EMPTY_MESSAGE = "That workbook looks empty — nothing to import.";
/** Plain-language message for a picked file whose bytes aren't spreadsheet
 * content (renamed PDF/image, random binary, corrupt download). */
export const GRID_SANITY_JUNK_MESSAGE =
  "That file doesn't look like a spreadsheet — its content could not be read as rows and columns. Check that you picked a real Excel/CSV file and try again.";

// Letters (any language), digits, whitespace, and the punctuation that shows
// up in real spreadsheet cells. Anything outside this set counts against the
// word-like fraction.
const SANITY_WORDLIKE_RE = /[\p{L}\p{N}\s.,;:!?'"()[\]{}<>/\\|@#$%^&*+=~°_–—-]/u;

function isSanityControlChar(code: number): boolean {
  // C0 controls minus tab/newline/CR, C1 controls, and the replacement char
  // (U+FFFD marks bytes that failed to decode at all).
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d;
  if (code >= 0x7f && code <= 0x9f) return true;
  return code === 0xfffd;
}

/**
 * Cheap pre-AI sanity check that a workbook's grids actually look like
 * spreadsheet content. The xlsx reader does NOT throw on garbage bytes — a
 * renamed PDF, an image, or random binary "reads" fine as one junk-text sheet
 * — so without this guard a wrong-type file silently burns an AI parse call
 * and produces a garbled review. Returns a plain-language issue string when
 * the grids are empty (zero non-blank cells) or the sampled cell text looks
 * like binary junk (too many control characters, or almost no word-like
 * characters), else null. Real CSV/text content in any language passes.
 * Shared by web and mobile so the wording and thresholds stay identical
 * (parity). Pure.
 */
export function gridSanityIssue(grids: ReadonlyArray<SheetGrid>): string | null {
  let total = 0;
  let control = 0;
  let wordlike = 0;
  let hasNonBlank = false;

  outer: for (const sheet of grids) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        const s = (cell ?? "").toString();
        if (!s) continue;
        for (const ch of s) {
          const code = ch.codePointAt(0) ?? 0;
          if (!hasNonBlank && !/\s/.test(ch)) hasNonBlank = true;
          total++;
          if (isSanityControlChar(code)) control++;
          else if (SANITY_WORDLIKE_RE.test(ch)) wordlike++;
          if (total >= SANITY_SAMPLE_MAX_CHARS) break outer;
        }
      }
    }
  }

  if (!hasNonBlank) return GRID_SANITY_EMPTY_MESSAGE;
  if (total < SANITY_MIN_SAMPLE_CHARS) return null;
  if (control / total > SANITY_MAX_CONTROL_FRACTION) return GRID_SANITY_JUNK_MESSAGE;
  if (wordlike / total < SANITY_MIN_WORDLIKE_FRACTION) return GRID_SANITY_JUNK_MESSAGE;
  return null;
}

/**
 * Flatten parsed sheets into a compact, model-friendly text block. Trailing
 * empty cells are dropped, fully-empty rows are skipped, and everything is
 * bounded so a huge workbook can't blow up prompt cost. Tab-separated cells,
 * one row per line, sheets separated by a header line.
 */
export function gridsToPromptText(grids: ReadonlyArray<SheetGrid>, limits: GridTextLimits = {}): string {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const out: string[] = [];
  let total = 0;
  const sheets = grids.slice(0, lim.maxSheets);
  for (const sheet of sheets) {
    const header = `=== SHEET: ${sheet.name} ===`;
    out.push(header);
    total += header.length + 1;
    const rows = sheet.rows.slice(0, lim.maxRows);
    for (const row of rows) {
      const cells = cleanRowCells(row, lim);
      if (cells.length === 0) continue;
      const line = cells.join("\t");
      if (total + line.length + 1 > lim.maxTotalChars) {
        out.push("… (truncated)");
        return out.join("\n");
      }
      out.push(line);
      total += line.length + 1;
    }
  }
  return out.join("\n");
}

export type GridSplit = {
  /** One SheetGrid[] per AI parse call; each renders under the char budget. */
  chunks: SheetGrid[][];
  /** Rows that did not fit within maxChunks and were dropped (precise count). */
  droppedRows: number;
};

/** Default cap on parse calls for ONE oversized workbook (mirrors the
 * multi-file MAX_SPEC_IMPORT_FILES spirit so a single file can't fan out into a
 * flood of AI calls). */
export const DEFAULT_MAX_PROMPT_CHUNKS = 8;

/** A row that begins a new logical block within a sheet — the exporter's (and
 * many hand-made workbooks') "Recipe: <name>" header. Chunking treats these as
 * preferred break points so ONE recipe block (header + "Brand: flavor" targets
 * + ingredient table) is never split across two AI calls: the chunk that saw
 * only the header would emit a rowless recipe, and the chunk that saw only the
 * rows would have no name/targets to attach them to. */
function isBlockStartRow(cells: ReadonlyArray<string>): boolean {
  return /^recipe:\s*\S/i.test(cells[0] ?? "");
}

/**
 * Split one workbook's grids into chunks that each render under the prompt char
 * budget (and per-call sheet/row caps), so a large workbook is parsed across
 * several AI calls instead of being silently truncated by gridsToPromptText.
 * Sheets are kept in order; a sheet too large for one chunk is split across
 * chunks by rows (each chunk re-emits the sheet header). When a split point
 * falls inside a "Recipe: …" block, the break is moved back to the block start
 * so the whole block lands in the next chunk (unless the block alone exceeds a
 * whole chunk, in which case it splits anyway for forward progress). Rows
 * beyond `maxChunks` chunks are reported as `droppedRows` so the caller can
 * note them precisely. Pure + deterministic.
 */
export function splitGridsForPrompt(
  grids: ReadonlyArray<SheetGrid>,
  limits: GridTextLimits = {},
  maxChunks: number = DEFAULT_MAX_PROMPT_CHUNKS,
): GridSplit {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const budget = lim.maxTotalChars;
  const chunks: SheetGrid[][] = [];

  let cur: SheetGrid[] = [];
  let curChars = 0;
  const flush = () => {
    if (cur.length) {
      chunks.push(cur);
      cur = [];
      curChars = 0;
    }
  };

  for (const sheet of grids) {
    const headerLen = `=== SHEET: ${sheet.name} ===`.length + 1;
    const rows = sheet.rows.map((r) => cleanRowCells(r, lim)).filter((c) => c.length > 0);
    let i = 0;
    while (i < rows.length) {
      // Open a sheet block in the current chunk; start a fresh chunk first if
      // this one is full (too many sheets) or the header alone won't fit.
      if (cur.length >= lim.maxSheets || (cur.length > 0 && curChars + headerLen > budget)) {
        flush();
      }
      const blockRows: string[][] = [];
      const rowLens: number[] = [];
      let blockChars = headerLen;
      // Index within blockRows of the most recent "Recipe: …" block-start row
      // (-1 when none seen in this chunk's slice of the sheet).
      let lastBlockStart = -1;
      while (i < rows.length && blockRows.length < lim.maxRows) {
        const add = rows[i].join("\t").length + 1;
        if (curChars + blockChars + add > budget) {
          // A single row larger than the whole budget on an empty chunk: take it
          // anyway so we always make forward progress (it becomes its own row).
          if (blockRows.length === 0 && cur.length === 0) {
            blockRows.push(rows[i]);
            rowLens.push(add);
            i += 1;
            blockChars += add;
          }
          break;
        }
        if (isBlockStartRow(rows[i])) lastBlockStart = blockRows.length;
        blockRows.push(rows[i]);
        rowLens.push(add);
        blockChars += add;
        i += 1;
      }
      // Keep "Recipe: …" blocks atomic: if we stopped mid-sheet and the break
      // falls INSIDE the block opened at lastBlockStart (the next pending row is
      // not itself a block start), rewind to the block start so the whole block
      // moves to the next chunk. Skip the rewind when it would leave nothing to
      // emit on an empty chunk (block bigger than a whole chunk — split anyway).
      if (
        i < rows.length &&
        lastBlockStart >= 0 &&
        !isBlockStartRow(rows[i]) &&
        (lastBlockStart > 0 || cur.length > 0)
      ) {
        while (blockRows.length > lastBlockStart) {
          blockRows.pop();
          blockChars -= rowLens.pop() ?? 0;
          i -= 1;
        }
      }
      if (blockRows.length > 0) {
        cur.push({ name: sheet.name, rows: blockRows });
        curChars += blockChars;
      } else {
        // Nothing fit in the current (non-empty) chunk; flush and retry this row.
        flush();
      }
    }
  }
  flush();

  if (chunks.length <= maxChunks) return { chunks, droppedRows: 0 };
  const kept = chunks.slice(0, maxChunks);
  let droppedRows = 0;
  for (const c of chunks.slice(maxChunks)) {
    for (const s of c) droppedRows += s.rows.length;
  }
  return { chunks: kept, droppedRows };
}

// ── Sanitization of the AI parse result (shared by server) ───────────────────

export type SpecImportLimits = {
  maxProfiles?: number;
  maxRecipes?: number;
  maxApplicators?: number;
  maxPepperonis?: number;
  maxRecipeRows?: number;
  maxNameChars?: number;
};

/** Optional grounding for the sanitizer's hallucination backstop. When provided,
 * a recipe TARGET flavor that appears NOWHERE in `sourceText` and is not one of
 * `knownFlavors` is treated as invented by the model (e.g. a "Naan" dough turned
 * into a "Mission Taco Mexican" flavor) and demoted to a whole-brand anchor
 * instead of minting a junk brand+flavor profile. Callers that pass nothing keep
 * the previous behavior (no demotion). */
export type SpecImportGrounding = {
  sourceText?: string;
  knownFlavors?: string[];
  knownBrands?: string[];
  /** Existing sauce/frontline recipe names (e.g. ready-made sauces already in
   * the app). Used to ground a profile's `sauceName` so a paraphrased sauce
   * (e.g. "Buffalo Wing Sauce" for a sheet that says "Hot Buffalo Sauce")
   * cannot silently point the profile at a sauce that doesn't exist. */
  knownSauceNames?: string[];
  /**
   * Existing recipe names per kind. When provided, a parsed recipe name that
   * closely matches an existing one (punctuation/case variant, or the same
   * distinctive words with only generic filler like "recipe"/"mix" differing)
   * snaps to the existing name — or, when the match is plausible but not
   * certain, is kept with a structured warning so the review screen flags a
   * likely duplicate. No list for a kind means recipe names of that kind pass
   * untouched (back-compat).
   */
  knownRecipeNames?: Partial<Record<"dough" | "sauce" | "cheese", string[]>>;
};

const DEFAULT_SPEC_LIMITS: Required<SpecImportLimits> = {
  // A single ~30k-char prompt chunk can legitimately carry ~240 spec-profile
  // rows (dense one-row-per-profile sheets), so the cap needs headroom above
  // that — at 100 the sanitizer silently sliced off valid profiles from large
  // exports. Still bounded to keep hallucinated floods out.
  maxProfiles: 400,
  maxRecipes: 200,
  maxApplicators: 4,
  maxPepperonis: 2,
  maxRecipeRows: 60,
  maxNameChars: 120,
};

function clampName(s: unknown, max: number): string {
  const t = (s == null ? "" : String(s)).trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

/**
 * A generic placeholder like "Sauce" or "Pizza Sauce" is not a real
 * ready-made product name — the parse prompt says to omit these, but this
 * is a deterministic backstop in case the model returns one anyway.
 */
function isGenericSauceName(name: string): boolean {
  return /^(pizza\s+)?sauce$/i.test(name.trim());
}

function num(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Flavor labels that are not a real per-pizza flavor but a "whole brand" scope
 * word. A recipe target carrying one of these (e.g. brand "Aldo's" / flavor
 * "All Varieties", or a dough recipe with flavor "Dough") must NOT be kept as an
 * explicit brand+flavor target — that would create a junk "Aldo's / All Varieties"
 * profile instead of fanning the shared recipe out to every real flavor of the
 * brand. Kept conservative so a genuine flavor is never swallowed. */
const CATCH_ALL_FLAVORS = new Set([
  "all",
  "all varieties",
  "all variety",
  "all flavors",
  "all flavours",
  "all flavor",
  "every variety",
  "any",
  "n/a",
  "na",
]);

/** Kinds whose own name is NEVER a real pizza flavor, so a target flavor equal to
 * the kind ("Dough" on a dough recipe, "Sauce" on a sauce recipe) is a placeholder.
 * "cheese" is intentionally EXCLUDED — "Cheese" is a common, legitimate flavor. */
const KINDS_WHOSE_NAME_IS_NEVER_A_FLAVOR = new Set(["dough", "sauce"]);

/** True when `flavor` is a whole-brand scope word (see CATCH_ALL_FLAVORS) or is
 * just the recipe's own kind used as a placeholder — but only for kinds whose name
 * is never a real flavor (dough/sauce). A cheese recipe's "Cheese" flavor is a real
 * flavor and is NOT treated as catch-all. Pure. */
export function isCatchAllFlavor(flavor: string, kind: string): boolean {
  const f = flavor.trim().toLowerCase();
  if (!f) return true;
  if (CATCH_ALL_FLAVORS.has(f)) return true;
  const k = kind.trim().toLowerCase();
  if (f === k && KINDS_WHOSE_NAME_IS_NEVER_A_FLAVOR.has(k)) return true;
  return false;
}

/** Matches a pepperoni ingredient/recipe name ("Pepperoni", "Pep Stick"). Pure. */
const PEPPERONI_NAME_RE = /pepp?eroni|pep\s*stick/i;

/** DICED pepperoni is a topping ingredient (part of a cheese/topping blend), NOT
 * a stick pep type — the ONE pepperoni exception that stays a cheese recipe. Pure. */
const DICED_RE = /diced/i;

/**
 * True when a CHEESE-kind recipe is really just pepperoni STICKS — a pep TYPE,
 * not a cheese/topping blend. Pepperoni sticks are captured on a profile's
 * `pepperonis` (type + sticks + oz per pizza), never as a recipe, so the importer
 * drops such recipes instead of creating a bogus "cheese recipe". Conservative:
 * fires only when EVERY ingredient row is (non-diced) pepperoni (a real cheese
 * blend that merely lists pepperoni among its cheeses is kept). DICED pepperoni
 * is a topping and is the exception — a recipe containing it is kept. Pure. */
export function isPepperoniOnlyCheeseRecipe(rows: ReadonlyArray<RecipeRow>): boolean {
  return (
    rows.length > 0 &&
    rows.every(
      (r) => PEPPERONI_NAME_RE.test(r.ingredient) && !DICED_RE.test(r.ingredient),
    )
  );
}

/** Split a name into lowercase alphanumeric word tokens of length >= 3, dropping
 * short stop-words like "of"/"the". Pure. */
function flavorTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3);
}

/** True when a target flavor is plausibly real given the parsed source text and the
 * factory's known flavors. Deliberately conservative: it returns true (keep) unless
 * there IS grounding to check against AND the flavor shares ZERO word tokens with
 * the source AND is not a known flavor. That way a genuine flavor written on the
 * sheet ("Masala Pizza" -> "masala"/"pizza" appear in the source) is always kept,
 * while a purely invented one ("Mission Taco Mexican" on a Naan dough) is caught.
 * With no grounding provided it always returns true, preserving prior behavior.
 * Pure. */
export function isGroundedFlavor(
  flavor: string,
  grounding: { sourceLower?: string; knownFlavorSet?: Set<string> },
): boolean {
  const f = flavor.trim().toLowerCase();
  if (!f) return true;
  const { sourceLower, knownFlavorSet } = grounding;
  if (knownFlavorSet && knownFlavorSet.has(f)) return true;
  if (!sourceLower) return true; // nothing to check against -> cannot judge, keep
  const toks = flavorTokens(flavor);
  if (toks.length === 0) return true; // no checkable token -> keep
  for (const t of toks) if (sourceLower.includes(t)) return true;
  return false;
}

/** Lowercase + collapse every non-alphanumeric run to a single space, so a
 * flavor phrase can be compared against messy sheet text regardless of case,
 * punctuation, or spacing. Pure. */
function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .join(" ");
}

/** Max word-tokens for a source cell to count as a plausible flavor-name
 * candidate when snapping (real flavor names are short phrases; long cells are
 * sentences/notes, not flavors). */
const MAX_SNAP_CANDIDATE_TOKENS = 6;

/** Grounding context for PROFILE flavors, precomputed once per sanitize pass.
 * `cells` are the workbook's individual cell values (the flattened prompt text
 * is tab/newline-separated), each kept as original text + normalized phrase. */
export type ProfileFlavorGroundingCtx = {
  cells: ReadonlyArray<{ original: string; normalized: string }>;
  knownFlavorSet?: Set<string>;
  /** Known flavors (original casing) that actually appear in the source cells —
   * the preferred snap candidates. */
  knownInSource: ReadonlyArray<string>;
};

/** Shared builder for name-grounding contexts (flavors AND brands): splits the
 * flattened workbook text into per-cell phrases and normalizes the caller's
 * known-name list the same way. Returns undefined when there is no source text
 * to check against. Pure. */
function buildNameGroundingCtx(
  sourceText: string | undefined,
  knownNames: string[] | undefined,
): ProfileFlavorGroundingCtx | undefined {
  if (!sourceText) return undefined;
  const seen = new Set<string>();
  const cells: { original: string; normalized: string }[] = [];
  for (const raw of sourceText.split(/[\t\n\r]+/)) {
    const original = raw.trim();
    if (!original) continue;
    const normalized = normalizePhrase(original);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    cells.push({ original, normalized });
  }
  // Normalize known names the same way as source cells so punctuation/spacing
  // variants ("Buffalo-Chicken" vs known "Buffalo Chicken") still count as known.
  const knownFlavorSet =
    knownNames && knownNames.length
      ? new Set(knownNames.map((s) => normalizePhrase(s)).filter(Boolean))
      : undefined;
  const knownInSource: string[] = [];
  if (knownNames) {
    for (const kf of knownNames) {
      const norm = normalizePhrase(kf);
      if (!norm) continue;
      if (cells.some((c) => c.normalized.includes(norm))) knownInSource.push(kf.trim());
    }
  }
  return { cells, knownFlavorSet, knownInSource };
}

/** Build the profile-flavor grounding context from the raw grounding input.
 * Returns undefined when there is no source text to check against (no grounding
 * -> profiles are kept as-is, preserving prior behavior). Pure. */
export function buildProfileFlavorGrounding(
  grounding: SpecImportGrounding,
): ProfileFlavorGroundingCtx | undefined {
  return buildNameGroundingCtx(grounding.sourceText, grounding.knownFlavors);
}

/** Build the profile-BRAND grounding context: same cell split as flavors but
 * keyed on `knownBrands`. Returns undefined without source text. Pure. */
export function buildProfileBrandGrounding(
  grounding: SpecImportGrounding,
): ProfileFlavorGroundingCtx | undefined {
  return buildNameGroundingCtx(grounding.sourceText, grounding.knownBrands);
}

/** Build the profile SAUCE-NAME grounding context: same cell split, keyed on
 * `knownSauceNames` (existing sauce/frontline recipe names). Returns undefined
 * without source text — no grounding source means sauce names are kept as-is
 * (back-compat, never false-flagged). Pure. */
export function buildProfileSauceGrounding(
  grounding: SpecImportGrounding,
): ProfileFlavorGroundingCtx | undefined {
  return buildNameGroundingCtx(grounding.sourceText, grounding.knownSauceNames);
}

export type ProfileFlavorGroundResult =
  | { kind: "grounded" }
  | { kind: "snapped"; flavor: string }
  | { kind: "ungrounded" };

/**
 * Grounding backstop for PROFILE flavors, stricter than the recipe-target token
 * check: the parse model has been seen paraphrasing a flavor wholesale (e.g.
 * "Buffalo Chicken" -> "BBQ Chicken"), which the shared-token test cannot catch
 * ("chicken" appears in the source either way). A profile flavor is grounded
 * only when it is a known flavor OR its FULL phrase appears inside some source
 * cell. Otherwise we try to SNAP it to the nearest real flavor that does appear
 * in the source (preferring known flavors, then short source cells) by shared
 * word tokens; with no confident match it is flagged ungrounded (kept, but the
 * caller surfaces a warning) — never silently invented. Pure. */
export function groundProfileFlavor(
  flavor: string,
  ctx: ProfileFlavorGroundingCtx,
): ProfileFlavorGroundResult {
  const f = flavor.trim();
  if (!f) return { kind: "grounded" };
  const phrase = normalizePhrase(f);
  if (!phrase) return { kind: "grounded" };
  if (ctx.knownFlavorSet && ctx.knownFlavorSet.has(phrase)) return { kind: "grounded" };
  if (ctx.cells.some((c) => c.normalized.includes(phrase))) return { kind: "grounded" };

  // Not in the source and not known -> invented. Try to snap to the nearest
  // flavor that IS in the source, scored by shared word tokens.
  const toks = flavorTokens(f);
  if (toks.length === 0) return { kind: "grounded" }; // nothing checkable, keep
  const tokSet = new Set(toks);
  const score = (candidate: string): number => {
    const cToks = flavorTokens(candidate);
    if (cToks.length === 0 || cToks.length > MAX_SNAP_CANDIDATE_TOKENS) return 0;
    let shared = 0;
    const seen = new Set<string>();
    for (const t of cToks) {
      if (tokSet.has(t) && !seen.has(t)) {
        seen.add(t);
        shared++;
      }
    }
    if (shared === 0) return 0;
    return shared / Math.max(cToks.length, toks.length);
  };

  let best: { flavor: string; score: number } | undefined;
  // Known flavors present in the source are the safest candidates — check first
  // with a scoring bonus so they win ties against raw cells.
  for (const kf of ctx.knownInSource) {
    const s = score(kf);
    if (s >= 0.5 && (!best || s + 0.25 > best.score)) best = { flavor: kf, score: s + 0.25 };
  }
  for (const c of ctx.cells) {
    const s = score(c.original);
    if (s >= 0.5 && (!best || s > best.score)) best = { flavor: c.original, score: s };
  }
  if (best) return { kind: "snapped", flavor: best.flavor };
  return { kind: "ungrounded" };
}

/** Generic trailing words the parse prompt REQUIRES the model to drop from a
 * brand ("Basha's Original Pizzas" -> brand "Basha's Original"). Used both to
 * accept such transforms as grounded and to clean a cell we snap a brand to. */
const GENERIC_BRAND_TRAILER_RE = /\s+(pizzas?|recipes?|specs?)\s*$/i;

/** Strip generic trailing words ("Pizzas", "Recipe", "Specs") from a snapped
 * brand candidate, repeatedly, so snapping to a raw header cell returns the
 * product-line name the prompt would have produced. Pure. */
function stripGenericBrandTrailers(s: string): string {
  let out = s.trim();
  for (;;) {
    const next = out.replace(GENERIC_BRAND_TRAILER_RE, "");
    if (next === out) return out;
    out = next.trim();
  }
}

/** Brand word tokens that should NOT count against grounding: digit-leading
 * tokens are size/measurement folds the prompt legitimately asks the model to
 * merge INTO the brand (e.g. "Lowes 7in" from a "Lowes" header plus a size
 * cell), plus the generic trailers it asks the model to drop. Pure. */
function brandCheckTokens(brand: string): string[] {
  return flavorTokens(brand).filter(
    (t) => !/^\d/.test(t) && !GENERIC_BRAND_TRAILER_RE.test(` ${t}`),
  );
}

/**
 * Grounding backstop for PROFILE brands, mirroring `groundProfileFlavor`: a
 * paraphrased/collapsed brand (e.g. "Basha's Ultra Slim Crust" for a sheet that
 * says "Ultra Thin") would silently land profiles under a wrong/new brand and
 * mint duplicates. Unlike flavors, the prompt REQUIRES some brand transforms —
 * dropping generic trailing words like "Pizzas" and folding a size like "7in"
 * into the brand — so the check is looser: a brand is grounded when it is a
 * known brand, its full phrase appears in a cell, or its word tokens (ignoring
 * size tokens and generic trailers) are a SUBSET of a single cell's tokens.
 * Otherwise snap to the nearest known brand or source cell (generic trailers
 * stripped) by shared tokens; with no confident match it is flagged ungrounded
 * (kept + warned) — never silently invented. Pure. */
export function groundProfileBrand(
  brand: string,
  ctx: ProfileFlavorGroundingCtx,
): ProfileFlavorGroundResult {
  const b = brand.trim();
  if (!b) return { kind: "grounded" };
  const phrase = normalizePhrase(b);
  if (!phrase) return { kind: "grounded" };
  if (ctx.knownFlavorSet && ctx.knownFlavorSet.has(phrase)) return { kind: "grounded" };
  if (ctx.cells.some((c) => c.normalized.includes(phrase))) return { kind: "grounded" };

  const toks = brandCheckTokens(b);
  if (toks.length === 0) return { kind: "grounded" }; // nothing checkable, keep
  // Legitimate transforms (dropped trailers, folded sizes) leave the brand's
  // remaining tokens all inside ONE source cell — count that as grounded.
  for (const c of ctx.cells) {
    const cellToks = new Set(flavorTokens(c.original));
    if (toks.every((t) => cellToks.has(t))) return { kind: "grounded" };
  }

  // Not in the source and not known -> paraphrased/invented. Try to snap to
  // the nearest brand that IS real, scored by shared word tokens.
  const tokSet = new Set(toks);
  const score = (candidate: string): number => {
    const cToks = brandCheckTokens(candidate);
    if (cToks.length === 0 || cToks.length > MAX_SNAP_CANDIDATE_TOKENS) return 0;
    let shared = 0;
    const seen = new Set<string>();
    for (const t of cToks) {
      if (tokSet.has(t) && !seen.has(t)) {
        seen.add(t);
        shared++;
      }
    }
    if (shared === 0) return 0;
    return shared / Math.max(cToks.length, toks.length);
  };

  let best: { flavor: string; score: number } | undefined;
  // Known brands present in the source are the safest candidates — scoring
  // bonus so they win ties against raw cells.
  for (const kb of ctx.knownInSource) {
    const s = score(kb);
    if (s >= 0.5 && (!best || s + 0.25 > best.score)) best = { flavor: kb, score: s + 0.25 };
  }
  for (const c of ctx.cells) {
    const s = score(c.original);
    if (s >= 0.5 && (!best || s > best.score)) {
      const cleaned = stripGenericBrandTrailers(c.original);
      if (cleaned) best = { flavor: cleaned, score: s };
    }
  }
  if (best) return { kind: "snapped", flavor: best.flavor };
  return { kind: "ungrounded" };
}

/** Sauce-name word tokens that should count toward grounding: the literal word
 * "sauce" is generic in this context (the sheet's sauce row, the profile's
 * sauceName, and unrelated notes all carry it), so it must neither ground an
 * invented name nor flag a legitimate "X" -> "X Sauce" transform. Pure. */
function sauceCheckTokens(name: string): string[] {
  return flavorTokens(name).filter((t) => t !== "sauce");
}

/**
 * Grounding backstop for a profile's SAUCE NAME, mirroring `groundProfileBrand`:
 * a paraphrased sauce name (e.g. "Buffalo Wing Sauce" for a sheet that says
 * "Hot Buffalo Sauce") silently points the profile at a sauce recipe that
 * doesn't exist, so sauce consumption/batching never matches up. A sauce name
 * is grounded when it is a known sauce name, its full phrase appears in a
 * source cell, or its word tokens (ignoring the generic word "sauce") all sit
 * inside a SINGLE cell — the prompt legitimately captures "Hot Buffalo" from
 * the sheet as "Hot Buffalo Sauce". Otherwise snap to the nearest known sauce
 * name or source cell by shared tokens (cells that mention "sauce" are
 * preferred — they're likelier the actual sauce row); with no confident match
 * it is flagged ungrounded (kept + warned) — never silently invented. Pure. */
export function groundProfileSauceName(
  name: string,
  ctx: ProfileFlavorGroundingCtx,
): ProfileFlavorGroundResult {
  const n = name.trim();
  if (!n) return { kind: "grounded" };
  const phrase = normalizePhrase(n);
  if (!phrase) return { kind: "grounded" };
  if (ctx.knownFlavorSet && ctx.knownFlavorSet.has(phrase)) return { kind: "grounded" };
  if (ctx.cells.some((c) => c.normalized.includes(phrase))) return { kind: "grounded" };

  const toks = sauceCheckTokens(n);
  // Nothing checkable beyond the generic word ("Q Sauce" and other very short
  // names tokenize to nothing) — keep, never false-flag a short legit name.
  if (toks.length === 0) return { kind: "grounded" };
  // The sheet may name the sauce without the literal word "Sauce" ("BBQ" on
  // the sauce row -> sauceName "BBQ Sauce" is a legitimate transform, not an
  // invention): all remaining tokens inside ONE cell count as grounded.
  for (const c of ctx.cells) {
    const cellToks = new Set(flavorTokens(c.original));
    if (toks.every((t) => cellToks.has(t))) return { kind: "grounded" };
  }

  // Not in the source and not known -> paraphrased/invented. Try to snap to
  // the nearest sauce name that IS real, scored by shared word tokens.
  const tokSet = new Set(toks);
  const score = (candidate: string): number => {
    const cToks = sauceCheckTokens(candidate);
    if (cToks.length === 0 || cToks.length > MAX_SNAP_CANDIDATE_TOKENS) return 0;
    let shared = 0;
    const seen = new Set<string>();
    for (const t of cToks) {
      if (tokSet.has(t) && !seen.has(t)) {
        seen.add(t);
        shared++;
      }
    }
    if (shared === 0) return 0;
    return shared / Math.max(cToks.length, toks.length);
  };

  let best: { flavor: string; score: number } | undefined;
  // Known sauce names present in the source are the safest candidates —
  // scoring bonus so they win ties against raw cells.
  for (const ks of ctx.knownInSource) {
    const s = score(ks);
    if (s >= 0.5 && (!best || s + 0.25 > best.score)) best = { flavor: ks, score: s + 0.25 };
  }
  for (const c of ctx.cells) {
    // Never snap TO a generic placeholder ("Sauce"/"Pizza Sauce") — the
    // sanitizer drops those names outright, so they're not real candidates.
    if (isGenericSauceName(c.original)) continue;
    const base = score(c.original);
    if (base < 0.5) continue;
    // Cells that mention "sauce" are likelier the sheet's actual sauce row
    // than a same-token flavor cell (e.g. "Buffalo Chicken") — prefer them.
    const s = /sauce/i.test(c.original) ? base + 0.2 : base;
    if (!best || s > best.score) best = { flavor: c.original, score: s };
  }
  if (best) return { kind: "snapped", flavor: best.flavor };
  return { kind: "ungrounded" };
}

// ── Recipe-name grounding (stop paraphrased names minting duplicate recipes) ──

/** Generic filler words that carry no identity within a recipe name of a given
 * kind — every dough recipe may say "dough"/"mix"/"recipe", so shared filler
 * must not count as evidence that two names mean the same recipe, and differing
 * filler must not count against a match. Kind names are all included (a "dough"
 * token in a sauce name is still filler, not identity). */
const GENERIC_RECIPE_NAME_TOKENS = new Set([
  "dough",
  "doughs",
  "sauce",
  "sauces",
  "cheese",
  "cheeses",
  "mix",
  "mixes",
  "blend",
  "blends",
  "recipe",
  "recipes",
  "pizza",
  "pizzas",
]);

/** The distinctive word tokens of a recipe name: >=3-char alphanumeric words
 * minus generic kind/filler words. Pure. */
function recipeNameTokens(name: string): string[] {
  return flavorTokens(name).filter((t) => !GENERIC_RECIPE_NAME_TOKENS.has(t));
}

export type RecipeNameGroundResult =
  | { kind: "grounded" }
  | { kind: "snapped"; name: string }
  | { kind: "flagged"; match: string };

/**
 * Grounding backstop for RECIPE names: the parse model has been seen
 * paraphrasing a recipe name that already exists in the factory (e.g. "Thin
 * Crust Dough" for an existing "Ultra Thin Dough"), which the import then
 * counts as NEW and silently mints a near-duplicate recipe. Decision:
 *
 *   - exact case-insensitive match to a known name → grounded (untouched;
 *     already counts as an update downstream).
 *   - same normalized phrase (only punctuation/spacing/case differ) → snap to
 *     the existing name.
 *   - identical distinctive-word sets (only generic filler like "recipe"/"mix"
 *     differs, e.g. "Ultra Thin Dough Recipe" vs "Ultra Thin Dough"), with a
 *     unique best match → snap to the existing name.
 *   - high token overlap (>= half the distinctive words shared) → keep the
 *     name but flag the closest existing recipe so the review screen can warn
 *     about a likely duplicate.
 *   - otherwise → grounded (a genuinely new recipe passes untouched).
 *
 * Conservative by construction: an empty/blank name, an empty known list, or a
 * name with no distinctive tokens is never judged. Pure.
 */
export function groundRecipeName(
  name: string,
  knownNames: ReadonlyArray<string>,
): RecipeNameGroundResult {
  const n = name.trim();
  if (!n || knownNames.length === 0) return { kind: "grounded" };
  const lower = n.toLowerCase();
  if (knownNames.some((k) => k.trim().toLowerCase() === lower)) return { kind: "grounded" };
  const phrase = normalizePhrase(n);
  if (!phrase) return { kind: "grounded" };
  for (const k of knownNames) {
    if (normalizePhrase(k) === phrase) return { kind: "snapped", name: k.trim() };
  }
  const toks = recipeNameTokens(n);
  if (toks.length === 0) return { kind: "grounded" };
  const tokSet = new Set(toks);
  let best: { name: string; score: number } | undefined;
  let bestTied = false;
  for (const k of knownNames) {
    const cToks = recipeNameTokens(k);
    if (cToks.length === 0) continue;
    let shared = 0;
    const seen = new Set<string>();
    for (const t of cToks) {
      if (tokSet.has(t) && !seen.has(t)) {
        seen.add(t);
        shared++;
      }
    }
    if (shared === 0) continue;
    const score = shared / Math.max(cToks.length, toks.length);
    if (!best || score > best.score) {
      best = { name: k.trim(), score };
      bestTied = false;
    } else if (
      score === best.score &&
      k.trim().toLowerCase() !== best.name.toLowerCase()
    ) {
      bestTied = true;
    }
  }
  if (!best || best.score < 0.5) return { kind: "grounded" };
  // All distinctive words identical both ways and exactly one candidate says
  // so → confidently the same recipe under a paraphrased label: snap. A tie
  // (two known names both fully overlap) is ambiguous → flag instead.
  if (best.score === 1 && !bestTied) return { kind: "snapped", name: best.name };
  return { kind: "flagged", match: best.name };
}

/**
 * Coerce a loosely-typed (model-produced) object into a bounded, well-typed
 * ParsedSpecImport. Anything malformed is dropped, never throws. Used on the
 * server so both clients receive a clean, identical contract.
 */
export function sanitizeParsedSpecImport(
  raw: unknown,
  limits: SpecImportLimits = {},
  grounding: SpecImportGrounding = {},
): ParsedSpecImport {
  const lim = { ...DEFAULT_SPEC_LIMITS, ...limits };
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sourceLower = grounding.sourceText ? grounding.sourceText.toLowerCase() : undefined;
  const knownFlavorSet =
    grounding.knownFlavors && grounding.knownFlavors.length
      ? new Set(grounding.knownFlavors.map((s) => s.trim().toLowerCase()).filter(Boolean))
      : undefined;
  const profileCtx = buildProfileFlavorGrounding(grounding);
  const brandCtx = buildProfileBrandGrounding(grounding);
  const sauceCtx = buildProfileSauceGrounding(grounding);
  const groundingWarnings: SpecImportWarning[] = [];

  // Shared brand grounding backstop, used for PROFILE brands and RECIPE brand
  // anchors alike: a paraphrased/collapsed brand would silently attach data to
  // a wrong/new brand. Snap it to the nearest real brand; if no confident
  // match, keep it but warn — never silently invented. Returns the (possibly
  // snapped) brand plus warning MESSAGES: the caller keys each message to the
  // brand+flavor row it will actually appear under (profiles key to the FINAL
  // brand+flavor after BOTH groundings; recipes have no flavor row).
  const groundBrandName = (brand: string): { brand: string; messages: string[] } => {
    if (!brandCtx) return { brand, messages: [] };
    const g = groundProfileBrand(brand, brandCtx);
    if (g.kind === "snapped") {
      const snapped = clampName(g.flavor, lim.maxNameChars);
      if (snapped) {
        return { brand: snapped, messages: [`Corrected brand "${brand}" to "${g.flavor}".`] };
      }
    } else if (g.kind === "ungrounded") {
      return {
        brand,
        messages: [`Brand "${brand}" was not found on the sheet — please verify.`],
      };
    }
    return { brand, messages: [] };
  };

  const profiles: ParsedProfile[] = [];
  const rawProfiles = Array.isArray(root.profiles) ? root.profiles : [];
  for (const p of rawProfiles.slice(0, lim.maxProfiles)) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    let brand = clampName(o.brand, lim.maxNameChars);
    let flavor = clampName(o.flavor, lim.maxNameChars);
    if (!brand || !flavor) continue;
    // Grounding backstop for PROFILE brands: a paraphrased or collapsed brand
    // (e.g. a dropped "Ultra Thin" qualifier) would silently land profiles
    // under a wrong/new brand and create duplicates instead of updating
    // existing ones. Snap such a brand to the nearest real one; if no
    // confident match, keep it but warn — never silently invented.
    // Messages are collected first and keyed to the FINAL brand+flavor only
    // after BOTH groundings have run, so review UIs can attach each warning to
    // the profile row it will actually appear under.
    const brandGrounding = groundBrandName(brand);
    brand = brandGrounding.brand;
    const brandWarnMessages = brandGrounding.messages;
    // Grounding backstop for PROFILE flavors: the parse model has paraphrased
    // flavors wholesale (e.g. "Buffalo Chicken" -> "BBQ Chicken"), minting
    // profiles under a name that never appears on the sheet. Snap such an
    // invented flavor to the nearest flavor that DOES appear in the source; if
    // no confident match, keep it but surface a structured warning (attached to
    // the profile via brand+flavor) so the review screen flags it prominently —
    // never silently invented.
    if (profileCtx) {
      const g = groundProfileFlavor(flavor, profileCtx);
      if (g.kind === "snapped" && clampName(g.flavor, lim.maxNameChars)) {
        const corrected = clampName(g.flavor, lim.maxNameChars);
        groundingWarnings.push({
          brand,
          flavor: corrected,
          message: `Corrected flavor "${flavor}" to "${g.flavor}" (brand ${brand}).`,
        });
        flavor = corrected;
      } else if (g.kind === "ungrounded") {
        groundingWarnings.push({
          brand,
          flavor,
          message: `Flavor "${flavor}" (brand ${brand}) was not found on the sheet — please verify.`,
        });
      }
    }
    for (const message of brandWarnMessages) {
      groundingWarnings.push({ brand, flavor, message });
    }
    const applicators: ParsedApplicator[] = [];
    const rawApps = Array.isArray(o.applicators) ? o.applicators : [];
    for (const a of rawApps.slice(0, lim.maxApplicators)) {
      if (!a || typeof a !== "object") continue;
      const ao = a as Record<string, unknown>;
      const type = clampName(ao.type, lim.maxNameChars);
      const ozPerPizza = num(ao.ozPerPizza);
      if (!type) continue;
      if (ozPerPizza == null) {
        // A missing oz value silently becoming 0 looks like the sheet SAID
        // "0 oz" in the review preview. Flag it so the user checks the sheet.
        groundingWarnings.push({
          brand,
          flavor,
          message: `No oz-per-pizza was read for applicator "${type}" — shown as 0 oz. Please verify against the sheet.`,
        });
      }
      applicators.push({ type, ozPerPizza: ozPerPizza ?? 0 });
    }
    const pepperonis: ParsedPepperoni[] = [];
    const rawPeps = Array.isArray(o.pepperonis) ? o.pepperonis : [];
    for (const pp of rawPeps.slice(0, lim.maxPepperonis)) {
      if (!pp || typeof pp !== "object") continue;
      const po = pp as Record<string, unknown>;
      const type = clampName(po.type, lim.maxNameChars);
      if (!type) continue;
      const ppOz = num(po.ozPerPizza);
      if (ppOz == null) {
        groundingWarnings.push({
          brand,
          flavor,
          message: `No oz-per-pizza was read for pepperoni "${type}" — shown as 0 oz. Please verify against the sheet.`,
        });
      }
      pepperonis.push({
        type,
        sticks: num(po.sticks) ?? 0,
        ozPerPizza: ppOz ?? 0,
      });
    }
    const profile: ParsedProfile = { brand, flavor, applicators, pepperonis };
    const die = clampName(o.dieType, lim.maxNameChars);
    if (die) profile.dieType = die;
    const sauceOz = num(o.sauceOzPerPizza);
    if (sauceOz != null) profile.sauceOzPerPizza = sauceOz;
    const sauceName = clampName(o.sauceName, lim.maxNameChars);
    if (sauceName && !isGenericSauceName(sauceName)) {
      // Grounding backstop for the profile's SAUCE NAME, same snap-or-flag
      // semantics as brands/flavors: a paraphrased sauce name (e.g. "Buffalo
      // Wing Sauce" for a sheet that says "Hot Buffalo Sauce") silently points
      // the profile at a sauce recipe that doesn't exist, so consumption and
      // batching never match up. Warnings key to the FINAL (already grounded)
      // brand+flavor row so review UIs attach them to the right profile.
      let grounded = sauceName;
      if (sauceCtx) {
        const g = groundProfileSauceName(sauceName, sauceCtx);
        if (g.kind === "snapped") {
          const corrected = clampName(g.flavor, lim.maxNameChars);
          if (corrected && !isGenericSauceName(corrected)) {
            groundingWarnings.push({
              brand,
              flavor,
              message: `Corrected sauce "${sauceName}" to "${g.flavor}" (brand ${brand}, flavor ${flavor}).`,
            });
            grounded = corrected;
          }
        } else if (g.kind === "ungrounded") {
          groundingWarnings.push({
            brand,
            flavor,
            message: `Sauce "${sauceName}" (brand ${brand}, flavor ${flavor}) was not found on the sheet — please verify.`,
          });
        }
      }
      profile.sauceName = grounded;
    }
    profiles.push(profile);
  }

  const recipes: ParsedRecipe[] = [];
  const rawRecipes = Array.isArray(root.recipes) ? root.recipes : [];
  for (const r of rawRecipes.slice(0, lim.maxRecipes)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kindRaw = clampName(o.kind, 16).toLowerCase();
    const kind = kindRaw === "dough" || kindRaw === "sauce" || kindRaw === "cheese" ? kindRaw : null;
    if (!kind) continue;
    // Keep the name even when blank: a recipe with real rows but no name should
    // reach the review screen flagged "needs a name" (the apply step skips blank
    // names) instead of vanishing silently.
    const name = clampName(o.name, lim.maxNameChars);
    const rows: RecipeRow[] = [];
    const rawRows = Array.isArray(o.rows) ? o.rows : [];
    for (const row of rawRows.slice(0, lim.maxRecipeRows)) {
      if (!row || typeof row !== "object") continue;
      const ro = row as Record<string, unknown>;
      const ingredient = clampName(ro.ingredient, lim.maxNameChars);
      const lbs = num(ro.lbs);
      if (!ingredient || lbs == null) continue;
      rows.push({ ingredient, lbs });
    }
    if (rows.length === 0) continue;
    // Pepperoni is a pep TYPE (captured on the profile's `pepperonis`), not a
    // recipe. Drop a cheese recipe whose ingredients are purely pepperoni so it
    // never imports as a bogus "cheese recipe".
    if (kind === "cheese" && isPepperoniOnlyCheeseRecipe(rows)) continue;
    const recipe: ParsedRecipe = { kind, name, rows };
    // Grounding backstop for RECIPE brands, same semantics as profiles: a
    // paraphrased recipe brand silently attaches a dough/sauce/cheese recipe
    // to a wrong/new brand, so it never shows on the intended products.
    // Recipes have no flavor row to attach to, so warnings key to the grounded
    // brand with an empty flavor.
    const brand = clampName(o.brand, lim.maxNameChars);
    if (brand) {
      const g = groundBrandName(brand);
      recipe.brand = g.brand;
      for (const message of g.messages) {
        groundingWarnings.push({ brand: g.brand, flavor: "", message });
      }
    }
    // Grounding backstop for the RECIPE's own NAME: a paraphrased name that
    // already exists in the factory (e.g. "Thin Crust Dough" for an existing
    // "Ultra Thin Dough") would count as NEW downstream and silently mint a
    // near-duplicate recipe. Snap a confident variant to the existing name;
    // flag a plausible-but-uncertain match with a structured warning so the
    // review screen surfaces the likely duplicate. Exact names and genuinely
    // new recipes pass untouched; no known list for the kind means no change.
    const knownRecipeNames = grounding.knownRecipeNames?.[kind];
    if (name && knownRecipeNames && knownRecipeNames.length) {
      const g = groundRecipeName(name, knownRecipeNames);
      if (g.kind === "snapped") {
        const snapped = clampName(g.name, lim.maxNameChars);
        if (snapped && snapped.toLowerCase() !== name.toLowerCase()) {
          groundingWarnings.push({
            brand: recipe.brand ?? "",
            flavor: "",
            message: `Matched ${kind} recipe "${name}" to existing "${g.name}".`,
          });
          recipe.name = snapped;
        }
      } else if (g.kind === "flagged") {
        groundingWarnings.push({
          brand: recipe.brand ?? "",
          flavor: "",
          message: `New ${kind} recipe "${name}" closely matches existing "${g.match}" — verify it isn't a duplicate.`,
        });
      }
    }
    let flavor = clampName(o.flavor, lim.maxNameChars);
    // Grounding backstop for the RECIPE's own flavor, same snap-or-flag
    // semantics as profile flavors: a paraphrased flavor here (e.g. "BBQ
    // Chicken" for a sheet that says "Buffalo Chicken") silently scopes a
    // dough/sauce/cheese recipe to a flavor that doesn't exist, so it never
    // shows on the intended product. Catch-all flavors (a whole-brand scope
    // word or the recipe's own kind) are placeholders, not inventions — skip
    // grounding for those so they aren't false-flagged. Warnings key to the
    // (already grounded) recipe brand + flavor.
    if (flavor && profileCtx && !isCatchAllFlavor(flavor, kind)) {
      const g = groundProfileFlavor(flavor, profileCtx);
      if (g.kind === "snapped" && clampName(g.flavor, lim.maxNameChars)) {
        const corrected = clampName(g.flavor, lim.maxNameChars);
        groundingWarnings.push({
          brand: recipe.brand ?? "",
          flavor: corrected,
          message: `Corrected flavor "${flavor}" to "${g.flavor}"${recipe.brand ? ` (brand ${recipe.brand})` : ""}.`,
        });
        flavor = corrected;
      } else if (g.kind === "ungrounded") {
        groundingWarnings.push({
          brand: recipe.brand ?? "",
          flavor,
          message: `Flavor "${flavor}"${recipe.brand ? ` (brand ${recipe.brand})` : ""} was not found on the sheet — please verify.`,
        });
      }
    }
    if (flavor) recipe.flavor = flavor;
    const rawTargets = Array.isArray(o.targets) ? o.targets : [];
    if (rawTargets.length) {
      const targets: ParsedRecipeTarget[] = [];
      // A target whose flavor is a whole-brand scope word ("All Varieties") or the
      // recipe's own kind ("Dough") is not a real profile — keep it as a brand-wide
      // anchor instead of a junk brand/"All Varieties" profile. recipeApplyTargets()
      // then fans the recipe out to every real flavor of each such brand. A shared
      // recipe can carry SEVERAL catch-all brands (e.g. a dough "used for Hannaford
      // and Lucia"), so collect them ALL — collapsing to one would silently drop the
      // rest.
      const anchors: string[] = [];
      const anchorSeen = new Set<string>();
      for (const t of rawTargets.slice(0, lim.maxProfiles)) {
        if (!t || typeof t !== "object") continue;
        const to = t as Record<string, unknown>;
        const tbRaw = clampName(to.brand, lim.maxNameChars);
        const tf = clampName(to.flavor, lim.maxNameChars);
        if (!tbRaw) continue;
        // Ground the target's brand half too (the flavor half already gets the
        // token check below); a paraphrased target brand would fan the recipe
        // out to a wrong/new brand or mint a junk anchor. Warnings key to the
        // grounded brand with an empty flavor (no profile row yet).
        const tg = groundBrandName(tbRaw);
        const tb = tg.brand;
        for (const message of tg.messages) {
          groundingWarnings.push({ brand: tb, flavor: "", message });
        }
        // A whole-brand scope word ("All Varieties") or the recipe's own kind, OR a
        // specific flavor the model invented that appears nowhere in the source and
        // isn't a known flavor — all become brand-wide anchors rather than junk
        // brand+flavor profiles.
        if (
          isCatchAllFlavor(tf, kind) ||
          !isGroundedFlavor(tf, { sourceLower, knownFlavorSet })
        ) {
          const key = tb.toLowerCase();
          if (!anchorSeen.has(key)) {
            anchorSeen.add(key);
            anchors.push(tb);
          }
          continue;
        }
        targets.push({ brand: tb, flavor: tf });
      }
      if (targets.length) recipe.targets = targets;
      if (anchors.length) {
        recipe.brandAnchors = anchors;
        // Back-compat single-brand display: when the recipe had no singular brand
        // and exactly one catch-all brand, expose it as `brand` too. With several
        // anchors, leave `brand` empty (no single brand is representative) and rely
        // on brandAnchors for the fan-out.
        if (!recipe.brand && anchors.length === 1) recipe.brand = anchors[0];
      }
    }
    if (kind === "dough") {
      const oz = num(o.doughballOz);
      if (oz != null) recipe.doughballOz = oz;
    }
    if (kind === "cheese") {
      const app = num(o.app);
      if (app != null && app >= 1 && app <= 4) recipe.app = Math.round(app);
    }
    recipes.push(recipe);
  }

  const result: ParsedSpecImport = { profiles, recipes };
  const note = clampName(root.note, 400);
  if (note) result.note = note;
  // Surface flavor-grounding corrections/flags as STRUCTURED warnings (not
  // folded into `note`) so review screens can attach each to its profile row
  // prominently. Dedup repeated profiles; bounded so a flood can't bloat the
  // payload. Keeping them out of `note` also stops a mere correction from
  // making the pass look "failed" to the chunk-retry rule.
  if (groundingWarnings.length) {
    const seenW = new Set<string>();
    const unique: SpecImportWarning[] = [];
    for (const w of groundingWarnings) {
      const key = `${w.brand.toLowerCase()}|${w.flavor.toLowerCase()}|${w.message.toLowerCase()}`;
      if (seenW.has(key)) continue;
      seenW.add(key);
      unique.push(w);
      if (unique.length >= 10) break;
    }
    result.warnings = unique;
  }
  return result;
}

// ── Import summary (new vs updated) ──────────────────────────────────────────

export type SpecImportSummary = {
  profilesNew: number;
  profilesUpdated: number;
  recipesNew: number;
  recipesUpdated: number;
  totalProfiles: number;
  totalRecipes: number;
};

/**
 * Count how many parsed profiles / recipes would be newly created vs overwrite
 * an existing one. `profileExists(brand, flavor)` and `recipeExists(kind, name)`
 * are supplied by the caller (they read platform storage). Pure + deterministic.
 */
export function summarizeSpecImport(
  parsed: ParsedSpecImport,
  profileExists: (brand: string, flavor: string) => boolean,
  recipeExists: (kind: ParsedRecipe["kind"], name: string) => boolean,
): SpecImportSummary {
  let profilesNew = 0;
  let profilesUpdated = 0;
  for (const p of parsed.profiles) {
    if (profileExists(p.brand, p.flavor)) profilesUpdated++;
    else profilesNew++;
  }
  let recipesNew = 0;
  let recipesUpdated = 0;
  for (const r of parsed.recipes) {
    if (recipeExists(r.kind, r.name)) recipesUpdated++;
    else recipesNew++;
  }
  return {
    profilesNew,
    profilesUpdated,
    recipesNew,
    recipesUpdated,
    totalProfiles: parsed.profiles.length,
    totalRecipes: parsed.recipes.length,
  };
}

/** A confident AI match from /ai/match-import: an external `candidate` name the
 * server resolved to an existing canonical `match`. */
export type NameMatch = { candidate: string; match: string };
/** A brand-scoped flavor match: `match` is the existing flavor within `brand`. */
export type ScopedNameMatch = { brand: string; candidate: string; match: string };
/** A recipe-kind-scoped ingredient match: `match` is an existing ingredient in that kind's pool. */
export type IngredientNameMatch = { kind: "dough" | "sauce" | "cheese"; candidate: string; match: string };

/** Optional non-brand/flavor AI matches applied alongside brand/flavor. */
export type ExtraNameMatches = {
  ingredientMatches?: ReadonlyArray<IngredientNameMatch>;
  appTypeMatches?: ReadonlyArray<NameMatch>;
  pepTypeMatches?: ReadonlyArray<NameMatch>;
};

export type AppliedNameMatches = {
  parsed: ParsedSpecImport;
  /** Brand + brand-scoped flavor alias pairs worth remembering (self-refs dropped). */
  aliases: SpecImportAlias[];
};

const recipeKindToIngredientAliasKind = (k: "dough" | "sauce" | "cheese"): SpecAliasKind =>
  k === "dough" ? "doughIngredient" : k === "sauce" ? "sauceIngredient" : "cheeseIngredient";

/**
 * Apply confident AI brand/flavor matches to a canonicalized parse so names that
 * fuzzy-canonicalize as "new" but actually mean an existing brand/flavor get
 * folded onto the real one (no duplicate created). Renames brands first, then
 * flavors within the resolved brand, across profiles, recipe brand/flavor and
 * recipe `targets`. The matches come from the server, which already canonicalizes
 * its output to real saved names; this only rewires the parse and records the
 * pairs for the learned-alias pool. Pure + non-mutating.
 */
export function applyNameMatches(
  parsed: ParsedSpecImport,
  brandMatches: ReadonlyArray<NameMatch>,
  flavorMatches: ReadonlyArray<ScopedNameMatch>,
  extra: ExtraNameMatches = {},
): AppliedNameMatches {
  const brandMap = new Map<string, string>();
  for (const m of brandMatches) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match) continue;
    brandMap.set(cand.toLowerCase(), match);
  }
  const renameBrand = (b: string | undefined): string | undefined => {
    if (b == null) return b;
    return brandMap.get(b.trim().toLowerCase()) ?? b;
  };

  // Keyed by the RESOLVED (canonical) brand so flavor scoping matches the glue,
  // which builds unmatched flavors against the already brand-matched brand.
  const flavorMap = new Map<string, string>();
  const flavorKey = (brand: string, flavor: string) =>
    `${brand.trim().toLowerCase()}\u0000${flavor.trim().toLowerCase()}`;
  for (const m of flavorMatches) {
    const brand = (m.brand ?? "").trim();
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!brand || !cand || !match) continue;
    flavorMap.set(flavorKey(brand, cand), match);
  }
  const renameFlavor = (brand: string | undefined, flavor: string | undefined): string | undefined => {
    if (flavor == null) return flavor;
    return flavorMap.get(flavorKey(brand ?? "", flavor)) ?? flavor;
  };

  // Recipe-kind-scoped ingredient renames + flat applicator/pepperoni-type renames.
  const ingKey = (kind: string, name: string) => `${kind}\u0000${name.trim().toLowerCase()}`;
  const ingMap = new Map<string, string>();
  for (const m of extra.ingredientMatches ?? []) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match) continue;
    ingMap.set(ingKey(m.kind, cand), match);
  }
  const appMap = new Map<string, string>();
  for (const m of extra.appTypeMatches ?? []) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match) continue;
    appMap.set(cand.toLowerCase(), match);
  }
  const pepMap = new Map<string, string>();
  for (const m of extra.pepTypeMatches ?? []) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match) continue;
    pepMap.set(cand.toLowerCase(), match);
  }
  const renameApp = (t: string) => appMap.get(t.trim().toLowerCase()) ?? t;
  const renamePep = (t: string) => pepMap.get(t.trim().toLowerCase()) ?? t;

  const profiles = parsed.profiles.map((p) => {
    const brand = renameBrand(p.brand) ?? p.brand;
    const flavor = renameFlavor(brand, p.flavor) ?? p.flavor;
    const applicators = appMap.size
      ? p.applicators.map((a) => ({ ...a, type: renameApp(a.type) }))
      : p.applicators;
    const pepperonis = pepMap.size
      ? p.pepperonis.map((pp) => ({ ...pp, type: renamePep(pp.type) }))
      : p.pepperonis;
    return { ...p, brand, flavor, applicators, pepperonis };
  });

  const recipes = parsed.recipes.map((r) => {
    const out: ParsedRecipe = { ...r };
    if (r.brand != null) {
      out.brand = renameBrand(r.brand);
      out.flavor = renameFlavor(out.brand, r.flavor);
    }
    if (r.targets && r.targets.length) {
      out.targets = r.targets.map((t): ParsedRecipeTarget => {
        const brand = renameBrand(t.brand) ?? t.brand;
        return { brand, flavor: renameFlavor(brand, t.flavor) ?? t.flavor };
      });
    }
    if (ingMap.size && r.rows.length) {
      out.rows = r.rows.map((row) => {
        const match = ingMap.get(ingKey(r.kind, row.ingredient));
        return match ? { ...row, ingredient: match } : row;
      });
    }
    return out;
  });

  const aliasByKey = new Map<string, SpecImportAlias>();
  for (const m of brandMatches) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match || cand.toLowerCase() === match.toLowerCase()) continue;
    aliasByKey.set(specAliasKey("brand", cand, null), {
      kind: "brand",
      externalName: cand,
      canonicalName: match,
      context: null,
    });
  }
  for (const m of flavorMatches) {
    const brand = (m.brand ?? "").trim();
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!brand || !cand || !match || cand.toLowerCase() === match.toLowerCase()) continue;
    aliasByKey.set(specAliasKey("flavor", cand, brand), {
      kind: "flavor",
      externalName: cand,
      canonicalName: match,
      context: brand,
    });
  }
  for (const m of extra.ingredientMatches ?? []) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match || cand.toLowerCase() === match.toLowerCase()) continue;
    const kind = recipeKindToIngredientAliasKind(m.kind);
    aliasByKey.set(specAliasKey(kind, cand, null), {
      kind,
      externalName: cand,
      canonicalName: match,
      context: null,
    });
  }
  for (const m of extra.appTypeMatches ?? []) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match || cand.toLowerCase() === match.toLowerCase()) continue;
    aliasByKey.set(specAliasKey("appType", cand, null), {
      kind: "appType",
      externalName: cand,
      canonicalName: match,
      context: null,
    });
  }
  for (const m of extra.pepTypeMatches ?? []) {
    const cand = (m.candidate ?? "").trim();
    const match = (m.match ?? "").trim();
    if (!cand || !match || cand.toLowerCase() === match.toLowerCase()) continue;
    aliasByKey.set(specAliasKey("pepType", cand, null), {
      kind: "pepType",
      externalName: cand,
      canonicalName: match,
      context: null,
    });
  }

  // Keep grounding warnings attached to the RENAMED profile names so review
  // screens can still match each warning to its (now-canonical) profile row.
  const warnings = parsed.warnings?.length
    ? parsed.warnings.map((w) => {
        const brand = renameBrand(w.brand) ?? w.brand;
        return { ...w, brand, flavor: renameFlavor(brand, w.flavor) ?? w.flavor };
      })
    : undefined;

  return {
    parsed: {
      profiles,
      recipes,
      ...(parsed.note ? { note: parsed.note } : {}),
      ...(warnings ? { warnings } : {}),
    },
    aliases: [...aliasByKey.values()],
  };
}

export type SpecMatchKnown = {
  brands: ReadonlyArray<string>;
  flavorsByBrand: Readonly<Record<string, ReadonlyArray<string>>>;
  doughIngredients: ReadonlyArray<string>;
  sauceIngredients: ReadonlyArray<string>;
  cheeseIngredients: ReadonlyArray<string>;
  appTypes: ReadonlyArray<string>;
  pepTypes: ReadonlyArray<string>;
};

export type SpecMatchCandidates = {
  brands: string[];
  flavors: { brand: string; flavor: string }[];
  ingredients: { kind: "dough" | "sauce" | "cheese"; name: string }[];
  appTypes: string[];
  pepTypes: string[];
};

/**
 * Collect names in a canonicalized parse that are NOT present in the known saved
 * lists and therefore are candidates for an AI match pass (so a fuzzy "new" name
 * can be folded onto an existing one instead of creating a duplicate). Flavors
 * are only collected under an ALREADY-known brand (the match endpoint scopes
 * flavors to a resolved brand); run brand matching first, then re-collect to pick
 * up flavors that fall under a newly-corrected brand. Pure.
 */
export function collectMatchCandidates(
  parsed: ParsedSpecImport,
  known: SpecMatchKnown,
): SpecMatchCandidates {
  const lc = (s: string) => s.trim().toLowerCase();
  const brandSet = new Set(known.brands.map(lc));
  const flavorsByBrand = new Map<string, Set<string>>();
  for (const [b, fs] of Object.entries(known.flavorsByBrand)) {
    flavorsByBrand.set(lc(b), new Set((fs ?? []).map(lc)));
  }
  const doughSet = new Set(known.doughIngredients.map(lc));
  const sauceSet = new Set(known.sauceIngredients.map(lc));
  const cheeseSet = new Set(known.cheeseIngredients.map(lc));
  const appSet = new Set(known.appTypes.map(lc));
  const pepSet = new Set(known.pepTypes.map(lc));
  const setFor = (kind: "dough" | "sauce" | "cheese") =>
    kind === "dough" ? doughSet : kind === "sauce" ? sauceSet : cheeseSet;

  const brands = new Map<string, string>();
  const flavors = new Map<string, { brand: string; flavor: string }>();
  const ingredients = new Map<string, { kind: "dough" | "sauce" | "cheese"; name: string }>();
  const appTypes = new Map<string, string>();
  const pepTypes = new Map<string, string>();

  const noteBrand = (b?: string) => {
    const t = (b ?? "").trim();
    if (t && !brandSet.has(lc(t))) brands.set(lc(t), t);
  };
  const noteFlavor = (brand?: string, flavor?: string) => {
    const b = (brand ?? "").trim();
    const f = (flavor ?? "").trim();
    if (!b || !f || !brandSet.has(lc(b))) return;
    const kf = flavorsByBrand.get(lc(b));
    if (kf && kf.has(lc(f))) return;
    flavors.set(`${lc(b)}\u0000${lc(f)}`, { brand: b, flavor: f });
  };
  const noteApp = (t?: string) => {
    const v = (t ?? "").trim();
    if (v && !appSet.has(lc(v))) appTypes.set(lc(v), v);
  };
  const notePep = (t?: string) => {
    const v = (t ?? "").trim();
    if (v && !pepSet.has(lc(v))) pepTypes.set(lc(v), v);
  };
  const noteIng = (kind: "dough" | "sauce" | "cheese", name?: string) => {
    const v = (name ?? "").trim();
    if (!v || setFor(kind).has(lc(v))) return;
    ingredients.set(`${kind}\u0000${lc(v)}`, { kind, name: v });
  };

  for (const p of parsed.profiles) {
    noteBrand(p.brand);
    noteFlavor(p.brand, p.flavor);
    for (const a of p.applicators) noteApp(a.type);
    for (const pp of p.pepperonis) notePep(pp.type);
  }
  for (const r of parsed.recipes) {
    noteBrand(r.brand);
    noteFlavor(r.brand, r.flavor);
    for (const t of r.targets ?? []) {
      noteBrand(t.brand);
      noteFlavor(t.brand, t.flavor);
    }
    for (const row of r.rows) noteIng(r.kind, row.ingredient);
  }

  return {
    brands: [...brands.values()],
    flavors: [...flavors.values()],
    ingredients: [...ingredients.values()],
    appTypes: [...appTypes.values()],
    pepTypes: [...pepTypes.values()],
  };
}

export type CrossFillResult = { parsed: ParsedSpecImport; filledCount: number };

/**
 * Fill a profile's missing `dieType` / `sauceOzPerPizza` from its same-brand
 * siblings, but ONLY when every sibling that specifies the field agrees on
 * exactly one value (unambiguous). Existing values are never overridden and a
 * conflict leaves the blank as-is. Same-brand means an identical brand string
 * (case-insensitive) — size is folded into the brand at parse time, so this
 * stays within one product/size. Pure + non-mutating.
 */
export function crossFillSpecImport(parsed: ParsedSpecImport): CrossFillResult {
  // value === null marks a conflict (≥2 distinct specified values).
  const dieByBrand = new Map<string, string | null>();
  const sauceByBrand = new Map<string, number | null>();
  const note = <T>(map: Map<string, T | null>, key: string, val: T) => {
    if (!map.has(key)) map.set(key, val);
    else {
      const cur = map.get(key);
      if (cur !== null && cur !== val) map.set(key, null);
    }
  };
  for (const p of parsed.profiles) {
    const key = p.brand.trim().toLowerCase();
    if (!key) continue;
    if (p.dieType != null && p.dieType.trim()) note(dieByBrand, key, p.dieType.trim());
    if (p.sauceOzPerPizza != null && Number.isFinite(p.sauceOzPerPizza)) {
      note(sauceByBrand, key, p.sauceOzPerPizza);
    }
  }

  let filledCount = 0;
  const profiles = parsed.profiles.map((p) => {
    const key = p.brand.trim().toLowerCase();
    const out = { ...p };
    if (out.dieType == null || !out.dieType.trim()) {
      const v = dieByBrand.get(key);
      if (v != null) {
        out.dieType = v;
        filledCount += 1;
      }
    }
    if (out.sauceOzPerPizza == null) {
      const v = sauceByBrand.get(key);
      if (v != null) {
        out.sauceOzPerPizza = v;
        filledCount += 1;
      }
    }
    return out;
  });

  return { parsed: { ...parsed, profiles }, filledCount };
}

// ── AI parse-pass retry rule ────────────────────────────────────────────────

/**
 * Chunks whose prompt text is at least this many characters are expected to
 * yield SOMETHING; an empty parse for one is treated as a failed AI pass and
 * retried once. Tiny chunks (e.g. a stray header-only sheet) can legitimately
 * parse to nothing, so they are never retried. Shared by web + mobile glue so
 * the retry rule cannot drift between apps.
 */
export const RETRY_MIN_CHUNK_CHARS = 200;

/** Minimal shape of a raw AI parse pass the retry rule needs to inspect. */
export type ParsePassLike = {
  profiles: unknown[];
  recipes: unknown[];
  note?: string;
};

/**
 * True when an AI parse pass came back unusable: nothing extracted, or the
 * server attached a failure note (it returns empty + note when the model's
 * response was cut off / malformed). Pure.
 */
export function isFailedParsePass(ai: ParsePassLike): boolean {
  return (ai.profiles.length === 0 && ai.recipes.length === 0) || Boolean(ai.note);
}

/**
 * Whole retry decision for one chunk: retry exactly once when the pass failed
 * AND the chunk's prompt text is non-trivial (≥ RETRY_MIN_CHUNK_CHARS). Tiny
 * chunks never retry — an empty parse for them is legitimate. Pure.
 */
export function shouldRetryParsePass(ai: ParsePassLike, workbookText: string): boolean {
  return isFailedParsePass(ai) && workbookText.length >= RETRY_MIN_CHUNK_CHARS;
}

/**
 * Pick the pass to keep after a retry: the retry replaces the original only
 * when the retry itself is usable; a failed retry keeps the original (noted)
 * result so its note still surfaces. Pure.
 */
export function resolveRetriedParsePass<T extends ParsePassLike>(original: T, retry: T): T {
  return isFailedParsePass(retry) ? original : retry;
}
