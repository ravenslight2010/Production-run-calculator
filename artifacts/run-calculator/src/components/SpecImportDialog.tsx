import { useEffect, useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  recipeApplyIssue,
  countUsableRecipeRows,
  profileApplyIssue,
  buildSpecRenameMaps,
  remapRecipeForRenames,
  crossFillSpecImport,
  collectSpecRenameAliases,
  mergeSpecAliases,
  cleanSpecCheeseRecipeName,
  isGenericSlotTypeName,
  blendLinkSuggestionKey,
  recipeLinkSuggestionKey,
  crossFamilyRoutingSuggestionKey,
  repointProfileNamedRecipes,
  specImportNameMatchKey,
  type NamedRecipeRename,
  type ParsedProfile,
  type ParsedRecipe,
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
   * `profilesToRemove` are the brand+flavor profiles the manager checked in the
   * "No longer in this workbook" section and confirmed for tombstoning.
   * `acceptedNewMixIngredientNames` are compound `"${brand}\0${name}"` keys
   * (both lower-cased) for the mixes whose newly detected ingredient rows the
   * manager approved for appending. Using a compound key prevents same-name
   * mixes under different brands from being conflated.
   */
  onConfirm: (
    parsed: ParsedSpecImport,
    learnedRenames: SpecImportAlias[],
    profilesToRemove: Array<{brand: string; flavor: string}>,
    forceUpdateProfileKeys: ReadonlySet<string>,
    acceptedNewMixIngredientNames: ReadonlySet<string>,
  ) => void;
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
  /**
   * When true, bypass blank-fill guards in applySpecImport for this profile:
   * the sheet's dough name, sauce name, and doughball weight OVERWRITE whatever
   * is currently stored. Used to fix a previously bad import without having to
   * manually edit the recipe manager.
   */
  forceUpdate: boolean;
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
  /**
   * Merge-re-import row: this sheet's name was previously MERGED onto an
   * existing recipe (learned-alias link suggestion) whose OWN sheet is also
   * present in this workbook. Starts UNCHECKED with an explanatory note so the
   * manager isn't confused by two rows pointing at the same saved recipe —
   * same treatment as the premix/cheese importers' merged-away rows.
   */
  mergedAway?: boolean;
};

const KINDS: SpecImportDisplayKind[] = ["dough", "sauce", "cheese", "mix"];

/** The underlying parse kind for a display kind ("mix" is stored as cheese). */
const parseKindOf = (k: SpecImportDisplayKind): ParsedRecipe["kind"] =>
  k === "mix" ? "cheese" : k;

/** A profile from the previous snapshot that is absent from the new parse. */
type RemovedProfileItem = {
  key: string;
  brand: string;
  flavor: string;
  /** Whether the manager checked this for removal. Unchecked by default. */
  remove: boolean;
};

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
    forceUpdate: false,
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
    forceUpdate: false,
  }));
  return [...kept, ...skipped];
}

/**
 * Advisory warnings for spec-import profiles based on pool availability.
 * Flags a dough/sauce name that the current pool doesn't contain yet — it will
 * create a placeholder on commit but the data (recipe rows, weight) won't fill
 * until the manager adds it. Pure function, no side effects.
 */
function computeSpecImportPoolWarnings(
  profiles: ProfileItem[],
  doughPoolNames: string[],
  saucePoolNames: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const doughSet = new Set(doughPoolNames.map((n) => n.trim().toLowerCase()));
  const sauceSet = new Set(saucePoolNames.map((n) => n.trim().toLowerCase()));
  // Mirror the purchased-crust detection from applySpecImport so a "Bonici
  // Parbake Crust" profile isn't incorrectly flagged for a missing dough recipe.
  const PURCHASED_CRUST_RE = /\bcrusts?\b/i;
  const INHOUSE_CRUST_RE = /\b(?:doughs?|recipes?|dies?)\b/i;
  for (const p of profiles) {
    if (!p.include) continue;
    const key = warnKey(p.orig.brand, p.orig.flavor);
    const warns: string[] = [];
    const doughName = (p.orig.doughName ?? "").trim();
    const sauceName = (p.orig.sauceName ?? "").trim();
    const isPurchasedCrust =
      doughName
        ? PURCHASED_CRUST_RE.test(doughName) && !INHOUSE_CRUST_RE.test(doughName)
        : false;
    if (doughName && !isPurchasedCrust && !doughSet.has(doughName.toLowerCase())) {
      warns.push(`Dough "${doughName}" not in pool — will import as a placeholder`);
    }
    if (sauceName && !sauceSet.has(sauceName.toLowerCase())) {
      warns.push(`Sauce "${sauceName}" not in pool — will import as a placeholder`);
    }
    if (warns.length > 0) map.set(key, warns);
  }
  return map;
}

function buildRecipeItems(
  prepared: SpecImportPrepared,
  existingByKind?: Record<string, string[]>,
): RecipeItem[] {
  // A previously learned "use existing" pick pre-selects the link so a
  // re-import of a known sheet recommends reuse instead of "create new".
  // Only offered when the remembered recipe still exists in that kind's saved
  // pool (otherwise the picker would show an invalid selection).
  const suggestions = prepared.aliasLinkSuggestions ?? {};
  const suggestLink = (name: string, kind: string, brand: string): string | undefined => {
    // Cheese/mix picks: the BRAND-scoped key wins (each brand keeps its own
    // remembered pick for a generic blend name — see blendLinkSuggestionKey),
    // falling back to the legacy plain lowercased-name key (factory-wide).
    // Dough/sauce picks are kind-scoped via recipeLinkSuggestionKey.
    const suggested =
      kind === "cheese" || kind === "mix"
        ? suggestions[blendLinkSuggestionKey(brand, name)] ??
          suggestions[name.trim().toLowerCase()]
        : suggestions[recipeLinkSuggestionKey(kind, name)];
    if (!suggested) return undefined;
    if (suggested.trim().toLowerCase() === name.trim().toLowerCase()) return undefined;
    return (existingByKind?.[kind] ?? []).find(
      (n) => n.trim().toLowerCase() === suggested.trim().toLowerCase(),
    );
  };
  // Cross-family routing hint: a recipe the AI routed to one display kind
  // (cheese/mix) that the user previously reclassified to the other family.
  // Encoded as "targetKind:linkedRecipeName" in the suggestion map.
  const suggestCrossFamily = (
    name: string,
    parsedKind: SpecImportDisplayKind,
  ): { kind: SpecImportDisplayKind; linkExisting: string } | undefined => {
    const value = suggestions[crossFamilyRoutingSuggestionKey(name)];
    if (!value) return undefined;
    const colonIdx = value.indexOf(":");
    if (colonIdx < 0) return undefined;
    const targetKind = value.slice(0, colonIdx) as SpecImportDisplayKind;
    const linkName = value.slice(colonIdx + 1).trim();
    // Only apply when the hint actually crosses a family boundary.
    if (targetKind === parsedKind) return undefined;
    if (targetKind !== "cheese" && targetKind !== "mix") return undefined;
    if (!linkName) return undefined;
    // Verify the linked recipe still exists in the target kind's pool.
    const exists = (existingByKind?.[targetKind] ?? []).find(
      (n) => n.trim().toLowerCase() === linkName.toLowerCase(),
    );
    return exists ? { kind: targetKind, linkExisting: exists } : undefined;
  };
  const kept = prepared.parsed.recipes.map((r, i): RecipeItem => {
    const kind = specImportRecipeDisplayKind(r);
    const linkExisting = suggestLink(r.name ?? "", kind, r.brand ?? "");
    // Cross-family hint is only applied when no same-family link was remembered.
    const crossFamily = !linkExisting ? suggestCrossFamily(r.name ?? "", kind) : undefined;
    return {
      key: `rk${i}`,
      orig: r,
      baseOrig: r,
      brandTouched: false,
      flavorTouched: false,
      name: r.name ?? "",
      kind: crossFamily?.kind ?? kind,
      brand: r.brand ?? "",
      flavor: r.flavor ?? "",
      ...(linkExisting ? { linkExisting } : {}),
      ...(crossFamily ? { linkExisting: crossFamily.linkExisting } : {}),
      include: true,
      tombstoned: false,
    };
  });
  // Merge-re-import detection (dough/sauce): a row pre-linked (learned merge
  // alias) onto an existing recipe whose OWN sheet is ALSO in this workbook.
  // Both rows would point at the same saved recipe, so the merged-away one
  // starts UNCHECKED with an explanatory note — the same treatment the premix
  // and cheese importers give merged-away sheets, so managers see one
  // consistent behavior across all importers. Apply is never blocked.
  for (const it of kept) {
    if (it.kind !== "dough" && it.kind !== "sauce") continue;
    const linked = it.linkExisting?.trim().toLowerCase();
    if (!linked) continue;
    const survivorAlsoHere = kept.some(
      (o) =>
        o !== it &&
        o.kind === it.kind &&
        (o.name ?? "").trim().toLowerCase() === linked,
    );
    if (survivorAlsoHere) {
      it.mergedAway = true;
      it.include = false;
    }
  }
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

// A row with a real ingredient name is the minimum useful recipe data. This
// deliberately mirrors the mix collector, which skips blank ingredient rows
// before building components. A blank parsed row must never make a linked mix
// look like it will overwrite the manager's saved components.
function hasUsableIngredientRows(r: ParsedRecipe): boolean {
  return (r.rows ?? []).some((row) => (row.ingredient ?? "").trim().length > 0);
}

// Preview of the ingredient rows a recipe parsed to (first few + overflow count).
// Mix rows use the parser's `lbs` slot for per-pizza ounces, so callers can
// supply the correct label rather than exposing that implementation quirk.
function recipeRowsPreview(r: ParsedRecipe, amountLabel = "lb"): string {
  const usableRows = (r.rows ?? []).filter((row) => (row.ingredient ?? "").trim());
  const shown = usableRows
    .slice(0, 4)
    .map((row) => `${row.ingredient} ${row.lbs} ${amountLabel}`);
  const extra = usableRows.length - shown.length;
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
  const [removedProfiles, setRemovedProfiles] = useState<RemovedProfileItem[]>([]);
  // Two-step review: step 1 confirms product brand/flavor names only; step 2
  // reviews everything else (recipes, die types, the diff, notes, mappings).
  const [step, setStep] = useState<1 | 2>(1);
  /**
   * Lower-cased mix names whose new ingredient additions the manager has
   * accepted (checked). Unchecked = skip silently at commit time.
   * Default: all new additions start UNCHECKED so no silent changes happen
   * on a routine re-import — the manager must explicitly opt in per mix.
   */
  const [acceptedNewMixNames, setAcceptedNewMixNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (prepared) {
      setProfiles(buildProfileItems(prepared));
      // existingRecipeNamesByKind is intentionally NOT a dependency: this
      // effect must only reset the review when a NEW prepared payload arrives,
      // never because the parent re-rendered with a fresh options object (that
      // would wipe the user's in-progress edits).
      setRecipes(buildRecipeItems(prepared, existingRecipeNamesByKind));
      setRemovedProfiles(
        (prepared.profilesRemovedFromWorkbook ?? []).map((p, i) => ({
          key: `rp${i}`,
          brand: p.brand,
          flavor: p.flavor,
          remove: false,
        })),
      );
      setAcceptedNewMixNames(new Set());
      setStep(1);
    } else {
      setProfiles([]);
      setRecipes([]);
      setRemovedProfiles([]);
      setAcceptedNewMixNames(new Set());
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
    // Renames come from INCLUDED rows only: an excluded row's (unedited) name
    // would register an identity rename for the same original brand, making the
    // brand-level map ambiguous and silently dropping a real rename — a
    // brand-only recipe anchor would then keep the old brand and attach to
    // nothing in step 2.
    const renames: SpecProfileRename[] = profiles
      .filter((p) => p.include)
      .map((p) => ({
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

    // Step-1 brand propagation: for cheese/mix recipes that are still unscoped
    // (AI didn't attach a brand target), fill brand from the confirmed profile
    // whose applicator slot names this recipe. This is the client-side mirror of
    // fillSpecCheeseTargetsFromProfiles — it runs at the step-1→2 boundary so
    // the brand is already set when the user reviews recipes in step 2 and is
    // carried through to the commit path.
    const applicatorKeyToBrand = new Map<string, string>();
    for (const p of profiles) {
      if (!p.include) continue;
      const confirmedBrand = p.brand.trim();
      if (!confirmedBrand) continue;
      for (const a of p.baseOrig.applicators ?? []) {
        const k = specImportNameMatchKey(cleanSpecCheeseRecipeName(a.type ?? ""));
        if (k && !applicatorKeyToBrand.has(k)) {
          applicatorKeyToBrand.set(k, confirmedBrand);
        }
      }
    }
    const finalRecipes =
      applicatorKeyToBrand.size === 0
        ? nextRecipes
        : nextRecipes.map((r): RecipeItem => {
            if (r.brandTouched) return r;
            if (r.kind !== "cheese" && r.kind !== "mix") return r;
            if (r.brand.trim()) return r; // already has a brand from AI or remap
            const k = specImportNameMatchKey(cleanSpecCheeseRecipeName(r.orig.name ?? ""));
            const backfill = k ? applicatorKeyToBrand.get(k) : undefined;
            return backfill ? { ...r, brand: backfill } : r;
          });

    setProfiles(nextProfiles);
    setRecipes(finalRecipes);
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

  // "Use existing recipe" picks on INCLUDED recipes, turned into learnable
  // aliases (parsed sheet name → chosen existing recipe name). Cheese/mix picks
  // go under the "appType" kind (the blend-name namespace the prepare pass reads
  // back as link suggestions); dough/sauce picks go under "recipeName" scoped by
  // kind via context. Saved alongside the step-1 renames on Apply so a re-import
  // of the same sheet recommends the link instead of "create new".
  const learnedLinks: SpecImportAlias[] = useMemo(() => {
    const out: SpecImportAlias[] = [];
    for (const r of recipes) {
      if (!r.include) continue;
      const linked = r.linkExisting?.trim();
      const external = (r.baseOrig.name ?? "").trim();
      if (!linked || !external) continue;
      if (external.toLowerCase() === linked.toLowerCase()) continue;
      if (r.kind === "cheese" || r.kind === "mix") {
        // Never learn a generic slot-type name ("Mix"/"cheese") on either
        // side: such an alias renames every blend to one garbage record on
        // the next import (and the poison then re-learns itself on Apply).
        if (isGenericSlotTypeName(external) || isGenericSlotTypeName(linked)) continue;
        // Cross-family routing hint: when the user reclassified this recipe
        // from its AI-parsed display kind (e.g. "mix") to the other family
        // (e.g. "cheese"), save a crossFamilyRouting alias so a future import
        // of the same workbook pre-selects that family tab and linked recipe.
        // This is a SEPARATE alias kind that bypasses the isCrossFamilyMixCheesePair
        // guard on appType — the guard only applies to appType aliases (which
        // auto-apply to applicator slots) not to these explicit user-confirmed picks.
        const parsedKind = specImportRecipeDisplayKind(r.baseOrig);
        if (parsedKind !== r.kind) {
          out.push({
            kind: "crossFamilyRouting",
            externalName: external,
            canonicalName: linked,
            context: r.kind, // "cheese" or "mix" — the TARGET display kind
          });
        }
        // Two rows: the context-free one keeps the legacy factory-wide
        // fallback working, the brand-scoped one (context = brand) lets each
        // brand remember its OWN pick for a generic blend name instead of the
        // last brand imported clobbering everyone's (specAliasKey includes
        // context, so both rows coexist through merge + server upsert).
        out.push({ kind: "appType", externalName: external, canonicalName: linked, context: null });
        const brandCtx = r.brand.trim();
        if (brandCtx) {
          out.push({ kind: "appType", externalName: external, canonicalName: linked, context: brandCtx });
        }
      } else {
        out.push({
          kind: "recipeName",
          externalName: external,
          canonicalName: linked,
          context: r.kind,
        });
      }
    }
    // Manual RENAMES are learnable too (brand/flavor renames already are):
    // remember "sheet label → the user's typed name" so a re-import of the
    // same sheet applies the rename instead of recreating the raw sheet name.
    // Dough/sauce renames go under "recipeName" (kind-scoped); cheese/mix
    // renames go under "appType" — safe to learn because the prepare pass
    // applies blend-name aliases to the recipe AND its matching applicator
    // slots in LOCKSTEP (applySpecImportBlendNameAliases), so a remembered
    // rename can never disconnect a slot from its recipe.
    for (const r of recipes) {
      if (!r.include) continue;
      if (r.linkExisting?.trim()) continue;
      const external = (r.baseOrig.name ?? "").trim();
      const renamed = r.name.trim();
      if (!external || !renamed) continue;
      if (external.toLowerCase() === renamed.toLowerCase()) continue;
      if (r.kind === "cheese" || r.kind === "mix") {
        // Same generic-name guard as the link branch above.
        if (isGenericSlotTypeName(external) || isGenericSlotTypeName(renamed)) continue;
        // Same dual-row scheme as the links above: context-free fallback +
        // brand-scoped row when the recipe carries a brand.
        out.push({ kind: "appType", externalName: external, canonicalName: renamed, context: null });
        const brandCtx = r.brand.trim();
        if (brandCtx) {
          out.push({ kind: "appType", externalName: external, canonicalName: renamed, context: brandCtx });
        }
      } else {
        out.push({
          kind: "recipeName",
          externalName: external,
          canonicalName: renamed,
          context: r.kind,
        });
      }
    }
    return out;
  }, [recipes]);

  // Everything learnable this Apply will persist: step-1 brand/flavor renames
  // plus the user's "use existing" recipe links (links win on key collisions —
  // an explicit pick beats a rename of the same label).
  const learnedAll = useMemo(
    () => mergeSpecAliases(learnedRenames, learnedLinks),
    [learnedRenames, learnedLinks],
  );

  // What the step-2 "mappings will be remembered" note reports: the prepare-time
  // learned mappings PLUS the user's step-1 renames and "use existing" links,
  // exactly what will be saved on Apply.
  const rememberedMappingCount = useMemo(
    () => mergeSpecAliases(prepared?.newAliases ?? [], learnedAll).length,
    [prepared, learnedAll],
  );

  // The edited, include-only import that would be applied. Recomputed live so the
  // change list and counts always reflect the user's edits.
  const edited: ParsedSpecImport = useMemo(() => {
    // "Use existing recipe" picks AND manual renames change the RECIPE's name,
    // so any profile applicator slot whose type names that blend must follow:
    // the apply-time slot resolvers loose-match applicator types against this
    // import's recipe names to re-type slots to the generic "cheese"/"Mix" card.
    // Without the re-point, a linked/renamed blend's slot no longer matches
    // anything and leaks into the raw applicator Type dropdown. Keyed by BOTH
    // the pristine parsed name and the current (possibly renamed) name.
    const linkedTypeRenames = new Map<string, string>();
    for (const r of recipes) {
      if (!r.include) continue;
      if (r.kind !== "cheese" && r.kind !== "mix") continue;
      const linked = r.linkExisting?.trim();
      const typed = r.name.trim();
      const renamed =
        !linked && typed && typed !== (r.orig.name ?? "").trim() ? typed : "";
      const finalName = linked || renamed;
      if (!finalName) continue;
      for (const nm of [r.baseOrig.name ?? "", r.orig.name ?? "", r.name]) {
        const key = specImportNameMatchKey(cleanSpecCheeseRecipeName(nm ?? ""));
        if (key && !linkedTypeRenames.has(key)) linkedTypeRenames.set(key, finalName);
      }
    }
    const repointApplicators = (p: ParsedProfile): ParsedProfile => {
      if (linkedTypeRenames.size === 0 || !p.applicators?.length) return p;
      let changed = false;
      const applicators = p.applicators.map((a) => {
        const key = specImportNameMatchKey(cleanSpecCheeseRecipeName(a.type ?? ""));
        const linked = key ? linkedTypeRenames.get(key) : undefined;
        if (!linked || linked === a.type) return a;
        changed = true;
        return { ...a, type: linked };
      });
      return changed ? { ...p, applicators } : p;
    };
    // Dough/sauce recipe decisions ("use existing" links AND manual renames)
    // must follow through to the profiles' dough/sauce TYPE assignments, or the
    // apply-time relink never connects them and the raw sheet name leaks into
    // the type dropdowns as a bogus new option.
    const namedRenames: NamedRecipeRename[] = [];
    for (const r of recipes) {
      if (!r.include) continue;
      if (r.kind !== "dough" && r.kind !== "sauce") continue;
      const finalName = r.linkExisting?.trim() || r.name.trim();
      if (!finalName) continue;
      const fromNames = [r.baseOrig.name ?? "", r.orig.name ?? ""].filter(
        (nm) =>
          nm.trim() &&
          specImportNameMatchKey(nm) !== specImportNameMatchKey(finalName),
      );
      if (!fromNames.length) continue;
      namedRenames.push({ kind: r.kind, fromNames, to: finalName });
    }
    const outProfiles = repointProfileNamedRecipes(
      profiles
        .filter((p) => p.include)
        .map((p): ParsedProfile => {
          const out: ParsedProfile = { ...p.orig, brand: p.brand.trim(), flavor: p.flavor.trim() };
          const die = p.dieType.trim();
          if (die) out.dieType = die;
          else delete out.dieType;
          return repointApplicators(out);
        }),
      namedRenames,
    );
    const outRecipes = recipes
      .filter((r) => r.include)
      .map((r): ParsedRecipe => {
        const linked = r.linkExisting?.trim();
        // SPEC-WINS: a linked Dough/Sauce pick with parsed rows applies like a
        // NORMAL recipe under the linked name — library copy + profile ties get
        // the sheet's rows, and commit also replaces the server-pool recipe's
        // rows. No "update it" opt-in anymore; the spec sheet is the source of
        // truth for recipe content. Mixes also update when the sheet has usable
        // ingredient rows: their components and per-pizza ounces come from the
        // spec, while operational fields remain manager-controlled. Cheese is a
        // units mismatch (spec sheets are per-PIZZA ounces, the cheese pool is
        // per-BATCH pounds — the cheese workbook importer owns those updates);
        // cheese links stay reference-only.
        const wantsUpdate =
          !!linked &&
          (r.kind === "dough" || r.kind === "sauce" || r.kind === "mix") &&
          hasUsableIngredientRows(r.orig);
        const out: ParsedRecipe = linked
          ? wantsUpdate
            ? { ...r.orig, name: linked, kind: parseKindOf(r.kind) }
            : { ...r.orig, name: linked, kind: parseKindOf(r.kind), referenceOnly: true }
          : { ...r.orig, name: r.name.trim(), kind: parseKindOf(r.kind) };
        if (!linked || wantsUpdate) delete out.referenceOnly;
        // The user typed a different name than the parse suggested — flag it so
        // the commit-time name passes (canonicalize / snap-to-existing) leave
        // the rename exactly as typed instead of reverting to the suggestion.
        // An update-linked recipe is flagged too: its name IS the user's
        // explicit pick of an existing recipe, and the canonicalize/snap
        // passes must not rewrite it away from the pool recipe it targets.
        if (wantsUpdate || (!linked && out.name && out.name !== (r.orig.name ?? "").trim())) {
          out.userNamed = true;
        } else {
          delete out.userNamed;
        }
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
    () =>
      prepared
        ? buildDiscrepancies(edited, prepared.ingredientMergeAliases)
        : [],
    [edited, prepared],
  );

  // Per-recipe map of ingredients that are in the CURRENT library but NOT in the
  // import — applying the import would remove them from the saved recipe.
  // Keyed by "kind\x00recipeName (lowercased)" matching how buildDiscrepancies
  // reports extra-ingredient entries. Only applies to non-new recipes.
  const removedIngredientsByRecipe = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of discrepancies) {
      if (d.type !== "extra-ingredient" || !d.ingredient) continue;
      const key = `${d.kind}\u0000${d.recipeName.trim().toLowerCase()}`;
      const arr = map.get(key);
      if (arr) arr.push(d.ingredient);
      else map.set(key, [d.ingredient]);
    }
    return map;
  }, [discrepancies]);

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
    // Step-2 pool-link warnings: flag dough/sauce names not yet in the factory pool.
    // These appear inline on each profile row so the manager sees them before Apply.
    if (step === 2) {
      const poolWarns = computeSpecImportPoolWarnings(
        profiles,
        existingRecipeNamesByKind.dough ?? [],
        existingRecipeNamesByKind.sauce ?? [],
      );
      for (const [k, ws] of poolWarns) {
        map.set(k, [...(map.get(k) ?? []), ...ws]);
      }
    }
    return map;
  }, [prepared, profiles, step, existingRecipeNamesByKind]);

  if (!open) return null;

  const profileKeys = new Set(profiles.map((p) => warnKey(p.orig.brand, p.orig.flavor)));
  const unmatchedWarnings = specWarnings.filter(
    (w) => !profileKeys.has(warnKey(w.brand, w.flavor)),
  );

  const includedProfiles = profiles.filter((p) => p.include).length;
  const includedRecipes = recipes.filter((r) => r.include).length;
  const includedCount = includedProfiles + includedRecipes;
  const nothingParsed = prepared != null && profiles.length === 0 && recipes.length === 0;
  // True when the manager has checked at least one removed profile for deletion.
  // Used to allow Next / Apply even when the new parse has zero parseable items.
  const anyRemovalsChecked = removedProfiles.some((p) => p.remove);

  // Live "would be dropped" attention count across included items.
  const attentionCount =
    edited.profiles.filter((p) => profileApplyIssue(p)).length +
    // Reference-only recipes reuse an existing recipe as-is, so name/rows issues
    // don't apply — their rows come from the saved library, not the sheet.
    edited.recipes.filter((r) => !r.referenceOnly && recipeApplyIssue(r)).length;

  return (
    <div
      // No close-on-backdrop-click: the AI parse runs for ~30-60s and the review
      // step holds unsaved edits — a stray tap on the dim background would
      // silently cancel the import (the late parse result is discarded by the
      // generation guard, so to the user "nothing happens"). Close is explicit
      // only: the X button or Cancel.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
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
            // While the commit is writing profiles/recipes, closing would let the
            // user navigate mid-apply — keep the dialog up until it finishes.
            disabled={applying}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
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
              <p className="text-xs text-muted-foreground/80">
                This usually takes about a minute. If the app sat idle, the server may need a
                moment to wake up first.
              </p>
              {/* Explicit escape hatch: if a request stalls (e.g. the server is
                  cold-starting), the user shouldn't have to find the small X to
                  get out of the blocking backdrop. */}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel import
              </button>
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

              {step === 1 && removedProfiles.length > 0 && (
                <div className="space-y-2">
                  <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-2.5">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="text-xs font-semibold">No longer in this workbook</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-700">
                      These profiles were in the previous import but aren't in the new file —
                      they may have been renamed or removed. Check any you'd like to delete.
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {removedProfiles.map((p) => (
                      <li
                        key={p.key}
                        className={`rounded-lg border p-3 ${p.remove ? "border-amber-400/60 bg-amber-500/5" : "border-border/60 opacity-70"}`}
                        data-testid={`spec-removed-profile-${p.key}`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={p.remove}
                            onChange={() =>
                              setRemovedProfiles((prev) =>
                                prev.map((r) =>
                                  r.key === p.key ? { ...r, remove: !r.remove } : r,
                                ),
                              )
                            }
                            className="mt-1 h-4 w-4 accent-amber-500"
                            aria-label={`Remove ${p.brand} ${p.flavor}`}
                            data-testid={`spec-removed-profile-remove-${p.key}`}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium text-foreground">
                              {p.brand || "(no brand)"} — {p.flavor || "(no flavor)"}
                            </span>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              Not found in the new file
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
                            removed
                          </span>
                        </div>
                      </li>
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
                          warnings={warningsByProfile.get(warnKey(p.orig.brand, p.orig.flavor)) ?? []}
                          onToggle={() => setProfile(p.key, { include: !p.include })}
                          onBrand={(brand) => setProfile(p.key, { brand })}
                          onFlavor={(flavor) => setProfile(p.key, { flavor })}
                          onDieType={(dieType) => setProfile(p.key, { dieType, dieTouched: true })}
                          onForceUpdate={(forceUpdate) => setProfile(p.key, { forceUpdate })}
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
                    {recipes.map((r) => {
                      // Removed ingredients: what's in the current library for
                      // this recipe but not in the import — applying would
                      // drop them from the saved recipe. Only relevant for
                      // non-new recipes.
                      const finalName = (r.linkExisting?.trim() || r.name.trim()).toLowerCase();
                      const recipeKindKey = `${parseKindOf(r.kind)}\u0000${finalName}`;
                      const removedIngredients = removedIngredientsByRecipe.get(recipeKindKey) ?? [];
                      return (
                        <RecipeRow
                          key={r.key}
                          item={r}
                          existingOptions={existingRecipeNamesByKind[r.kind] ?? []}
                          removedIngredients={removedIngredients}
                          onToggle={() => setRecipe(r.key, { include: !r.include })}
                          onName={(name) => setRecipe(r.key, { name })}
                          onKind={(kind) =>
                            setRecipe(r.key, {
                              kind,
                              linkExisting: undefined,
                              // The merge note describes the ORIGINAL suggested
                              // link; a kind change clears that link, so the
                              // note must go too.
                              mergedAway: false,
                            })
                          }
                          onLinkExisting={(linkExisting) =>
                            setRecipe(r.key, {
                              linkExisting: linkExisting || undefined,
                              // The merge note only applies to the originally
                              // suggested survivor link — picking a different
                              // recipe (or clearing the pick) retires it.
                              mergedAway: false,
                            })
                          }
                        />
                      );
                    })}
                  </ul>
                </div>
              )}

              {step === 2 && (prepared?.newMixIngredients ?? []).length > 0 && (
                <div className="space-y-2" data-testid="spec-new-mix-ingredients">
                  <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-2.5">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="text-xs font-semibold">New ingredients detected on existing mixes</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-700">
                      The spec sheet added ingredient rows that aren't on your saved mixes yet.
                      Check the ones you'd like to add — existing amounts are never changed.
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {(prepared?.newMixIngredients ?? []).map((entry) => {
                      // Compound key: brand + NUL + name (both lower-cased).
                      // Prevents same-name mixes under different brands from
                      // sharing checkbox state or React list keys.
                      const brandKey = entry.brand.trim().toLowerCase();
                      const nameKey = entry.mixName.trim().toLowerCase();
                      const key = `${brandKey}\0${nameKey}`;
                      // data-testid uses a URL-safe variant (NUL → "|") for
                      // test selectors.
                      const testKey = `${brandKey}|${nameKey}`;
                      const accepted = acceptedNewMixNames.has(key);
                      return (
                        <li
                          key={key}
                          className={`rounded-lg border p-3 ${accepted ? "border-amber-400/60 bg-amber-500/5" : "border-border/60 opacity-70"}`}
                          data-testid={`spec-new-mix-ingredients-${testKey}`}
                        >
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={accepted}
                              onChange={() =>
                                setAcceptedNewMixNames((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                              className="mt-0.5 h-4 w-4 accent-amber-500"
                              aria-label={`Add new ingredients to ${entry.mixName}`}
                              data-testid={`spec-new-mix-accept-${testKey}`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {entry.mixName}
                                </span>
                                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
                                  {entry.newComponents.length} new
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {entry.newComponents.map((c, i) => (
                                  <span key={c.ingredient}>
                                    {c.ingredient}{" "}
                                    <span className="text-foreground/70">{c.perPizza} oz/pizza</span>
                                    {i < entry.newComponents.length - 1 ? " · " : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {step === 2 && rememberedMappingCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {rememberedMappingCount} new name mapping
                  {rememberedMappingCount === 1 ? "" : "s"} will be remembered for
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

              {step === 2 && (prepared.formulaChanges?.length ?? 0) > 0 && (
                <div
                  className="rounded-md border border-border bg-muted/40 p-3 text-sm"
                  data-testid="spec-formula-change-summary"
                >
                  <div className="font-medium text-foreground">Formula changes detected</div>
                  <div className="mt-1 text-muted-foreground">
                    {(["added", "removed", "renamed", "quantity-changed"] as const)
                      .map((type) => {
                        const count = (prepared.formulaChanges ?? []).filter((change) => change.type === type).length;
                        return count > 0
                          ? `${count} ${type === "quantity-changed" ? "quantity changed" : type}`
                          : "";
                      })
                      .filter(Boolean)
                      .join(" · ")}
                    {" "}— batch and per-pizza quantities are evaluated separately.
                  </div>
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
                (nothingParsed && !anyRemovalsChecked) ||
                includedProfileMissing
              }
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onConfirm(
              edited,
              learnedAll,
              removedProfiles
                .filter((p) => p.remove)
                .map((p) => ({ brand: p.brand, flavor: p.flavor })),
              new Set(
                profiles
                  .filter((p) => p.include && p.forceUpdate)
                  .map((p) => `${p.brand.trim().toLowerCase()}\u0000${p.flavor.trim().toLowerCase()}`),
              ),
              acceptedNewMixNames,
            )}
              disabled={
                loading ||
                applying ||
                !!error ||
                !prepared ||
                ((nothingParsed || includedCount === 0) && !anyRemovalsChecked) ||
                attentionCount > 0
              }
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {includedCount > 0
                ? `Apply ${includedCount} item${includedCount === 1 ? "" : "s"}`
                : `Remove ${removedProfiles.filter((p) => p.remove).length} profile${removedProfiles.filter((p) => p.remove).length === 1 ? "" : "s"}`}
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
  onForceUpdate,
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
  /** Step-2 only: called when the "force update" checkbox changes. */
  onForceUpdate?: (v: boolean) => void;
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
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}
        {onForceUpdate && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={item.forceUpdate}
              onChange={(e) => onForceUpdate(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
              aria-label={`Force update existing data for ${brand} ${flavor}`}
              data-testid={`spec-profile-force-${item.key}`}
            />
            Override existing dough / sauce / weight with sheet values
          </label>
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

function RecipeRow({
  item,
  existingOptions,
  removedIngredients = [],
  onToggle,
  onName,
  onKind,
  onLinkExisting,
}: {
  item: RecipeItem;
  /** Existing saved recipes of this kind the user can reuse instead of creating one. */
  existingOptions: string[];
  /**
   * Ingredients present in the CURRENT library recipe but NOT in the import —
   * applying would remove them. Computed from discrepancy `extra-ingredient`
   * entries for non-new recipes. Empty for new ones.
   */
  removedIngredients?: string[];
  onToggle: () => void;
  onName: (v: string) => void;
  onKind: (v: SpecImportDisplayKind) => void;
  onLinkExisting: (v: string) => void;
}) {
  const linked = item.linkExisting?.trim() ?? "";
  // Effective name: the linked recipe when reusing, else the (editable) parsed name.
  const name = linked || item.name.trim();
  // A linked mix is a deliberate spec-wins update only when the sheet supplied
  // at least one usable ingredient. Keep blank-row links reference-only so they
  // cannot erase the manager's saved mix.
  const willUpdate =
    (item.kind === "dough" || item.kind === "sauce" || item.kind === "mix") &&
    hasUsableIngredientRows(item.orig);
  const candidate: ParsedRecipe = {
    ...item.orig,
    name,
    kind: parseKindOf(item.kind),
    ...(linked && !willUpdate ? { referenceOnly: true } : {}),
  };
  const issue = linked ? undefined : recipeApplyIssue(candidate);
  // Mixes live in the same preset library as cheese recipes (only the NAME
  // list differs), so existence checks use the underlying parse kind.
  const isNew = !linked && (!name || !recipeExistsForImport(parseKindOf(item.kind), name));
  const rowsPreview = recipeRowsPreview(
    item.orig,
    item.kind === "mix" ? "oz/pizza" : "lb",
  );
  // SPEC-WINS: a linked Dough/Sauce pick with parsed rows always replaces the
  // existing recipe's ingredients on Apply — no opt-in checkbox. Linked mixes
  // follow the same explicit update decision: sheet components and per-pizza
  // ounces replace saved mix components, but manager-controlled operational
  // fields remain intact. Cheese is a UNITS mismatch: spec sheets carry
  // per-PIZZA ounces while the saved cheese recipes store per-BATCH pounds —
  // updating would overwrite good batch pounds with per-pizza numbers. Cheese
  // batch pounds update via the Cheese Mix Recipe Specs workbook importer instead.
  // Recipes attach by NAME only — profiles link a dough/sauce recipe name (or
  // a cheese/mix applicator-slot name) and hydrate from the library by that
  // name. There is no brand/flavor attach editor anymore: showing where a
  // recipe "goes to" was the old targeting model and it caused whole-brand
  // overwrites. A saved library recipe that nothing links yet is fine — it
  // attaches automatically when a spec sheet names it.
  const showLibraryNote = item.include && !linked && !issue;

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

          {item.orig.variantLabel ? (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                weight variant
              </span>
              <span className="truncate">
                {item.orig.variantLabel}
                {item.orig.doughballOz != null ? ` · ${item.orig.doughballOz} oz` : ""}
              </span>
            </div>
          ) : item.kind === "dough" ? (
            <div className="mt-1">
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                recipe formula
              </span>
            </div>
          ) : (item.kind === "cheese" || item.kind === "mix") ? (
            <div className="mt-1 text-xs text-muted-foreground" data-testid={`spec-recipe-brand-${item.key}`}>
              {item.brand.trim() ? (
                <>Customer: <span className="text-foreground">{item.brand.trim()}</span></>
              ) : (
                <span className="text-muted-foreground/60">no brand — won't match a customer</span>
              )}
            </div>
          ) : null}

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

          {linked && item.mergedAway && (
            <div
              className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-500/10 p-2"
              data-testid={`spec-recipe-merged-away-${item.key}`}
            >
              <span className="text-xs text-amber-700">
                This sheet was merged into{" "}
                <span className="font-medium">"{linked}"</span>, which is also
                in this workbook — so it's left unchecked. Check it only if you
                want to bring it in pointing at that recipe again.
              </span>
            </div>
          )}
          {linked && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              {willUpdate
                ? item.kind === "mix"
                  ? `Using your existing “${linked}” — its ingredients and oz-per-pizza amounts will be replaced with this sheet's. Your mix settings stay as-is.`
                  : `Using your existing “${linked}” — its ingredients will be replaced with this sheet's.`
                : `Using your existing “${linked}” — it won't be changed.`}
              {item.kind === "cheese" && (
                <>
                  {" "}
                  This sheet's per-pizza ounces will be saved to its oz-per-pizza
                  column; its batch pounds are kept as-is.
                </>
              )}
            </div>
          )}

          {linked && willUpdate && rowsPreview && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Will change to: {rowsPreview}
            </div>
          )}

          {!linked && rowsPreview && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Read: {rowsPreview}
            </div>
          )}
          {!linked && !item.orig.referenceOnly && (
            <div
              className="mt-1.5 text-xs text-muted-foreground"
              data-testid={`spec-recipe-counts-${item.key}`}
            >
              Components: source {item.orig.rows?.length ?? 0} · normalized{" "}
              {countUsableRecipeRows(item.orig.rows)} · landed pending
            </div>
          )}
          {linked && !item.orig.referenceOnly && (
            <div
              className="mt-1.5 text-xs text-muted-foreground"
              data-testid={`spec-recipe-counts-${item.key}`}
            >
              Components: source {item.orig.rows?.length ?? 0} · normalized{" "}
              {countUsableRecipeRows(item.orig.rows)} · landed in “{linked}”
            </div>
          )}

          {item.include && !isNew && removedIngredients.length > 0 && (
            <div
              className="mt-1.5 rounded-md border border-amber-400/60 bg-amber-500/10 p-2 text-xs text-amber-700"
              data-testid={`spec-recipe-removed-ingredients-${item.key}`}
            >
              Removes {removedIngredients.length} ingredient{removedIngredients.length === 1 ? "" : "s"} no longer in the sheet:{" "}
              {removedIngredients.map((ing, i) => (
                <span key={ing}>
                  <span className="line-through">{ing}</span>
                  {i < removedIngredients.length - 1 ? ", " : ""}
                </span>
              ))}
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

          {showLibraryNote && (
            <div className="mt-1 text-xs text-muted-foreground">
              Saved to your library — it attaches to every product whose setup
              names this recipe.
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
