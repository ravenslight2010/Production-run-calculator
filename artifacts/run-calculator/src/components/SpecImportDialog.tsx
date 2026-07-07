import { useEffect, useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  recipeApplyIssue,
  profileApplyIssue,
  recipeApplyTargets,
  buildSpecRenameMaps,
  remapRecipeForRenames,
  crossFillSpecImport,
  collectSpecRenameAliases,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedRecipeTarget,
  type ParsedSpecImport,
  type SpecProfileRename,
  type SpecImportAlias,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import { buildDiscrepancies } from "@/specImport";
import {
  profileExistsForImport,
  recipeExistsForImport,
  existingDieTypesForImport,
  specImportRecipeDisplayKind,
  type SpecImportDisplayKind,
} from "@/storage";
import ReviewBadge from "./ReviewBadge";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: SpecImportPrepared | null;
  applying: boolean;
  /**
   * Existing recipe names, per display kind, the "use my existing recipe" picker
   * can offer. Cheese and mix are server-backed factory master-data (and dough /
   * sauce too), so the parent sources these from the live server pools — NOT the
   * dormant local presets — or the picker would only list the one-time local seed
   * (e.g. a single "Aldo's Standard Cheese Mix").
   */
  existingRecipeNamesByKind: Record<SpecImportDisplayKind, string[]>;
  /**
   * Confirm with the edited, kept-only import the user chose to apply.
   * `learnedRenames` are the step-1 brand/flavor renames turned into learnable
   * aliases — the parent folds them into the saved alias list so a re-upload of
   * the same sheet remembers the corrections.
   */
  onConfirm: (parsed: ParsedSpecImport, learnedRenames: SpecImportAlias[]) => void;
};

// One editable profile row in the review. `orig` keeps every field the parser
// found (applicators, pepperonis, die, sauce oz); only brand/flavor + include are
// editable here. `tombstoned` = the user had merged/deleted this away, so it's
// excluded by default and shown as re-includable.
type ProfileItem = {
  key: string;
  /**
   * The profile with cross-fill-derived values (die/sauce) applied under the
   * CURRENT confirmed grouping. Recomputed from `baseOrig` on every step-2 entry.
   */
  orig: ParsedProfile;
  /**
   * The pristine parsed profile. Cross-fill (die/sauce inheritance) is always
   * recomputed from this so a Back → rename/uncheck → Next re-derives cleanly
   * instead of keeping values inherited under a stale grouping.
   */
  baseOrig: ParsedProfile;
  brand: string;
  flavor: string;
  /** Die type to save; starts from the parsed value, editable to an existing one. */
  dieType: string;
  /** User explicitly set the die — keep it across re-target instead of recomputing. */
  dieTouched: boolean;
  include: boolean;
  tombstoned: boolean;
};

// One editable recipe row. `orig` keeps rows/targets/doughballOz/app; name + kind
// + include are editable (fixes "no name" and "cheese read as sauce").
// `brand`/`flavor` let the user attach a recipe that the AI left tied to no
// product (fixes the silent "recipe imported but shows up on nothing" miss).
type RecipeItem = {
  key: string;
  /**
   * The recipe with its brand/flavor/targets re-pointed to the CURRENT confirmed
   * product names (updated when advancing to step 2). Drives the review + apply.
   */
  orig: ParsedRecipe;
  /**
   * The pristine parsed recipe, kept so the step-1 → step-2 re-target always maps
   * from the original names (re-deriving on every "Next" stays correct even after
   * a Back-and-edit round trip).
   */
  baseOrig: ParsedRecipe;
  /** User manually set the attach brand/flavor — don't overwrite it on re-target. */
  brandTouched: boolean;
  flavorTouched: boolean;
  name: string;
  /**
   * Category shown/edited in the review. "mix" is a display-level split of the
   * cheese parse kind: it commits as `kind: "cheese"` with
   * `forcedCategory: "mix"` so the name registers under the Mixes category.
   */
  kind: SpecImportDisplayKind;
  brand: string;
  flavor: string;
  /**
   * When set, the user chose to reuse this EXISTING saved recipe (by exact name)
   * instead of creating/overwriting one from the sheet. Empty = create new.
   */
  linkExisting?: string;
  include: boolean;
  tombstoned: boolean;
};

const KINDS: SpecImportDisplayKind[] = ["dough", "sauce", "cheese", "mix"];

/** The underlying parse kind for a display kind ("mix" is stored as cheese). */
const parseKindOf = (k: SpecImportDisplayKind): ParsedRecipe["kind"] =>
  k === "mix" ? "cheese" : k;

function buildProfileItems(prepared: SpecImportPrepared): ProfileItem[] {
  const kept = prepared.parsed.profiles.map((p, i) => ({
    key: `pk${i}`,
    orig: p,
    baseOrig: p,
    brand: p.brand ?? "",
    flavor: p.flavor ?? "",
    dieType: p.dieType ?? "",
    dieTouched: false,
    include: true,
    tombstoned: false,
  }));
  const skipped = prepared.skipped.profiles.map((p, i) => ({
    key: `ps${i}`,
    orig: p,
    baseOrig: p,
    brand: p.brand ?? "",
    flavor: p.flavor ?? "",
    dieType: p.dieType ?? "",
    dieTouched: false,
    include: false,
    tombstoned: true,
  }));
  return [...kept, ...skipped];
}

function buildRecipeItems(prepared: SpecImportPrepared): RecipeItem[] {
  const kept = prepared.parsed.recipes.map((r, i) => ({
    key: `rk${i}`,
    orig: r,
    baseOrig: r,
    brandTouched: false,
    flavorTouched: false,
    name: r.name ?? "",
    kind: specImportRecipeDisplayKind(r),
    brand: r.brand ?? "",
    flavor: r.flavor ?? "",
    include: true,
    tombstoned: false,
  }));
  const skipped = prepared.skipped.recipes.map((r, i) => ({
    key: `rs${i}`,
    orig: r,
    baseOrig: r,
    brandTouched: false,
    flavorTouched: false,
    name: r.name ?? "",
    kind: specImportRecipeDisplayKind(r),
    brand: r.brand ?? "",
    flavor: r.flavor ?? "",
    include: false,
    tombstoned: true,
  }));
  return [...kept, ...skipped];
}

// Compact one-line summary of the numbers the parser read for a profile, so the
// user can spot a misparse (wrong die/oz) at a glance and uncheck or re-upload.
function profileSummary(p: ParsedProfile): string {
  const parts: string[] = [];
  if (p.dieType) parts.push(`Die ${p.dieType}`);
  if (p.sauceOzPerPizza != null) {
    // Include the named bought/ready-made sauce (e.g. "BBQ Sauce") so the user
    // can see at a glance that the sheet's sauce name was read — otherwise a
    // successfully imported sauce name is invisible on this screen.
    parts.push(
      p.sauceName
        ? `Sauce ${p.sauceOzPerPizza} oz (${p.sauceName})`
        : `Sauce ${p.sauceOzPerPizza} oz`,
    );
  } else if (p.sauceName) {
    parts.push(`Sauce: ${p.sauceName}`);
  }
  for (const a of p.applicators ?? []) {
    if (a.type) parts.push(`${a.type} ${a.ozPerPizza} oz`);
  }
  for (const pp of p.pepperonis ?? []) {
    if (pp.type) parts.push(`${pp.type} ${pp.sticks} stk · ${pp.ozPerPizza} oz`);
  }
  return parts.join(" · ");
}

// Preview of the ingredient rows a recipe parsed to (first few + overflow count).
function recipeRowsPreview(r: ParsedRecipe): string {
  const rows = r.rows ?? [];
  const shown = rows.slice(0, 4).map((row) => `${row.ingredient} ${row.lbs} lb`);
  const extra = rows.length - shown.length;
  return shown.join(" · ") + (extra > 0 ? ` · +${extra} more` : "");
}

// Editable review/summary screen for the Excel spec-sheet importer. The manager
// can include/exclude each parsed profile & recipe, fix a recipe's name (unnamed
// recipes are flagged, not silently dropped), fix its type (dough/sauce/cheese),
// and correct a profile's brand/flavor match. Items the user previously merged or
// deleted away are shown separately (excluded by default) so a re-import never
// silently resurrects them. Only the included, corrected items are applied.
export default function SpecImportDialog({
  open,
  onClose,
  loading,
  progress,
  error,
  prepared,
  applying,
  existingRecipeNamesByKind,
  onConfirm,
}: Props) {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  // Two-step review: step 1 confirms product brand/flavor names only; step 2
  // reviews everything else (recipes, die types, the diff, notes, mappings).
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (prepared) {
      setProfiles(buildProfileItems(prepared));
      setRecipes(buildRecipeItems(prepared));
      setStep(1);
    } else {
      setProfiles([]);
      setRecipes([]);
      setStep(1);
    }
  }, [prepared]);

  const brands = prepared?.brands ?? [];
  const flavorsByBrand = prepared?.flavorsByBrand ?? {};

  const setProfile = (key: string, patch: Partial<ProfileItem>) =>
    setProfiles((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const setRecipe = (key: string, patch: Partial<RecipeItem>) =>
    setRecipes((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // A checked product can't advance until it has both a brand and a flavor —
  // step 2 (and the diff) are computed from the CONFIRMED product names.
  const includedProfileMissing = profiles.some(
    (p) => p.include && (!p.brand.trim() || !p.flavor.trim()),
  );

  // Advance to step 2: freeze the step-1 renames, re-point every recipe from its
  // pristine parse to the confirmed product names, and re-run the same-brand
  // cross-fill so die/sauce blanks inherit under the corrected grouping. No AI.
  const goToStep2 = () => {
    const renames: SpecProfileRename[] = profiles.map((p) => ({
      from: { brand: p.baseOrig.brand ?? "", flavor: p.baseOrig.flavor ?? "" },
      to: { brand: p.brand.trim(), flavor: p.flavor.trim() },
    }));
    const maps = buildSpecRenameMaps(renames);

    // Cross-fill die/sauce blanks from same-(confirmed-)brand siblings. Always
    // built from the PRISTINE parse (+ the confirmed names + any die the user set)
    // so a Back → rename/uncheck → Next re-derives cleanly instead of keeping a
    // value inherited under a stale grouping. The effective die also feeds the
    // fill so a sibling can inherit from a user-set die.
    const effectiveDie = (p: ProfileItem) =>
      (p.dieTouched ? p.dieType : p.baseOrig.dieType ?? "").trim();
    const includedEdited = profiles
      .filter((p) => p.include)
      .map((p): ParsedProfile => {
        const out: ParsedProfile = {
          ...p.baseOrig,
          brand: p.brand.trim(),
          flavor: p.flavor.trim(),
        };
        const die = effectiveDie(p);
        if (die) out.dieType = die;
        else delete out.dieType;
        return out;
      });
    const filled = crossFillSpecImport({ profiles: includedEdited, recipes: [] }).parsed.profiles;
    let fi = 0;
    const nextProfiles = profiles.map((p): ProfileItem => {
      const baseSauce = p.baseOrig.sauceOzPerPizza;
      if (!p.include) {
        // Excluded rows aren't cross-filled and aren't applied; reset derived
        // state to the pristine parse so re-including then re-advancing is clean.
        return {
          ...p,
          orig: { ...p.baseOrig },
          dieType: p.dieTouched ? p.dieType : p.baseOrig.dieType ?? "",
        };
      }
      const f = filled[fi++];
      const die = p.dieTouched ? p.dieType : effectiveDie(p) || (f.dieType ?? "");
      const sauce = baseSauce == null ? f.sauceOzPerPizza : baseSauce;
      const orig: ParsedProfile = { ...p.baseOrig };
      if (sauce != null) orig.sauceOzPerPizza = sauce;
      else delete orig.sauceOzPerPizza;
      return { ...p, dieType: die, orig };
    });

    const nextRecipes = recipes.map((r): RecipeItem => {
      const remapped = remapRecipeForRenames(r.baseOrig, maps);
      const next: RecipeItem = { ...r, orig: remapped };
      if (!r.brandTouched) next.brand = remapped.brand ?? "";
      if (!r.flavorTouched) next.flavor = remapped.flavor ?? "";
      return next;
    });

    setProfiles(nextProfiles);
    setRecipes(nextRecipes);
    setStep(2);
  };

  // Step-1 brand/flavor renames on INCLUDED products, turned into learnable
  // aliases (raw sheet label → confirmed name) so a re-upload of the same sheet
  // remembers the corrections. Passed to the parent on Apply.
  const learnedRenames: SpecImportAlias[] = useMemo(
    () =>
      collectSpecRenameAliases(
        profiles
          .filter((p) => p.include)
          .map((p): SpecProfileRename => ({
            from: { brand: p.baseOrig.brand ?? "", flavor: p.baseOrig.flavor ?? "" },
            to: { brand: p.brand.trim(), flavor: p.flavor.trim() },
          })),
        prepared?.newAliases ?? [],
      ),
    [profiles, prepared],
  );

  // The edited, include-only import that would be applied. Recomputed live so the
  // change list and counts always reflect the user's edits.
  const edited: ParsedSpecImport = useMemo(() => {
    const outProfiles = profiles
      .filter((p) => p.include)
      .map((p): ParsedProfile => {
        const out: ParsedProfile = { ...p.orig, brand: p.brand.trim(), flavor: p.flavor.trim() };
        const die = p.dieType.trim();
        if (die) out.dieType = die;
        else delete out.dieType;
        return out;
      });
    const outRecipes = recipes
      .filter((r) => r.include)
      .map((r): ParsedRecipe => {
        const linked = r.linkExisting?.trim();
        const out: ParsedRecipe = linked
          ? { ...r.orig, name: linked, kind: parseKindOf(r.kind), referenceOnly: true }
          : { ...r.orig, name: r.name.trim(), kind: parseKindOf(r.kind) };
        if (!linked) delete out.referenceOnly;
        // Cheese-vs-mix is a display split of the same parse kind — record the
        // user's pick so applySpecImport routes by it instead of the heuristic.
        if (r.kind === "mix") out.forcedCategory = "mix";
        else if (r.kind === "cheese") out.forcedCategory = "cheese";
        else delete out.forcedCategory;
        const b = r.brand.trim();
        const f = r.flavor.trim();
        if (b) out.brand = b;
        else delete out.brand;
        if (f) out.flavor = f;
        else delete out.flavor;
        return out;
      });
    const out: ParsedSpecImport = { profiles: outProfiles, recipes: outRecipes };
    if (prepared?.parsed.note) out.note = prepared.parsed.note;
    return out;
  }, [profiles, recipes, prepared]);

  const discrepancies = useMemo(
    () => (prepared ? buildDiscrepancies(edited) : []),
    [edited, prepared],
  );

  // Flavor-grounding corrections/flags from the server-side sanitizer, keyed by
  // the (canonicalized) brand+flavor of the profile each concerns so they can be
  // attached to that profile's row. Warnings whose profile row can't be found
  // (edge case) are surfaced in the top-level callout instead — never hidden.
  const specWarnings = prepared?.parsed.warnings ?? [];
  const warningsByProfile = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const w of prepared?.parsed.warnings ?? []) {
      const k = warnKey(w.brand, w.flavor);
      map.set(k, [...(map.get(k) ?? []), w.message]);
    }
    return map;
  }, [prepared]);

  if (!open) return null;

  const profileKeys = new Set(profiles.map((p) => warnKey(p.orig.brand, p.orig.flavor)));
  const unmatchedWarnings = specWarnings.filter(
    (w) => !profileKeys.has(warnKey(w.brand, w.flavor)),
  );

  const includedProfiles = profiles.filter((p) => p.include).length;
  const includedRecipes = recipes.filter((r) => r.include).length;
  const includedCount = includedProfiles + includedRecipes;
  const nothingParsed = prepared != null && profiles.length === 0 && recipes.length === 0;

  // Live "would be dropped" attention count across included items.
  const attentionCount =
    edited.profiles.filter((p) => profileApplyIssue(p)).length +
    // Reference-only recipes reuse an existing recipe as-is, so name/rows issues
    // don't apply — their rows come from the saved library, not the sheet.
    edited.recipes.filter((r) => !r.referenceOnly && recipeApplyIssue(r)).length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Import Spec Sheet</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {progress && progress.total > 1
                  ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and interpreting spec sheets & recipes…`
                  : "Reading the workbook and interpreting spec sheets & recipes…"}
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">Could not import</span>
              </div>
              <p className="mt-1 text-sm text-destructive/90">{error}</p>
            </div>
          )}

          {!loading && !error && prepared && (
            <>
              {step === 1 ? (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Step 1 of 2 — products.</span>{" "}
                  First, confirm each product's{" "}
                  <span className="font-medium text-foreground">brand and flavor</span>, and
                  uncheck any you don't want. You'll review the recipes and details next.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Step 2 of 2 — details.</span>{" "}
                  Now review the recipes, die types, and what will change. Only checked items
                  are applied — existing ones are overwritten, new ones are added.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-2xl font-bold text-foreground">{includedProfiles}</div>
                  <div className="text-xs font-medium text-muted-foreground">
                    of {profiles.length} spec profiles
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-2xl font-bold text-foreground">{includedRecipes}</div>
                  <div className="text-xs font-medium text-muted-foreground">
                    of {recipes.length} recipes
                  </div>
                </div>
              </div>

              {step === 1 && includedProfileMissing && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-2 text-xs text-amber-700">
                  A checked product is missing its brand or flavor. Fill both in (or uncheck
                  it) to continue.
                </div>
              )}

              {step === 2 && attentionCount > 0 && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-2 text-xs text-amber-700">
                  {attentionCount} checked item{attentionCount === 1 ? "" : "s"} still{" "}
                  need attention — a recipe needs a name, or a profile is missing its
                  brand/flavor. These won't be saved until fixed or unchecked.
                </div>
              )}

              {step === 1 && specWarnings.length > 0 && (
                <div
                  className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3"
                  data-testid="spec-import-warnings"
                >
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {specWarnings.length} item{specWarnings.length === 1 ? " was" : "s were"}{" "}
                      corrected or flagged
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-amber-700">
                    The AI's reading didn't match the sheet exactly, so the items below were
                    corrected or flagged for review (including any amounts it couldn't read).
                    Double-check the highlighted products before applying.
                  </p>
                  {unmatchedWarnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {unmatchedWarnings.map((w, i) => (
                        <li key={i} className="text-xs text-amber-700">
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Shared brand suggestions for the profile match pickers. */}
              <datalist id="spec-import-brands">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>

              {step === 1 && profiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Spec profiles
                  </p>
                  <ul className="space-y-2">
                    {profiles.map((p) => (
                      <ProfileRow
                        key={p.key}
                        item={p}
                        mode="names"
                        brands={brands}
                        flavorsByBrand={flavorsByBrand}
                        warnings={warningsByProfile.get(warnKey(p.orig.brand, p.orig.flavor)) ?? []}
                        onToggle={() => setProfile(p.key, { include: !p.include })}
                        onBrand={(brand) => setProfile(p.key, { brand })}
                        onFlavor={(flavor) => setProfile(p.key, { flavor })}
                        onDieType={(dieType) => setProfile(p.key, { dieType, dieTouched: true })}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {step === 2 && includedProfiles > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Die types
                  </p>
                  <ul className="space-y-2">
                    {profiles
                      .filter((p) => p.include)
                      .map((p) => (
                        <ProfileRow
                          key={p.key}
                          item={p}
                          mode="die"
                          brands={brands}
                          flavorsByBrand={flavorsByBrand}
                          warnings={[]}
                          onToggle={() => setProfile(p.key, { include: !p.include })}
                          onBrand={(brand) => setProfile(p.key, { brand })}
                          onFlavor={(flavor) => setProfile(p.key, { flavor })}
                          onDieType={(dieType) => setProfile(p.key, { dieType, dieTouched: true })}
                        />
                      ))}
                  </ul>
                </div>
              )}

              {step === 2 && recipes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recipes
                  </p>
                  <ul className="space-y-2">
                    {recipes.map((r) => (
                      <RecipeRow
                        key={r.key}
                        item={r}
                        editedProfiles={edited.profiles}
                        brands={brands}
                        flavorsByBrand={flavorsByBrand}
                        existingOptions={existingRecipeNamesByKind[r.kind] ?? []}
                        onToggle={() => setRecipe(r.key, { include: !r.include })}
                        onName={(name) => setRecipe(r.key, { name })}
                        onKind={(kind) => setRecipe(r.key, { kind, linkExisting: undefined })}
                        onBrand={(brand) => setRecipe(r.key, { brand, brandTouched: true })}
                        onFlavor={(flavor) => setRecipe(r.key, { flavor, flavorTouched: true })}
                        onLinkExisting={(linkExisting) =>
                          setRecipe(r.key, { linkExisting: linkExisting || undefined })
                        }
                      />
                    ))}
                  </ul>
                </div>
              )}

              {step === 2 && prepared.newAliases.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {prepared.newAliases.length} new name mapping
                  {prepared.newAliases.length === 1 ? "" : "s"} will be remembered for
                  future imports.
                </p>
              )}

              {step === 2 && prepared.flagged.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    A second AI check flagged {prepared.flagged.length} item
                    {prepared.flagged.length === 1 ? "" : "s"} to double-check before applying:
                  </p>
                  {prepared.flagged.map((f, i) => (
                    <div key={i} className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">{f.label}</p>
                      <ReviewBadge review={f.review} />
                    </div>
                  ))}
                </div>
              )}

              {step === 2 && discrepancies.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Applying these will change {discrepancies.length} thing
                    {discrepancies.length === 1 ? "" : "s"} in your current recipes:
                  </p>
                  <ul className="space-y-0.5">
                    {discrepancies.slice(0, 12).map((d, i) => (
                      <li key={i} className="text-xs text-foreground">
                        {d.message}
                      </li>
                    ))}
                  </ul>
                  {discrepancies.length > 12 && (
                    <p className="text-xs text-muted-foreground">
                      +{discrepancies.length - 12} more
                    </p>
                  )}
                </div>
              )}

              {step === 2 && prepared.note && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Note from the parser</span>
                  </div>
                  <p className="mt-1 text-sm text-amber-700">{prepared.note}</p>
                </div>
              )}

              {nothingParsed && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Nothing recognizable was found in this workbook. Try a different file.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={applying}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              Back
            </button>
          )}
          {step === 1 ? (
            <button
              type="button"
              onClick={goToStep2}
              disabled={
                loading ||
                applying ||
                !!error ||
                !prepared ||
                nothingParsed ||
                includedProfileMissing
              }
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onConfirm(edited, learnedRenames)}
              disabled={
                loading ||
                applying ||
                !!error ||
                !prepared ||
                nothingParsed ||
                includedCount === 0 ||
                attentionCount > 0
              }
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Apply {includedCount > 0 ? includedCount : ""} item
              {includedCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ tombstoned, isNew }: { tombstoned: boolean; isNew: boolean }) {
  if (tombstoned) {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
        Merged away
      </span>
    );
  }
  return (
    <span
      className={
        isNew
          ? "shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-600"
          : "shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary"
      }
    >
      {isNew ? "new" : "update"}
    </span>
  );
}

/** Case-insensitive brand+flavor key used to attach grounding warnings to rows. */
function warnKey(brand: string, flavor: string): string {
  return `${brand.trim().toLowerCase()}|${flavor.trim().toLowerCase()}`;
}

function ProfileRow({
  item,
  mode,
  flavorsByBrand,
  warnings,
  onToggle,
  onBrand,
  onFlavor,
  onDieType,
}: {
  item: ProfileItem;
  /** "names" = step 1 (include + brand/flavor + grounding); "die" = step 2 die-only. */
  mode: "names" | "die";
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  warnings: string[];
  onToggle: () => void;
  onBrand: (v: string) => void;
  onFlavor: (v: string) => void;
  onDieType: (v: string) => void;
}) {
  const brand = item.brand.trim();
  const flavor = item.flavor.trim();
  const issue = profileApplyIssue({ ...item.orig, brand, flavor });
  const isNew = !brand || !flavor || !profileExistsForImport(brand, flavor);
  const flavorMatch = Object.keys(flavorsByBrand).find(
    (b) => b.trim().toLowerCase() === brand.toLowerCase(),
  );
  const flavorOpts = flavorMatch ? flavorsByBrand[flavorMatch] ?? [] : [];
  const flavorListId = `spec-flavors-${item.key}`;
  const summary = profileSummary({
    ...item.orig,
    dieType: item.dieType.trim() || item.orig.dieType,
  });
  // Die-type reuse: offer the user's existing dies so a profile can point at one
  // instead of creating a new die option. The parsed value stays selectable even
  // if it isn't a saved die yet.
  const dieOpts = existingDieTypesForImport();
  const dieValue = item.dieType.trim();
  const dieIsNew =
    !!dieValue && !dieOpts.some((d) => d.trim().toLowerCase() === dieValue.toLowerCase());
  const dieSelectOptions = [
    ...dieOpts,
    ...(dieIsNew ? [dieValue] : []),
  ];

  // Step 2 "die" mode: names are already locked in from step 1, shown read-only;
  // only the die selector (and the read summary) stay editable/visible.
  if (mode === "die") {
    return (
      <li className="rounded-lg border border-border p-3" data-testid={`spec-profile-${item.key}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {brand || "(no brand)"} — {flavor || "(no flavor)"}
          </span>
          <StatusBadge tombstoned={item.tombstoned} isNew={isNew} />
        </div>
        {dieSelectOptions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Die:</span>
            <select
              value={item.dieType}
              onChange={(e) => onDieType(e.target.value)}
              aria-label={`Die type for ${brand} ${flavor}`}
              data-testid={`spec-profile-die-${item.key}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="">No die</option>
              {dieSelectOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                  {dieIsNew && d === dieValue ? " (new)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {summary && (
          <div className="mt-1.5 text-xs text-muted-foreground">Read: {summary}</div>
        )}
      </li>
    );
  }

  // Step 1 "names" mode: include + brand/flavor + grounding warnings only.
  return (
    <li
      className={`rounded-lg border p-3 ${item.include ? "border-border" : "border-border/60 opacity-70"}`}
      data-testid={`spec-profile-${item.key}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.include}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-primary"
          aria-label={`Include ${item.orig.brand} ${item.orig.flavor}`}
          data-testid={`spec-profile-include-${item.key}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {item.orig.brand || "(no brand)"} — {item.orig.flavor || "(no flavor)"}
            </span>
            <StatusBadge tombstoned={item.tombstoned} isNew={isNew} />
          </div>

          <datalist id={flavorListId}>
            {flavorOpts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={item.brand}
              onChange={(e) => onBrand(e.target.value)}
              list="spec-import-brands"
              placeholder="Brand"
              aria-label={`Brand for ${item.orig.brand} ${item.orig.flavor}`}
              data-testid={`spec-profile-brand-${item.key}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
            <input
              value={item.flavor}
              onChange={(e) => onFlavor(e.target.value)}
              list={flavorListId}
              placeholder="Flavor"
              aria-label={`Flavor for ${item.orig.brand} ${item.orig.flavor}`}
              data-testid={`spec-profile-flavor-${item.key}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </div>

          {summary && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Read: {summary}
            </div>
          )}

          {warnings.length > 0 && (
            <div
              className="mt-2 rounded-md border border-amber-400/60 bg-amber-500/10 p-2"
              data-testid={`spec-profile-warning-${item.key}`}
            >
              <div className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="text-xs font-semibold">Check this name</span>
              </div>
              {warnings.map((m, i) => (
                <p key={i} className="mt-0.5 text-xs text-amber-700">
                  {m}
                </p>
              ))}
            </div>
          )}

          {item.include && issue && (
            <div className="mt-1 text-xs text-amber-600">
              {issue === "missing-brand"
                ? "Needs a brand — add one or it won't be saved."
                : "Needs a flavor — add one or it won't be saved."}
            </div>
          )}
          {item.tombstoned && (
            <div className="mt-1 text-xs text-amber-600">
              You merged/removed this before — check the box only if you want it back.
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function formatTargets(targets: ParsedRecipeTarget[]): string {
  const shown = targets.slice(0, 3).map((t) => `${t.brand} — ${t.flavor}`);
  const extra = targets.length - shown.length;
  return shown.join(", ") + (extra > 0 ? `, +${extra} more` : "");
}

function RecipeRow({
  item,
  editedProfiles,
  brands,
  flavorsByBrand,
  existingOptions,
  onToggle,
  onName,
  onKind,
  onBrand,
  onFlavor,
  onLinkExisting,
}: {
  item: RecipeItem;
  editedProfiles: ParsedProfile[];
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  /** Existing saved recipes of this kind the user can reuse instead of creating one. */
  existingOptions: string[];
  onToggle: () => void;
  onName: (v: string) => void;
  onKind: (v: SpecImportDisplayKind) => void;
  onBrand: (v: string) => void;
  onFlavor: (v: string) => void;
  onLinkExisting: (v: string) => void;
}) {
  const linked = item.linkExisting?.trim() ?? "";
  // Effective name: the linked recipe when reusing, else the (editable) parsed name.
  const name = linked || item.name.trim();
  const brand = item.brand.trim();
  const flavor = item.flavor.trim();
  const candidate: ParsedRecipe = {
    ...item.orig,
    name,
    kind: parseKindOf(item.kind),
    ...(linked ? { referenceOnly: true } : {}),
    ...(brand ? { brand } : {}),
    ...(flavor ? { flavor } : {}),
  };
  const issue = linked ? undefined : recipeApplyIssue(candidate);
  // Mixes live in the same preset library as cheese recipes (only the NAME
  // list differs), so existence checks use the underlying parse kind.
  const isNew = !linked && (!name || !recipeExistsForImport(parseKindOf(item.kind), name));
  const rowsPreview = recipeRowsPreview(item.orig);
  // Which products this recipe will actually attach to when applied. If empty,
  // the recipe name lands in the library but shows up on NO run — the silent
  // "it didn't import" miss the user reported.
  const targets = recipeApplyTargets(candidate, editedProfiles);
  const attachesToNothing = item.include && !linked && !issue && targets.length === 0;
  // Brand chosen but no flavor yet → the recipe currently attaches to EVERY flavor
  // of that brand. Keep the brand+flavor editor on screen in this state so the
  // flavor field doesn't vanish the instant a brand is typed (which silently left
  // the recipe attached to all flavors). The user can then narrow to one flavor or
  // deliberately leave it applying to all.
  const attachesToAllFlavors =
    item.include && !linked && !issue && brand !== "" && flavor === "" && targets.length > 0;
  const showAttachEditor = attachesToNothing || attachesToAllFlavors;
  const flavorMatch = Object.keys(flavorsByBrand).find(
    (b) => b.trim().toLowerCase() === brand.toLowerCase(),
  );
  const flavorOpts = flavorMatch ? flavorsByBrand[flavorMatch] ?? [] : [];
  const flavorListId = `spec-recipe-flavors-${item.key}`;

  return (
    <li
      className={`rounded-lg border p-3 ${item.include ? "border-border" : "border-border/60 opacity-70"}`}
      data-testid={`spec-recipe-${item.key}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.include}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-primary"
          aria-label={`Include recipe ${item.orig.name || "(unnamed)"}`}
          data-testid={`spec-recipe-include-${item.key}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {item.orig.name || "(unnamed recipe)"}
            </span>
            <StatusBadge tombstoned={item.tombstoned} isNew={isNew} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!linked && (
              <input
                value={item.name}
                onChange={(e) => onName(e.target.value)}
                placeholder="Recipe name"
                aria-label={`Name for recipe ${item.orig.name || "(unnamed)"}`}
                data-testid={`spec-recipe-name-${item.key}`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              />
            )}
            <select
              value={item.kind}
              onChange={(e) => onKind(e.target.value as SpecImportDisplayKind)}
              aria-label={`Type for recipe ${item.orig.name || "(unnamed)"}`}
              data-testid={`spec-recipe-kind-${item.key}`}
              className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground capitalize"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          {existingOptions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Use existing:</span>
              <select
                value={linked}
                onChange={(e) => onLinkExisting(e.target.value)}
                aria-label={`Reuse an existing recipe for ${item.orig.name || "(unnamed)"}`}
                data-testid={`spec-recipe-link-${item.key}`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="">Create new recipe</option>
                {existingOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}

          {linked && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Using your existing “{linked}” — it won't be changed.
            </div>
          )}

          {!linked && rowsPreview && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Read: {rowsPreview}
            </div>
          )}

          {item.include && !issue && targets.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              Attaches to: {formatTargets(targets)}
            </div>
          )}

          {item.include && issue === "missing-name" && (
            <div className="mt-1 text-xs text-amber-600">
              Needs a name — this recipe won't be saved until you name it.
            </div>
          )}
          {item.include && issue === "no-rows" && (
            <div className="mt-1 text-xs text-amber-600">
              No ingredients were read — it won't be saved.
            </div>
          )}

          {showAttachEditor && (
            <div
              className={`mt-2 rounded-md border p-2 ${
                attachesToNothing
                  ? "border-amber-400/60 bg-amber-500/10"
                  : "border-border bg-muted/40"
              }`}
            >
              {attachesToNothing ? (
                <div className="text-xs font-medium text-amber-700">
                  Won't show on any product yet — set the brand & flavor it belongs to.
                </div>
              ) : (
                <div className="text-xs font-medium text-foreground">
                  Attaching to every flavor of “{brand}” — add a flavor below to attach
                  it to just one.
                </div>
              )}
              <datalist id={flavorListId}>
                {flavorOpts.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  value={item.brand}
                  onChange={(e) => onBrand(e.target.value)}
                  list="spec-import-brands"
                  placeholder="Brand"
                  aria-label={`Attach recipe ${item.orig.name || "(unnamed)"} to brand`}
                  data-testid={`spec-recipe-brand-${item.key}`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
                <input
                  value={item.flavor}
                  onChange={(e) => onFlavor(e.target.value)}
                  list={flavorListId}
                  placeholder="Flavor"
                  aria-label={`Attach recipe ${item.orig.name || "(unnamed)"} to flavor`}
                  data-testid={`spec-recipe-flavor-${item.key}`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
              </div>
              <p
                className={`mt-1 text-[11px] ${
                  attachesToNothing ? "text-amber-700/80" : "text-muted-foreground"
                }`}
              >
                Enter both, or set just a brand to attach to every matching product in
                this import. The recipe is still saved to your library either way.
              </p>
            </div>
          )}

          {item.tombstoned && (
            <div className="mt-1 text-xs text-amber-600">
              You merged/removed this before — check the box only if you want it back.
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
