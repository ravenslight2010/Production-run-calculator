import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  formSchema,
  type FormValues,
  type RecipeRow,
  DEFAULT_VALUES,
  PACKAGING_TYPE_OPTIONS,
  LABEL_POSITION_OPTIONS,
} from "../types";
import { loadProfile, saveProfile } from "../storage";
import { resolveDieLineDefaults, resolveDieLineDefaultsOnSwitch, resolveCrustLineDefaults } from "../dieDefaults";
import { useDieLineDefaults } from "../hooks/useDieLineDefaults";
import { brandTagLabels } from "@workspace/name-match";
import { fetchSavedSpecSheets } from "../savedSpecSheets";
import { fetchSavedShippingGuides } from "../savedShippingGuides";
import {
  buildProfileAutofillPlan,
  applyAutofillEntries,
  type AutofillEntry,
  type AutofillConflict,
  type ProfileAutofillPlan,
} from "../profileAutofill";
import {
  allergenOptions,
  normalizeAllergen,
} from "@workspace/allergen";
import {
  IngredientSelect,
  CheesePickCard,
  MixRecipeCard,
  DoughRecipeCard,
  FrontlineRecipeCard,
  TypeDropdown,
  NumField,
} from "../pages/home";
import { useMixes } from "../hooks/useMixes";
import { useCheeseRecipes } from "@/hooks/useCheeseRecipes";
import { useNamedRecipes } from "@/hooks/useNamedRecipes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ChevronDown, Settings, Package, Save, X, Sparkles, Check, AlertTriangle } from "lucide-react";
import { matchDoughballVariant, normalizeDoughballVariants, type DoughballVariant } from "@workspace/named-recipes";

type ApplicatorNum = 1 | 2 | 3 | 4;

const APPLICATOR_LABELS: Record<ApplicatorNum, string> = {
  1: "Applicator 1",
  2: "Applicator 2",
  3: "Applicator 3",
  4: "Applicator 4",
};

/**
 * A selectable chip list backed by a user-editable master list. Clicking a chip
 * toggles the selected value (click the active one to clear). The trailing "+"
 * opens an inline text input to add a new option (replacing the old
 * window.prompt, which is unreliable inside the preview iframe). When onRemove is
 * provided, each chip shows a small × to delete that option from the master list.
 * Reused for Die Type (add-only) and the four editable packaging lists.
 */
function EditableChipList({
  label,
  options,
  value,
  onSelect,
  onAdd,
  onRemove,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (val: string) => void;
  onAdd: (name: string) => void;
  onRemove?: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    const t = text.trim();
    if (t) onAdd(t);
    setText("");
    setAdding(false);
  };
  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{label}</label>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map(opt => {
          const active = value === opt;
          return (
            <span
              key={opt}
              className={`inline-flex items-center rounded-md text-xs font-semibold border capitalize transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"}`}
            >
              <button
                type="button"
                onClick={() => onSelect(active ? "" : opt)}
                className="px-2.5 py-1"
              >
                {opt}
              </button>
              {onRemove && (
                <button
                  type="button"
                  aria-label={`Remove ${opt}`}
                  onClick={() => onRemove(opt)}
                  className={`pr-1.5 pl-0.5 py-1 opacity-60 hover:opacity-100 ${active ? "" : "hover:text-foreground"}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          );
        })}
        {adding ? (
          <input
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { setText(""); setAdding(false); }
            }}
            placeholder="New…"
            className="w-24 px-2 py-1 rounded-md text-xs border border-border/50 bg-background text-foreground focus:outline-none focus:border-primary"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-2 py-1 rounded-md text-xs border border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-colors"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

/** A selectable chip list over a FIXED set of {value,label} options (no add/remove). */
function FixedChipSelect({
  label,
  options,
  value,
  onSelect,
  allowClear = true,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onSelect: (val: string) => void;
  allowClear?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(active && allowClear ? "" : opt.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SLIP_SHEET_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

export interface SetupProfileEditorProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called after Save Setup persists the profile, so the host page can
   * live-refresh an open run form that uses the same brand+flavor (the
   * "unified setup editing" flow — edit once, updates everywhere).
   */
  onSaved?: (brand: string, flavor: string) => void;
  initialBrand?: string;
  initialFlavor?: string;
  isSupervisor: boolean;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  /** Custom allergens (beyond egg/soy) already used by saved profiles, so they stay pickable. */
  allergenExtra?: string[];
  onAddBrand: (name: string) => string;
  onRemoveBrand: (name: string) => void;
  onAddFlavor: (name: string, brand?: string) => string | undefined;
  onRemoveFlavor: (name: string, brand?: string) => void;
  dieTypes: string[];
  onAddDieType: (name: string) => void;
  circles: string[];
  onAddCircle: (name: string) => void;
  onRemoveCircle: (name: string) => void;
  shipperOptions: string[];
  onAddShipper: (name: string) => void;
  onRemoveShipper: (name: string) => void;
  skidStackingOptions: string[];
  onAddSkidStacking: (name: string) => void;
  onRemoveSkidStacking: (name: string) => void;
  gripSheetsOptions: string[];
  onAddGripSheets: (name: string) => void;
  onRemoveGripSheets: (name: string) => void;
  ingredientTypes: string[];
  onAddIngredientType: (name: string) => void;
  onRemoveIngredientType: (name: string) => void;
  pepTypes: string[];
  onAddPepType: (name: string) => void;
  onRemovePepType: (name: string) => void;
  doughIngredients: string[];
  onAddDoughIngredient: (name: string) => void;
  onRemoveDoughIngredient: (name: string) => void;
  doughRecipeNames: string[];
  onAddDoughRecipeName: (name: string) => void;
  onRemoveDoughRecipeName: (name: string) => void;
  frontlineIngredients: string[];
  onAddFrontlineIngredient: (name: string) => void;
  onRemoveFrontlineIngredient: (name: string) => void;
  frontlineRecipeNames: string[];
  onAddFrontlineRecipeName: (name: string) => void;
  onRemoveFrontlineRecipeName: (name: string) => void;
  // Unified ingredient universe (catalog + every server pool's recipe rows +
  // all local lists). When provided it backs every ingredient-name suggestion
  // list in this editor; falls back to the per-category lists when absent.
  ingredientUniverse?: string[];
}

/**
 * Standalone brand/flavor profile editor. Lets a manager/supervisor pick any
 * brand/flavor (existing or new) and edit its saved setup directly, without
 * touching the current run or dayState. Reuses the exact same saveProfile /
 * loadProfile round-trip (and its empty-form guard) as the per-run Setup tab,
 * and reuses the same field components so behavior stays identical.
 */
export default function SetupProfileEditor({
  open,
  onClose,
  onSaved,
  initialBrand,
  initialFlavor,
  isSupervisor,
  brands,
  brandFlavors,
  allergenExtra,
  onAddBrand,
  onRemoveBrand,
  onAddFlavor,
  onRemoveFlavor,
  dieTypes,
  onAddDieType,
  circles,
  onAddCircle,
  onRemoveCircle,
  shipperOptions,
  onAddShipper,
  onRemoveShipper,
  skidStackingOptions,
  onAddSkidStacking,
  onRemoveSkidStacking,
  gripSheetsOptions,
  onAddGripSheets,
  onRemoveGripSheets,
  ingredientTypes,
  onAddIngredientType,
  onRemoveIngredientType,
  pepTypes,
  onAddPepType,
  onRemovePepType,
  doughIngredients,
  onAddDoughIngredient,
  onRemoveDoughIngredient,
  doughRecipeNames,
  onAddDoughRecipeName,
  onRemoveDoughRecipeName,
  frontlineIngredients,
  onAddFrontlineIngredient,
  onRemoveFrontlineIngredient,
  frontlineRecipeNames,
  onAddFrontlineRecipeName,
  onRemoveFrontlineRecipeName,
  ingredientUniverse,
}: SetupProfileEditorProps) {
  const [brand, setBrand] = useState(initialBrand ?? "");
  const [flavor, setFlavor] = useState(initialFlavor ?? "");
  const [lineType, setLineType] = useState<"dough" | "crusts">("dough");
  const [sauceWeightsOpen, setSauceWeightsOpen] = useState(true);
  const [pep1ShowB, setPep1ShowB] = useState(false);
  const [pep2ShowB, setPep2ShowB] = useState(false);
  const [autofill, setAutofill] = useState<{
    plan: ProfileAutofillPlan;
    applied: AutofillEntry[];
    sheetsAvailable: number;
  } | null>(null);
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [autofillError, setAutofillError] = useState("");
  // Conflict fields the user has already resolved (picked a value or kept the
  // current one) — hidden from the pending-conflicts list. Keyed by field.
  const [resolvedConflicts, setResolvedConflicts] = useState<Set<string>>(new Set());
  // Manual doughball-variant pick (same invariant as the run form): set when the
  // picked dough family recipe has several variants and none auto-matched while
  // the weight was blank. Blank-fill only — never overwrites a typed value.
  const [doughVariantPick, setDoughVariantPick] = useState<{ recipeName: string; variants: DoughballVariant[] } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });
  const v = form.watch();
  const { fields: doughFields, append: appendDough, remove: removeDough, replace: replaceDough } = useFieldArray({ control: form.control, name: "doughRecipe" });
  const { fields: frontlineFields, append: appendFrontline, remove: removeFrontline, replace: replaceFrontline } = useFieldArray({ control: form.control, name: "frontlineRecipe" });
  const { fields: cheese1Fields, append: appendCheese1, remove: removeCheese1, replace: replaceCheese1 } = useFieldArray({ control: form.control, name: "app1CheeseRecipe" });
  const { fields: cheese2Fields, append: appendCheese2, remove: removeCheese2, replace: replaceCheese2 } = useFieldArray({ control: form.control, name: "app2CheeseRecipe" });
  const { fields: cheese3Fields, append: appendCheese3, remove: removeCheese3, replace: replaceCheese3 } = useFieldArray({ control: form.control, name: "app3CheeseRecipe" });
  const { fields: cheese4Fields, append: appendCheese4, remove: removeCheese4, replace: replaceCheese4 } = useFieldArray({ control: form.control, name: "app4CheeseRecipe" });

  const cheeseFieldsByApp: Record<ApplicatorNum, { id: string }[]> = { 1: cheese1Fields, 2: cheese2Fields, 3: cheese3Fields, 4: cheese4Fields };
  const appendCheeseByApp: Record<ApplicatorNum, (r: RecipeRow) => void> = { 1: appendCheese1, 2: appendCheese2, 3: appendCheese3, 4: appendCheese4 };
  const removeCheeseByApp: Record<ApplicatorNum, (idx: number) => void> = { 1: removeCheese1, 2: removeCheese2, 3: removeCheese3, 4: removeCheese4 };
  const replaceCheeseByApp: Record<ApplicatorNum, (rows: RecipeRow[]) => void> = { 1: replaceCheese1, 2: replaceCheese2, 3: replaceCheese3, 4: replaceCheese4 };

  const { items: mixes } = useMixes();
  // Manager-set per-die line-setting overrides (server master-data); die
  // pre-fill resolves through these first, then the built-in map.
  const { overrides: dieLineDefaultOverrides } = useDieLineDefaults();
  const { items: cheeseRecipesList } = useCheeseRecipes();
  const { items: doughRecipesList } = useNamedRecipes("dough");
  const { items: sauceRecipesList } = useNamedRecipes("sauce");

  const enabledCheeseRecipes = useMemo(() => cheeseRecipesList.filter(r => r.enabled !== false), [cheeseRecipesList]);

  const serverMixRowsByName = useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const mix of mixes) {
      const rows = (mix.components ?? []).filter(c => c.ingredient.trim()).map(c => ({ ingredient: c.ingredient, lbs: c.perPizza }));
      if (rows.length > 0) map.set(mix.name.trim().toLowerCase(), rows);
    }
    return map;
  }, [mixes]);
  const serverMixNames = useMemo(() => [...new Set(mixes.map(m => m.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [mixes]);
  const serverMixIngredients = useMemo(() => [...new Set(mixes.flatMap(m => (m.components ?? []).map(c => c.ingredient.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b)), [mixes]);

  const serverCheeseByName = useMemo(() => {
    const map = new Map<string, CheeseRecipe>();
    for (const r of enabledCheeseRecipes) { const key = r.name.trim().toLowerCase(); if (key) map.set(key, r); }
    return map;
  }, [enabledCheeseRecipes]);
  const serverCheeseRowsByName = useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const r of enabledCheeseRecipes) {
      const rows = r.components.filter(c => c.ingredient.trim()).map(c => ({ ingredient: c.ingredient, lbs: c.lbs }));
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, rows);
    }
    return map;
  }, [enabledCheeseRecipes]);
  const serverCheeseNames = useMemo(() => [...new Set(enabledCheeseRecipes.map(r => r.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [enabledCheeseRecipes]);
  // Brand tags for cheese/mix names that collide across customers — pickers
  // show "Taco Mix (Marco's)" while the stored value stays the bare name.
  const cheeseNameBrandTags = useMemo(
    () => brandTagLabels(enabledCheeseRecipes.map(r => ({ name: r.name, brand: r.brand }))),
    [enabledCheeseRecipes],
  );
  const mixNameBrandTags = useMemo(
    () => brandTagLabels(mixes.map(m => ({ name: m.name, brand: m.brand ?? "" }))),
    [mixes],
  );

  const serverDoughRowsByName = useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const r of doughRecipesList) {
      if (r.enabled === false) continue;
      const rows = r.components.filter(c => c.ingredient.trim()).map(c => ({ ingredient: c.ingredient, lbs: c.lbs }));
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, rows);
    }
    return map;
  }, [doughRecipesList]);
  // Doughball variants per family recipe (label + weight/per-tray), mirroring
  // the run form: the profile's dough pick auto-fills variant numbers when the
  // die size resolves the variant, and offers a manual pick when ambiguous.
  const serverDoughVariantsByName = useMemo(() => {
    const map = new Map<string, DoughballVariant[]>();
    for (const r of doughRecipesList) {
      if (r.enabled === false) continue;
      const variants = normalizeDoughballVariants(r.doughballVariants);
      const key = r.name.trim().toLowerCase();
      if (key && variants.length > 0) map.set(key, variants);
    }
    return map;
  }, [doughRecipesList]);
  // Drop a stale variant prompt: the form moved to another recipe (profile
  // load/reset) or the weight got filled some other way — a leftover prompt
  // would apply the WRONG family's numbers.
  useEffect(() => {
    if (!doughVariantPick) return;
    const name = (v.doughRecipeName ?? "").trim().toLowerCase();
    const stale =
      name !== doughVariantPick.recipeName.trim().toLowerCase() ||
      (Number(v.targetDoughballWeight) || 0) > 0;
    if (stale) setDoughVariantPick(null);
  }, [doughVariantPick, v.doughRecipeName, v.targetDoughballWeight]);
  // Self-heal (mirrors the run form): a profile pointing at a pool dough
  // recipe that knows its doughball weight / per-tray, while the field still
  // sits at 0, adopts the pool value — variant match first (die size may have
  // been set AFTER the recipe pick), recipe-level fallback. Never overrides a
  // non-zero value the manager typed. Filling the weight also clears a pending
  // manual prompt via the stale-clear effect above.
  useEffect(() => {
    const name = v.doughRecipeName?.trim().toLowerCase();
    if (!name) return;
    if ((Number(v.targetDoughballWeight) || 0) > 0) return;
    const matched = matchDoughballVariant(serverDoughVariantsByName.get(name), { dieType: String(v.dieType ?? "") });
    const rec = doughRecipesList.find(r => r.enabled !== false && r.name.trim().toLowerCase() === name);
    const ballOz = matched?.weightOz ?? rec?.doughballWeightOz ?? 0;
    if (ballOz > 0) form.setValue("targetDoughballWeight", ballOz, { shouldDirty: true });
  }, [v.doughRecipeName, v.targetDoughballWeight, v.dieType, doughRecipesList, serverDoughVariantsByName, form]);
  useEffect(() => {
    const name = v.doughRecipeName?.trim().toLowerCase();
    if (!name) return;
    if ((Number(v.doughballsPerTray) || 0) > 0) return;
    const matched = matchDoughballVariant(serverDoughVariantsByName.get(name), { dieType: String(v.dieType ?? "") });
    const rec = doughRecipesList.find(r => r.enabled !== false && r.name.trim().toLowerCase() === name);
    const perTray = matched?.perTray ?? rec?.doughballsPerTray ?? 0;
    if (perTray > 0) form.setValue("doughballsPerTray", perTray, { shouldDirty: true });
  }, [v.doughRecipeName, v.doughballsPerTray, v.dieType, doughRecipesList, serverDoughVariantsByName, form]);
  const serverSauceRowsByName = useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const r of sauceRecipesList) {
      if (r.enabled === false) continue;
      const rows = r.components.filter(c => c.ingredient.trim()).map(c => ({ ingredient: c.ingredient, lbs: c.lbs }));
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, rows);
    }
    return map;
  }, [sauceRecipesList]);
  const serverDoughNames = useMemo(() => [...new Set(doughRecipesList.filter(r => r.enabled !== false).map(r => r.name.trim()).filter(Boolean))], [doughRecipesList]);
  const serverSauceNames = useMemo(() => [...new Set(sauceRecipesList.filter(r => r.enabled !== false).map(r => r.name.trim()).filter(Boolean))], [sauceRecipesList]);
  const doughRecipeNameOptions = useMemo(() => [...new Set([...serverDoughNames, ...doughRecipeNames].map(n => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [serverDoughNames, doughRecipeNames]);
  const frontlineRecipeNameOptions = useMemo(() => [...new Set([...serverSauceNames, ...frontlineRecipeNames].map(n => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [serverSauceNames, frontlineRecipeNames]);

  const cheeseNamesForRun = useMemo(() => {
    return (b: string, f: string): string[] => {
      const bl = b.trim().toLowerCase();
      const fl = f.trim().toLowerCase();
      if (!bl) return serverCheeseNames;
      const brandMatches = enabledCheeseRecipes.filter(r => r.brand.trim().toLowerCase() === bl);
      if (brandMatches.length === 0) return serverCheeseNames;
      const flavorMatches = fl
        ? brandMatches.filter(r => !r.flavors || r.flavors.length === 0 || r.flavors.some(fv => fv.trim().toLowerCase() === fl))
        : brandMatches;
      const pool = flavorMatches.length > 0 ? flavorMatches : brandMatches;
      return [...new Set(pool.map(r => r.name.trim()).filter(Boolean))].sort((a, b2) => a.localeCompare(b2));
    };
  }, [enabledCheeseRecipes, serverCheeseNames]);

  function resetFieldArrays(values: FormValues) {
    replaceDough(values.doughRecipe ?? []);
    replaceFrontline(values.frontlineRecipe ?? []);
    replaceCheese1(values.app1CheeseRecipe ?? []);
    replaceCheese2(values.app2CheeseRecipe ?? []);
    replaceCheese3(values.app3CheeseRecipe ?? []);
    replaceCheese4(values.app4CheeseRecipe ?? []);
  }

  // Load the saved profile whenever the picked brand/flavor changes (or the
  // editor opens). Falls back to a blank default form for a brand-new
  // brand+flavor combo that has no saved profile yet.
  useEffect(() => {
    if (!open) return;
    const b = brand.trim();
    const f = flavor.trim();
    const profile = b && f ? loadProfile(b, f) : null;
    const values = profile ?? DEFAULT_VALUES;
    form.reset(values);
    resetFieldArrays(values);
    setLineType(Number(values.crustsPerCase) > 0 && (values.doughRecipe ?? []).length === 0 ? "crusts" : "dough");
    setAutofill(null);
    setAutofillError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brand, flavor]);

  useEffect(() => {
    if (open) {
      setBrand(initialBrand ?? "");
      setFlavor(initialFlavor ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBrand, initialFlavor]);

  const flavorOptions = brandFlavors[brand] ?? [];

  function handleSave() {
    const b = brand.trim();
    const f = flavor.trim();
    if (!b || !f) {
      toast({ title: "Pick a brand and flavor first", variant: "destructive" });
      return;
    }
    const values = form.getValues();
    saveProfile(b, f, values);
    toast({ title: `Saved setup for ${b} — ${f}` });
    onSaved?.(b, f);
  }

  /**
   * Write accepted auto-fill entries into the form (NOT persisted — the user
   * still presses Save Setup). Recipe-name fields also hydrate their rows from
   * the matching server pool (cheese/mix/dough/sauce), mirroring what picking
   * the same name by hand in this editor does.
   */
  function applyAutofillToForm(entries: AutofillEntry[], plan: ProfileAutofillPlan) {
    if (entries.length === 0) return;
    const values = applyAutofillEntries(form.getValues(), entries, plan.pepCombinedTarget) as FormValues;
    const rec = values as unknown as Record<string, unknown>;
    for (const e of entries) {
      const nameKey = String(e.specValue).trim().toLowerCase();
      const appMatch = /^app([1-4])CheeseRecipeName$/.exec(e.field);
      if (appMatch) {
        const rows = serverCheeseRowsByName.get(nameKey) ?? serverMixRowsByName.get(nameKey);
        if (rows) rec[`app${appMatch[1]}CheeseRecipe`] = rows.map(r => ({ ...r }));
      } else if (e.field === "doughRecipeName") {
        const rows = serverDoughRowsByName.get(nameKey);
        if (rows) rec.doughRecipe = rows.map(r => ({ ...r }));
      } else if (e.field === "frontlineRecipeName") {
        const rows = serverSauceRowsByName.get(nameKey);
        if (rows) rec.frontlineRecipe = rows.map(r => ({ ...r }));
      }
    }
    // A die type filled by the auto-fill blank-fills the line settings too,
    // exactly like picking the same die by hand in this editor: manager
    // overrides first, built-in map second, never overwriting touched values.
    if (entries.some(e => e.field === "dieType")) {
      const lineFills = resolveDieLineDefaults(
        String(rec.dieType ?? ""),
        rec,
        dieLineDefaultOverrides,
      );
      Object.assign(rec, lineFills);
    }
    form.reset(values);
    resetFieldArrays(values);
  }

  async function runAutofill() {
    const b = brand.trim();
    const f = flavor.trim();
    if (!b || !f || autofillBusy) return;
    setAutofillBusy(true);
    setAutofillError("");
    try {
      const [sheets, savedGuides] = await Promise.all([
        fetchSavedSpecSheets(),
        fetchSavedShippingGuides().catch(() => []),
      ]);
      // Flatten each saved guide's nested `data.rows` up to the snapshot shape
      // the plan builder expects (label/sourceKey/createdAt + rows).
      const shippingGuides = savedGuides.map(g => ({
        label: g.label,
        sourceKey: g.sourceKey,
        createdAt: g.createdAt,
        rows: g.data?.rows ?? [],
      }));
      const plan = buildProfileAutofillPlan({
        sheets,
        brand: b,
        flavor: f,
        current: form.getValues(),
        mixNamesLower: new Set(serverMixNames.map(n => n.toLowerCase())),
        shippingGuides,
        doughRecipes: doughRecipesList,
        cheeseRecipes: cheeseRecipesList,
        mixes,
      });
      setResolvedConflicts(new Set());
      applyAutofillToForm(plan.fills, plan);
      setAutofill({ plan, applied: plan.fills, sheetsAvailable: sheets.length });
      if (plan.fills.length > 0) {
        toast({ title: `Filled ${plan.fills.length} blank field${plan.fills.length === 1 ? "" : "s"} from your latest imports`, description: "Review below, then press Save Setup to keep them." });
      }
    } catch {
      setAutofillError("Couldn't load your saved imported files. Check your connection and try again.");
    } finally {
      setAutofillBusy(false);
    }
  }

  function acceptMismatches(entries: AutofillEntry[]) {
    if (!autofill || entries.length === 0) return;
    applyAutofillToForm(entries, autofill.plan);
    setAutofill({ ...autofill, applied: [...autofill.applied, ...entries] });
  }

  /**
   * Resolve a source-vs-source conflict. Picking a candidate writes that value
   * into the form (form-only until Save Setup, same as fills/mismatches);
   * `value === null` keeps the current value untouched. Either way the conflict
   * is marked resolved so it drops out of the pending list.
   */
  function resolveConflict(conflict: AutofillConflict, value: string | number | null) {
    if (!autofill) return;
    if (value !== null) {
      applyAutofillToForm(
        [{ field: conflict.field, label: conflict.label, specValue: value, source: "your pick" }],
        autofill.plan,
      );
    }
    setResolvedConflicts(prev => {
      const next = new Set(prev);
      next.add(conflict.field);
      return next;
    });
  }

  const appliedFields = new Set((autofill?.applied ?? []).map(e => e.field));
  const pendingMismatches = (autofill?.plan.mismatches ?? []).filter(e => !appliedFields.has(e.field));
  const pendingConflicts = (autofill?.plan.conflicts ?? []).filter(c => !resolvedConflicts.has(c.field));

  function applicatorTypeHandlers(app: ApplicatorNum) {
    const typeKey = `app${app}Type` as const;
    const ozKey = `app${app}OzPerPizza` as const;
    const batchKey = `app${app}BatchLbs` as const;
    return {
      value: v[typeKey] as string,
      onChange: (val: string) => {
        form.setValue(typeKey, val, { shouldDirty: true });
        if (!val) {
          form.setValue(ozKey, 0, { shouldDirty: true });
          form.setValue(batchKey, 0, { shouldDirty: true });
        }
      },
    };
  }

  function renderApplicator(app: ApplicatorNum) {
    const typeKey = `app${app}Type` as const;
    const ozKey = `app${app}OzPerPizza` as const;
    const batchKey = `app${app}BatchLbs` as const;
    const nameKey = `app${app}CheeseRecipeName` as const;
    const recipeKey = `app${app}CheeseRecipe` as const;
    const type = (v[typeKey] as string) ?? "";
    const isMix = type.trim().toLowerCase().includes("mix");
    const isCheese = type.trim().toLowerCase() === "cheese";
    const recipe = (v[recipeKey] as RecipeRow[]) ?? [];
    const hasRecipe = !isMix && recipe.some(r => Number(r.lbs) > 0);
    const totalLbs = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    return (
      <div key={app} className="space-y-3">
        <div className="border-t border-border/60" aria-hidden="true" />
        <TypeDropdown
          label={APPLICATOR_LABELS[app]}
          {...applicatorTypeHandlers(app)}
          options={ingredientTypes}
          onAddOption={onAddIngredientType}
          onRemoveOption={onRemoveIngredientType}
          allowClear
        />
        {type.trim() && (
          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
            <NumField control={form.control} name={ozKey} label="Oz Per Pizza" />
            {!isMix && !hasRecipe && (
              <NumField control={form.control} name={batchKey} label="Batch Weight (lbs)" />
            )}
          </div>
        )}
        {isCheese && (
          <CheesePickCard
            embedded
            label={type || APPLICATOR_LABELS[app]}
            batches={0}
            ozPerPizza={Number((v[ozKey] as number) ?? 0)}
            recipe={recipe}
            recipeName={(v[nameKey] as string) ?? ""}
            recipeNameOptions={cheeseNamesForRun(brand, flavor)}
            optionLabels={cheeseNameBrandTags}
            recipeMissing={((v[nameKey] as string) ?? "").trim() !== "" && !serverCheeseByName.has(((v[nameKey] as string) ?? "").trim().toLowerCase())}
            shredderSetting={serverCheeseByName.get(((v[nameKey] as string) ?? "").trim().toLowerCase())?.shredderSetting ?? ""}
            cellulose={serverCheeseByName.get(((v[nameKey] as string) ?? "").trim().toLowerCase())?.cellulose ?? ""}
            poolComponents={serverCheeseByName.get(((v[nameKey] as string) ?? "").trim().toLowerCase())?.components}
            onRecipeNameChange={val => {
              form.setValue(nameKey, val, { shouldDirty: true });
              const rows = val.trim() ? serverCheeseRowsByName.get(val.trim().toLowerCase()) : undefined;
              const copy = (rows ?? []).map(r => ({ ...r }));
              form.setValue(recipeKey, copy, { shouldDirty: true });
              replaceCheeseByApp[app](copy);
            }}
          />
        )}
        {isMix && (
          <MixRecipeCard
            embedded
            label={type || APPLICATOR_LABELS[app]}
            totalRunLbs={totalLbs}
            fields={cheeseFieldsByApp[app]}
            recipe={recipe}
            fieldPrefix={recipeKey}
            register={form.register}
            ingredientOptions={ingredientUniverse ?? serverMixIngredients}
            onSetIngredient={(idx, val) => form.setValue(`${recipeKey}.${idx}.ingredient`, val, { shouldDirty: true })}
            onAppend={() => appendCheeseByApp[app]({ ingredient: "", lbs: 0 })}
            onRemove={removeCheeseByApp[app]}
            recipeName={(v[nameKey] as string) ?? ""}
            recipeNameOptions={serverMixNames}
            recipeNameLabels={mixNameBrandTags}
            onRecipeNameChange={val => {
              form.setValue(nameKey, val, { shouldDirty: true });
              const serverMix = serverMixRowsByName.get(val.trim().toLowerCase());
              if (serverMix) {
                const rows = serverMix.map(r => ({ ...r }));
                form.setValue(recipeKey, rows, { shouldDirty: true });
                replaceCheeseByApp[app](rows);
              }
            }}
          />
        )}
      </div>
    );
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            <h2 className="font-bold text-base">Setup Profiles</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <Form {...form}>
        {!isSupervisor ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Supervisor access required to edit setup profiles.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Brand</label>
                <IngredientSelect
                  value={brand}
                  onChange={val => { setBrand(val); setFlavor(""); }}
                  options={brands}
                  onAddOption={val => setBrand(onAddBrand(val))}
                  onRemoveOption={onRemoveBrand}
                  placeholder="Pick or add a brand…"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Flavor</label>
                <IngredientSelect
                  value={flavor}
                  onChange={setFlavor}
                  options={flavorOptions}
                  onAddOption={val => setFlavor(onAddFlavor(val, brand) ?? val)}
                  onRemoveOption={val => onRemoveFlavor(val, brand)}
                  placeholder={brand ? "Pick or add a flavor…" : "Pick a brand first"}
                />
              </div>
            </div>

            {brand.trim() && flavor.trim() && (
              <>
                <Card className="bg-card/50 border-border/50 shadow-md">
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-primary" /> Auto-Fill From Imports
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
                        Fill blank fields from all your latest imports — spec sheets, the palletizing guide, and the dough, cheese &amp; mix recipes. Differences are listed for you to review, and when your imports disagree you pick which value to use. Nothing changes without your OK, and nothing is saved until you press Save Setup.
                      </p>
                      <Button type="button" size="sm" variant="outline" onClick={runAutofill} disabled={autofillBusy}>
                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                        {autofillBusy ? "Checking…" : "Check Latest Imports"}
                      </Button>
                    </div>
                    {autofillError && (
                      <p className="text-xs text-destructive">{autofillError}</p>
                    )}
                    {autofill && autofill.sheetsAvailable === 0 && (
                      <p className="text-xs text-muted-foreground">No imported spec sheets are saved yet — import a spec sheet first, then come back here.</p>
                    )}
                    {autofill && autofill.sheetsAvailable > 0 && autofill.plan.matchedSheets === 0 && (
                      <p className="text-xs text-muted-foreground">Your latest imported files don't mention {brand.trim()} — {flavor.trim()}.</p>
                    )}
                    {autofill && autofill.plan.matchedSheets > 0 && autofill.applied.length === 0 && pendingMismatches.length === 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-primary" /> Everything already matches your latest imports.
                      </p>
                    )}
                    {(autofill?.applied.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filled in ({autofill!.applied.length})</p>
                        <ul className="space-y-0.5">
                          {autofill!.applied.map(e => (
                            <li key={e.field} className="text-xs flex items-center gap-1.5">
                              <Check className="w-3 h-3 text-primary shrink-0" />
                              <span className="text-muted-foreground">{e.label}:</span>
                              <span className="font-semibold">{String(e.specValue)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {pendingConflicts.length > 0 && autofill && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500">
                          Your imports disagree — pick one ({pendingConflicts.length})
                        </p>
                        <ul className="space-y-1.5">
                          {pendingConflicts.map(c => (
                            <li key={c.field} className="text-xs rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">{c.label}</span>
                                {c.currentValue !== undefined && (
                                  <span className="text-muted-foreground">
                                    now <span className="font-semibold text-foreground">{String(c.currentValue)}</span>
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {c.candidates.map((cand, i) => (
                                  <Button
                                    key={`${c.field}-${i}`}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => resolveConflict(c, cand.value)}
                                  >
                                    <span className="font-semibold">{String(cand.value)}</span>
                                    <span className="text-muted-foreground ml-1.5">({cand.source})</span>
                                  </Button>
                                ))}
                                {c.currentValue !== undefined && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => resolveConflict(c, null)}
                                  >
                                    Keep current
                                  </Button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {pendingMismatches.length > 0 && autofill && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Doesn't match the import ({pendingMismatches.length})</p>
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => acceptMismatches(pendingMismatches)}>
                            Use imported for all
                          </Button>
                        </div>
                        <ul className="space-y-1">
                          {pendingMismatches.map(e => (
                            <li key={e.field} className="text-xs flex items-center gap-2 flex-wrap rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                              <span className="font-semibold">{e.label}</span>
                              <span className="text-muted-foreground">
                                now <span className="font-semibold text-foreground">{String(e.currentValue)}</span>
                                {" · "}import says <span className="font-semibold text-foreground">{String(e.specValue)}</span>
                              </span>
                              <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs ml-auto" onClick={() => acceptMismatches([e])}>
                                Use imported
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <details open className="group rounded-xl border border-border/50 bg-card/50 shadow-md overflow-hidden">
                  <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none select-none">
                    <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Settings className="w-3.5 h-3.5" /> Line Settings
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-border/40 px-5 pb-5 pt-4 space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Line Type</label>
                      <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit">
                        <button type="button" onClick={() => setLineType("dough")} className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${lineType === "dough" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Dough</button>
                        <button type="button" onClick={() => {
                          setLineType("crusts");
                          // Pre-fill crust-run line settings — blank-fill only,
                          // never overwriting a hand-set value (dieDefaults.ts).
                          const fills = resolveCrustLineDefaults(form.getValues());
                          for (const [k, fv] of Object.entries(fills)) {
                            form.setValue(k as keyof typeof fills, fv, { shouldDirty: true });
                          }
                        }} className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${lineType === "crusts" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Crust</button>
                      </div>
                    </div>
                    {lineType !== "crusts" && (
                      <EditableChipList
                        label="Die Type"
                        options={dieTypes}
                        value={v.dieType ?? ""}
                        onSelect={val => {
                          form.setValue("dieType", val, { shouldDirty: true });
                          if (val) {
                            // Pre-fill line settings for this die size. Switch-aware:
                            // blank fields and another die's auto-filled defaults are
                            // replaced; hand-set values are kept (dieDefaults.ts).
                            const fills = resolveDieLineDefaultsOnSwitch(val, form.getValues(), dieLineDefaultOverrides);
                            for (const [k, fv] of Object.entries(fills)) {
                              form.setValue(k as keyof typeof fills, fv, { shouldDirty: true });
                            }
                          }
                        }}
                        onAdd={onAddDieType}
                      />
                    )}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Allergen</label>
                      <div className="flex flex-wrap gap-1.5">
                        {allergenOptions([...(allergenExtra ?? []), v.allergen]).map(m => {
                          const active = normalizeAllergen(v.allergen) === m.value;
                          return (
                            <button
                              key={m.value}
                              type="button"
                              onClick={() => form.setValue("allergen", m.value, { shouldDirty: true })}
                              className="px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1.5"
                              style={active ? { backgroundColor: m.color, color: m.textColor, borderColor: m.color } : { borderColor: m.color, color: m.color, backgroundColor: "transparent" }}
                            >
                              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {lineType === "crusts" ? (
                      <NumField control={form.control} name="approxLineSpeed" label="Approximate Line Speed (ppm)" step="0.1" />
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <NumField control={form.control} name="crustsPerCycle" label="Crusts Per Cycle" step="1" />
                        <NumField control={form.control} name="cycleSpeed" label="Cycle Speed (cyc/min)" />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <NumField control={form.control} name="speedAdjustment" label="Speed Adjustment" />
                      <NumField control={form.control} name="freezerTime" label="Freezer Time (min)" />
                    </div>
                    <Separator className="opacity-30" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumField control={form.control} name="pizzasPerCase" label="Pizzas Per Case" step="1" />
                      <NumField control={form.control} name="casesPerSkid" label="Cases Per Skid" step="1" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <NumField control={form.control} name="casesPerLayer" label="Extra Case Buffer" step="1" />
                      {lineType === "crusts" ? (
                        <NumField control={form.control} name="crustsPerStack" label="Crusts Per Stack" step="1" />
                      ) : (
                        <NumField control={form.control} name="doughballsPerTray" label="Doughballs Per Tray" step="1" />
                      )}
                    </div>
                    {lineType === "crusts" ? (
                      <NumField control={form.control} name="crustsPerCase" label="Crusts Per Case" step="1" />
                    ) : (() => {
                      const hasRecipe = (v.doughRecipe ?? []).some(r => Number(r.lbs) > 0) && Number(v.targetDoughballWeight) > 0;
                      return hasRecipe ? null : (
                        <NumField control={form.control} name="doughBatchYield" label="Dough Batch Yield (doughballs)" step="1" />
                      );
                    })()}
                  </div>
                </details>

                <details open className="group rounded-xl border border-border/50 bg-card/50 shadow-md overflow-hidden">
                  <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none select-none">
                    <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Package className="w-3.5 h-3.5" /> Packaging Settings
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-border/40 px-5 pb-5 pt-4 space-y-4">
                    <FixedChipSelect
                      label="Packaging Type"
                      options={PACKAGING_TYPE_OPTIONS}
                      value={(v.cartoned as string) ?? ""}
                      onSelect={val => form.setValue("cartoned", val, { shouldDirty: true })}
                    />
                    {((v.cartoned as string) ?? "").trim().toLowerCase() === "labeled" && (
                      <FixedChipSelect
                        label="Label Position"
                        options={LABEL_POSITION_OPTIONS}
                        value={(v.labelPosition as string) ?? ""}
                        onSelect={val => form.setValue("labelPosition", val, { shouldDirty: true })}
                      />
                    )}
                    {/* Quantity field(s) matching the selected Packaging Type. */}
                    {(() => {
                      const typeVal = ((v.cartoned as string) ?? "").trim().toLowerCase();
                      const posVal = ((v.labelPosition as string) ?? "").trim().toLowerCase();
                      if (typeVal === "cartoned" || typeVal === "yes") {
                        return <NumField control={form.control} name="cartonsPerCase" label="Cartons Per Case" step="1" />;
                      }
                      if (typeVal === "labeled" && (posVal === "top" || posVal === "bottom")) {
                        return <NumField control={form.control} name="labelsPerRoll" label="Labels Per Roll" step="1" />;
                      }
                      if (typeVal === "labeled" && posVal === "both") {
                        return (
                          <div className="grid grid-cols-2 gap-3">
                            <NumField control={form.control} name="topLabelsPerRoll" label="Top Labels Per Roll" step="1" />
                            <NumField control={form.control} name="bottomLabelsPerRoll" label="Bottom Labels Per Roll" step="1" />
                          </div>
                        );
                      }
                      return null;
                    })()}
                    <EditableChipList
                      label="Circles"
                      options={circles}
                      value={(v.circles as string) ?? ""}
                      onSelect={val => form.setValue("circles", val, { shouldDirty: true })}
                      onAdd={onAddCircle}
                      onRemove={onRemoveCircle}
                    />
                    <EditableChipList
                      label="Shipper"
                      options={shipperOptions}
                      value={(v.shipper as string) ?? ""}
                      onSelect={val => form.setValue("shipper", val, { shouldDirty: true })}
                      onAdd={onAddShipper}
                      onRemove={onRemoveShipper}
                    />
                    <EditableChipList
                      label="Skid Stacking"
                      options={skidStackingOptions}
                      value={(v.skidStacking as string) ?? ""}
                      onSelect={val => form.setValue("skidStacking", val, { shouldDirty: true })}
                      onAdd={onAddSkidStacking}
                      onRemove={onRemoveSkidStacking}
                    />
                    <EditableChipList
                      label="Grip Sheets"
                      options={gripSheetsOptions}
                      value={(v.gripSheets as string) ?? ""}
                      onSelect={val => form.setValue("gripSheets", val, { shouldDirty: true })}
                      onAdd={onAddGripSheets}
                      onRemove={onRemoveGripSheets}
                    />
                    <FixedChipSelect
                      label="Slip Sheets"
                      options={SLIP_SHEET_OPTIONS}
                      value={(v.slipSheets as string) ?? ""}
                      onSelect={val => form.setValue("slipSheets", val, { shouldDirty: true })}
                    />
                  </div>
                </details>

                <DoughRecipeCard
                  batchesNeeded={0}
                  fields={doughFields}
                  recipe={v.doughRecipe ?? []}
                  register={form.register}
                  targetWeight={Number(v.targetDoughballWeight ?? 0)}
                  doughBatchYield={Number(v.doughBatchYield)}
                  ingredientOptions={ingredientUniverse ?? doughIngredients}
                  onAddIngredient={onAddDoughIngredient}
                  onRemoveIngredient={onRemoveDoughIngredient}
                  onSetIngredient={(idx, val) => form.setValue(`doughRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                  onAppend={() => appendDough({ ingredient: "", lbs: 0 })}
                  onRemove={removeDough}
                  onTargetWeightChange={val => form.setValue("targetDoughballWeight", val, { shouldDirty: true })}
                  recipeName={v.doughRecipeName ?? ""}
                  recipeNameOptions={doughRecipeNameOptions}
                  onAddRecipeName={onAddDoughRecipeName}
                  onRemoveRecipeName={onRemoveDoughRecipeName}
                  onRecipeNameChange={val => {
                    form.setValue("doughRecipeName", val, { shouldDirty: true });
                    // Any recipe change invalidates a pending variant prompt —
                    // it is re-armed below only if the NEW pick is ambiguous.
                    setDoughVariantPick(null);
                    if (val.trim()) {
                      const key = val.trim().toLowerCase();
                      const rows = serverDoughRowsByName.get(key);
                      if (rows) { form.setValue("doughRecipe", rows.map(r => ({ ...r })), { shouldDirty: true }); replaceDough(rows.map(r => ({ ...r }))); }
                      // Variant-aware blank-fill (mirrors the run form): the
                      // family recipe's variant list wins over recipe-level
                      // numbers; auto-match by die size (or the only variant),
                      // else offer a manual pick below. Never overwrites a
                      // value already typed into the profile.
                      const variants = serverDoughVariantsByName.get(key) ?? [];
                      const matched = matchDoughballVariant(variants, { dieType: String(form.getValues("dieType") ?? "") });
                      const rec = doughRecipesList.find(r => r.enabled !== false && r.name.trim().toLowerCase() === key);
                      const ballOz = matched?.weightOz ?? rec?.doughballWeightOz ?? 0;
                      const weightBlank = !(Number(form.getValues("targetDoughballWeight") ?? 0) > 0);
                      if (ballOz > 0 && weightBlank) form.setValue("targetDoughballWeight", ballOz, { shouldDirty: true });
                      const perTray = matched?.perTray ?? rec?.doughballsPerTray ?? 0;
                      if (perTray > 0 && !(Number(form.getValues("doughballsPerTray") ?? 0) > 0)) form.setValue("doughballsPerTray", perTray, { shouldDirty: true });
                      if (!matched && variants.length > 1 && weightBlank) {
                        setDoughVariantPick({ recipeName: val.trim(), variants });
                      }
                    }
                  }}
                />
                {doughVariantPick && (
                  <div className="flex flex-col gap-1.5 -mt-3 px-1" data-testid="profile-dough-variant-pick">
                    <div className="flex items-center gap-2 text-xs text-amber-500">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span><span className="font-semibold">"{doughVariantPick.recipeName}"</span> — pick this profile's doughball variant:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {doughVariantPick.variants.length > 5 ? (
                        <select
                          className="h-8 w-full sm:max-w-xs px-2 rounded bg-muted/40 border border-amber-500/40 text-xs outline-none focus:border-primary/60"
                          defaultValue=""
                          data-testid="select-profile-dough-variant"
                          onChange={e => {
                            const variant = doughVariantPick.variants.find(x => x.label === e.target.value);
                            if (!variant) return;
                            // Blank-fill only — same invariant as the auto path.
                            if ((variant.weightOz ?? 0) > 0 && !(Number(form.getValues("targetDoughballWeight") ?? 0) > 0)) form.setValue("targetDoughballWeight", variant.weightOz!, { shouldDirty: true });
                            if ((variant.perTray ?? 0) > 0 && !(Number(form.getValues("doughballsPerTray") ?? 0) > 0)) form.setValue("doughballsPerTray", variant.perTray!, { shouldDirty: true });
                            setDoughVariantPick(null);
                          }}
                        >
                          <option value="" disabled>Pick a variant…</option>
                          {doughVariantPick.variants.map(variant => (
                            <option key={variant.label} value={variant.label}>
                              {variant.label}
                              {(variant.weightOz ?? 0) > 0 ? ` — ${variant.weightOz} oz` : ""}
                              {(variant.perTray ?? 0) > 0 ? ` / ${variant.perTray} per tray` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                      doughVariantPick.variants.map((variant) => (
                        <Button
                          key={variant.label}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          data-testid={`button-profile-dough-variant-${variant.label}`}
                          onClick={() => {
                            // Blank-fill only — same invariant as the auto path.
                            if ((variant.weightOz ?? 0) > 0 && !(Number(form.getValues("targetDoughballWeight") ?? 0) > 0)) form.setValue("targetDoughballWeight", variant.weightOz!, { shouldDirty: true });
                            if ((variant.perTray ?? 0) > 0 && !(Number(form.getValues("doughballsPerTray") ?? 0) > 0)) form.setValue("doughballsPerTray", variant.perTray!, { shouldDirty: true });
                            setDoughVariantPick(null);
                          }}
                        >
                          {variant.label}
                          {(variant.weightOz ?? 0) > 0 ? ` — ${variant.weightOz} oz` : ""}
                          {(variant.perTray ?? 0) > 0 ? ` / ${variant.perTray} per tray` : ""}
                        </Button>
                      ))
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-muted-foreground"
                        onClick={() => setDoughVariantPick(null)}
                        data-testid="button-profile-dough-variant-dismiss"
                      >
                        Not now
                      </Button>
                    </div>
                  </div>
                )}
                {(() => {
                  // Persistent variant switcher: when the picked dough family
                  // recipe carries several doughball variants, the wrong one
                  // may have been auto-applied (or picked by mistake). Unlike
                  // the blank-fill paths above, an EXPLICIT pick here
                  // overwrites the profile's doughball weight / per-tray.
                  if (doughVariantPick) return null;
                  const key = (v.doughRecipeName ?? "").trim().toLowerCase();
                  const variants = key ? (serverDoughVariantsByName.get(key) ?? []) : [];
                  if (variants.length < 2) return null;
                  return (
                    <div className="flex flex-col gap-1 -mt-3 px-1" data-testid="profile-dough-variant-switch">
                      <label className="text-[11px] text-muted-foreground">
                        Doughball variant (switch if the wrong one was used):
                      </label>
                      <select
                        className="h-8 w-full sm:max-w-xs px-2 rounded bg-muted/40 border border-border/60 text-xs outline-none focus:border-primary/60"
                        value=""
                        data-testid="select-profile-dough-variant-switch"
                        onChange={e => {
                          const variant = variants.find(x => x.label === e.target.value);
                          if (!variant) return;
                          // Explicit user pick — overwrite, not blank-fill.
                          // A variant field of 0 means "not recorded on the
                          // doughball chart" (0 = unset across the dough pool),
                          // so an unset variant field never clobbers a real
                          // value already in the profile.
                          if ((variant.weightOz ?? 0) > 0) form.setValue("targetDoughballWeight", variant.weightOz!, { shouldDirty: true });
                          if ((variant.perTray ?? 0) > 0) form.setValue("doughballsPerTray", variant.perTray!, { shouldDirty: true });
                          toast({ title: `Doughball variant "${variant.label}" applied` });
                        }}
                      >
                        <option value="" disabled>
                          {`Switch variant… (current: ${Number(v.targetDoughballWeight ?? 0) > 0 ? `${v.targetDoughballWeight} oz` : "not set"}${Number(v.doughballsPerTray ?? 0) > 0 ? ` / ${v.doughballsPerTray} per tray` : ""})`}
                        </option>
                        {variants.map(variant => (
                          <option key={variant.label} value={variant.label}>
                            {variant.label}
                            {(variant.weightOz ?? 0) > 0 ? ` — ${variant.weightOz} oz` : ""}
                            {(variant.perTray ?? 0) > 0 ? ` / ${variant.perTray} per tray` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })()}

                <Card className="bg-card/50 border-border/50 shadow-md">
                  <button type="button" onClick={() => setSauceWeightsOpen(o => !o)} className="w-full text-left">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                        Sauce & Applicator Weights
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${sauceWeightsOpen ? "rotate-180" : ""}`} />
                      </CardTitle>
                    </CardHeader>
                  </button>
                  {sauceWeightsOpen && (
                    <CardContent className="px-5 pb-5 space-y-4">
                      <TypeDropdown
                        label="Sauce"
                        value={v.frontlineRecipeName}
                        onChange={val => {
                          form.setValue("frontlineRecipeName", val, { shouldDirty: true });
                          if (!val) {
                            form.setValue("sauceOzPerPizza", 0, { shouldDirty: true });
                            form.setValue("sauceBarrelLbs", 0, { shouldDirty: true });
                          } else {
                            const rows = serverSauceRowsByName.get(val.trim().toLowerCase());
                            if (rows) { form.setValue("frontlineRecipe", rows, { shouldDirty: true }); replaceFrontline(rows); }
                          }
                        }}
                        options={frontlineRecipeNameOptions}
                        onAddOption={onAddFrontlineRecipeName}
                        onRemoveOption={onRemoveFrontlineRecipeName}
                        allowClear
                      />
                      {v.frontlineRecipeName.trim() && (() => {
                        const hasRecipe = (v.frontlineRecipe ?? []).some(r => Number(r.lbs) > 0);
                        return (
                          <div className={hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="sauceOzPerPizza" label="Oz Per Pizza" />
                            {!hasRecipe && <NumField control={form.control} name="sauceBarrelLbs" label="Barrel Weight (lbs)" />}
                          </div>
                        );
                      })()}
                      {v.frontlineRecipeName.trim() && (
                        <FrontlineRecipeCard
                          embedded
                          fields={frontlineFields}
                          recipe={v.frontlineRecipe ?? []}
                          register={form.register}
                          ingredientOptions={ingredientUniverse ?? frontlineIngredients}
                          onAddIngredient={onAddFrontlineIngredient}
                          onRemoveIngredient={onRemoveFrontlineIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`frontlineRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendFrontline({ ingredient: "", lbs: 0 })}
                          onRemove={removeFrontline}
                          recipeName={v.frontlineRecipeName ?? ""}
                          recipeNameOptions={frontlineRecipeNameOptions}
                          onAddRecipeName={onAddFrontlineRecipeName}
                          onRemoveRecipeName={onRemoveFrontlineRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("frontlineRecipeName", val, { shouldDirty: true });
                            if (val.trim()) {
                              const rows = serverSauceRowsByName.get(val.trim().toLowerCase());
                              if (rows) { form.setValue("frontlineRecipe", rows, { shouldDirty: true }); replaceFrontline(rows); }
                            }
                          }}
                        />
                      )}

                      {/* Physical line order: App 1, App 2, then the pep
                          applicators (they sit between stations 2 and 3 on the
                          line), then App 3, App 4. */}
                      {([1, 2] as ApplicatorNum[]).map(renderApplicator)}

                      <div className="border-t border-border/60" aria-hidden="true" />
                      <TypeDropdown
                        label={v.pep1Combined === true ? "Pep Applicator 1 & 2" : "Pep Applicator 1"}
                        value={v.pep1Type}
                        onChange={val => {
                          form.setValue("pep1Type", val, { shouldDirty: true });
                          if (!val) { form.setValue("pep1Sticks", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizza", 0, { shouldDirty: true }); }
                        }}
                        options={pepTypes}
                        onAddOption={onAddPepType}
                        onRemoveOption={onRemovePepType}
                        allowClear
                      />
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input type="checkbox" checked={v.pep1Combined === true} onChange={e => form.setValue("pep1Combined", e.target.checked, { shouldDirty: true })} className="accent-primary" />
                        <span>Run this pep through both applicators 1 &amp; 2 (doubles stick buffer)</span>
                      </label>
                      {(v.pep1Type ?? "").trim() && (
                        <>
                          <NumField control={form.control} name="pep1Sticks" label="Number of Sticks" />
                          <div className="grid grid-cols-2 gap-3">
                            <NumField control={form.control} name="pep1OzPerPizza" label="Oz Per Pizza" />
                            <NumField control={form.control} name="pep1BatchLbs" label="Batch Weight (lbs)" />
                          </div>
                        </>
                      )}

                      {(pep1ShowB || (v.pep1TypeB ?? "").trim()) ? (
                        <div className="rounded-md border border-border/50 p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">Additional Pep Type (Applicator 1)</span>
                            <button type="button" className="text-muted-foreground hover:text-foreground text-lg leading-none px-1" onClick={() => { setPep1ShowB(false); form.setValue("pep1TypeB", "", { shouldDirty: true }); form.setValue("pep1SticksB", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizzaB", 0, { shouldDirty: true }); form.setValue("pep1BatchLbsB", 0, { shouldDirty: true }); }}>×</button>
                          </div>
                          <TypeDropdown
                            label="Pep Type"
                            value={v.pep1TypeB ?? ""}
                            onChange={val => { form.setValue("pep1TypeB", val, { shouldDirty: true }); if (!val) { form.setValue("pep1SticksB", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizzaB", 0, { shouldDirty: true }); } }}
                            options={pepTypes}
                            onAddOption={onAddPepType}
                            onRemoveOption={onRemovePepType}
                            allowClear
                          />
                          {(v.pep1TypeB ?? "").trim() && (
                            <>
                              <NumField control={form.control} name="pep1SticksB" label="Number of Sticks" />
                              <div className="grid grid-cols-2 gap-3">
                                <NumField control={form.control} name="pep1OzPerPizzaB" label="Oz Per Pizza" />
                                <NumField control={form.control} name="pep1BatchLbsB" label="Batch Weight (lbs)" />
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <button type="button" className="text-sm text-primary hover:underline self-start" onClick={() => setPep1ShowB(true)}>+ Add pep type</button>
                      )}

                      {v.pep1Combined !== true && (
                        <>
                          <div className="border-t border-border/60" aria-hidden="true" />
                          <TypeDropdown
                            label="Pep Applicator 2"
                            value={v.pep2Type}
                            onChange={val => { form.setValue("pep2Type", val, { shouldDirty: true }); if (!val) { form.setValue("pep2Sticks", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizza", 0, { shouldDirty: true }); } }}
                            options={pepTypes}
                            onAddOption={onAddPepType}
                            onRemoveOption={onRemovePepType}
                            allowClear
                          />
                          {(v.pep2Type ?? "").trim() && (
                            <>
                              <NumField control={form.control} name="pep2Sticks" label="Number of Sticks" />
                              <div className="grid grid-cols-2 gap-3">
                                <NumField control={form.control} name="pep2OzPerPizza" label="Oz Per Pizza" />
                                <NumField control={form.control} name="pep2BatchLbs" label="Batch Weight (lbs)" />
                              </div>
                            </>
                          )}

                          {(pep2ShowB || (v.pep2TypeB ?? "").trim()) ? (
                            <div className="rounded-md border border-border/50 p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-muted-foreground">Additional Pep Type (Applicator 2)</span>
                                <button type="button" className="text-muted-foreground hover:text-foreground text-lg leading-none px-1" onClick={() => { setPep2ShowB(false); form.setValue("pep2TypeB", "", { shouldDirty: true }); form.setValue("pep2SticksB", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizzaB", 0, { shouldDirty: true }); form.setValue("pep2BatchLbsB", 0, { shouldDirty: true }); }}>×</button>
                              </div>
                              <TypeDropdown
                                label="Pep Type"
                                value={v.pep2TypeB ?? ""}
                                onChange={val => { form.setValue("pep2TypeB", val, { shouldDirty: true }); if (!val) { form.setValue("pep2SticksB", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizzaB", 0, { shouldDirty: true }); } }}
                                options={pepTypes}
                                onAddOption={onAddPepType}
                                onRemoveOption={onRemovePepType}
                                allowClear
                              />
                              {(v.pep2TypeB ?? "").trim() && (
                                <>
                                  <NumField control={form.control} name="pep2SticksB" label="Number of Sticks" />
                                  <div className="grid grid-cols-2 gap-3">
                                    <NumField control={form.control} name="pep2OzPerPizzaB" label="Oz Per Pizza" />
                                    <NumField control={form.control} name="pep2BatchLbsB" label="Batch Weight (lbs)" />
                                  </div>
                                </>
                              )}
                            </div>
                          ) : (
                            <button type="button" className="text-sm text-primary hover:underline self-start" onClick={() => setPep2ShowB(true)}>+ Add pep type</button>
                          )}
                        </>
                      )}

                      {([3, 4] as ApplicatorNum[]).map(renderApplicator)}
                    </CardContent>
                  )}
                </Card>
              </>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                <X className="w-4 h-4 mr-1.5" /> Close
              </Button>
              <Button type="button" onClick={handleSave} disabled={!brand.trim() || !flavor.trim()}>
                <Save className="w-4 h-4 mr-1.5" /> Save Setup
              </Button>
            </div>
          </div>
        )}
        </Form>
        </div>
      </div>
    </div>
  );
}
