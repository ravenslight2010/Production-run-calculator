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
  /** Dough only: target doughball weight in oz. */
  doughballOz?: number;
  /** Cheese only: applicator slot (1-4) the recipe should tie to. */
  app?: number;
  rows: RecipeRow[];
};

export type ParsedSpecImport = {
  profiles: ParsedProfile[];
  recipes: ParsedRecipe[];
  note?: string;
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
  for (const item of list) {
    for (const p of item.profiles) {
      profileMap.set(`${p.brand.trim().toLowerCase()}|${p.flavor.trim().toLowerCase()}`, p);
    }
    for (const r of item.recipes) {
      recipeMap.set(`${r.kind}|${r.name.trim().toLowerCase()}`, r);
    }
    if (item.note && item.note.trim()) notes.push(item.note.trim());
  }
  const result: ParsedSpecImport = {
    profiles: [...profileMap.values()],
    recipes: [...recipeMap.values()],
  };
  if (notes.length) result.note = notes.join("\n");
  return result;
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

  const aliased = pickAlias(aliases, kind, externalName, context);
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

const DEFAULT_LIMITS: Required<GridTextLimits> = {
  maxSheets: 24,
  maxRows: 1000,
  maxCols: 60,
  maxCellChars: 80,
  // Kept just under the server's MAX_WORKBOOK_CHARS (60k) so a large or
  // multi-sheet workbook is sent in full instead of being truncated client-side
  // before the AI ever sees it (was 24k, which silently dropped big imports).
  maxTotalChars: 56000,
};

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
      const cells = row.slice(0, lim.maxCols).map((c) => {
        const s = (c ?? "").toString().replace(/\s+/g, " ").trim();
        return s.length > lim.maxCellChars ? s.slice(0, lim.maxCellChars) : s;
      });
      // drop trailing empties
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
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

// ── Sanitization of the AI parse result (shared by server) ───────────────────

export type SpecImportLimits = {
  maxProfiles?: number;
  maxRecipes?: number;
  maxApplicators?: number;
  maxPepperonis?: number;
  maxRecipeRows?: number;
  maxNameChars?: number;
};

const DEFAULT_SPEC_LIMITS: Required<SpecImportLimits> = {
  maxProfiles: 100,
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

function num(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Coerce a loosely-typed (model-produced) object into a bounded, well-typed
 * ParsedSpecImport. Anything malformed is dropped, never throws. Used on the
 * server so both clients receive a clean, identical contract.
 */
export function sanitizeParsedSpecImport(raw: unknown, limits: SpecImportLimits = {}): ParsedSpecImport {
  const lim = { ...DEFAULT_SPEC_LIMITS, ...limits };
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const profiles: ParsedProfile[] = [];
  const rawProfiles = Array.isArray(root.profiles) ? root.profiles : [];
  for (const p of rawProfiles.slice(0, lim.maxProfiles)) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const brand = clampName(o.brand, lim.maxNameChars);
    const flavor = clampName(o.flavor, lim.maxNameChars);
    if (!brand || !flavor) continue;
    const applicators: ParsedApplicator[] = [];
    const rawApps = Array.isArray(o.applicators) ? o.applicators : [];
    for (const a of rawApps.slice(0, lim.maxApplicators)) {
      if (!a || typeof a !== "object") continue;
      const ao = a as Record<string, unknown>;
      const type = clampName(ao.type, lim.maxNameChars);
      const ozPerPizza = num(ao.ozPerPizza);
      if (!type) continue;
      applicators.push({ type, ozPerPizza: ozPerPizza ?? 0 });
    }
    const pepperonis: ParsedPepperoni[] = [];
    const rawPeps = Array.isArray(o.pepperonis) ? o.pepperonis : [];
    for (const pp of rawPeps.slice(0, lim.maxPepperonis)) {
      if (!pp || typeof pp !== "object") continue;
      const po = pp as Record<string, unknown>;
      const type = clampName(po.type, lim.maxNameChars);
      if (!type) continue;
      pepperonis.push({
        type,
        sticks: num(po.sticks) ?? 0,
        ozPerPizza: num(po.ozPerPizza) ?? 0,
      });
    }
    const profile: ParsedProfile = { brand, flavor, applicators, pepperonis };
    const die = clampName(o.dieType, lim.maxNameChars);
    if (die) profile.dieType = die;
    const sauceOz = num(o.sauceOzPerPizza);
    if (sauceOz != null) profile.sauceOzPerPizza = sauceOz;
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
    const name = clampName(o.name, lim.maxNameChars);
    if (!name) continue;
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
    const recipe: ParsedRecipe = { kind, name, rows };
    const brand = clampName(o.brand, lim.maxNameChars);
    if (brand) recipe.brand = brand;
    const flavor = clampName(o.flavor, lim.maxNameChars);
    if (flavor) recipe.flavor = flavor;
    const rawTargets = Array.isArray(o.targets) ? o.targets : [];
    if (rawTargets.length) {
      const targets: ParsedRecipeTarget[] = [];
      for (const t of rawTargets.slice(0, lim.maxProfiles)) {
        if (!t || typeof t !== "object") continue;
        const to = t as Record<string, unknown>;
        const tb = clampName(to.brand, lim.maxNameChars);
        const tf = clampName(to.flavor, lim.maxNameChars);
        if (!tb || !tf) continue;
        targets.push({ brand: tb, flavor: tf });
      }
      if (targets.length) recipe.targets = targets;
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
