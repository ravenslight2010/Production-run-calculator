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
  if (explicit.length) return explicit;
  // No explicit target. A brand without a flavor is the only safe anchor:
  // link to every same-brand profile in this import.
  const brand = (r.brand ?? "").trim();
  if (!brand) return [];
  const wantBrand = brand.toLowerCase();
  const out: ParsedRecipeTarget[] = [];
  const seen = new Set<string>();
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

/**
 * Split one workbook's grids into chunks that each render under the prompt char
 * budget (and per-call sheet/row caps), so a large workbook is parsed across
 * several AI calls instead of being silently truncated by gridsToPromptText.
 * Sheets are kept in order; a sheet too large for one chunk is split across
 * chunks by rows (each chunk re-emits the sheet header). Rows beyond `maxChunks`
 * chunks are reported as `droppedRows` so the caller can note them precisely.
 * Pure + deterministic.
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
      let blockChars = headerLen;
      while (i < rows.length && blockRows.length < lim.maxRows) {
        const add = rows[i].join("\t").length + 1;
        if (curChars + blockChars + add > budget) {
          // A single row larger than the whole budget on an empty chunk: take it
          // anyway so we always make forward progress (it becomes its own row).
          if (blockRows.length === 0 && cur.length === 0) {
            blockRows.push(rows[i]);
            blockChars += add;
            i += 1;
          }
          break;
        }
        blockRows.push(rows[i]);
        blockChars += add;
        i += 1;
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

  return {
    parsed: { profiles, recipes, ...(parsed.note ? { note: parsed.note } : {}) },
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
