import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  formSchema,
  type FormValues,
  type RecipeRow,
  DEFAULT_VALUES,
  PACKAGING_FIELDS,
} from "../types";
import { loadProfile, saveProfile } from "../storage";
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
import { ChevronDown, Settings, Package, Save, X } from "lucide-react";

type ApplicatorNum = 1 | 2 | 3 | 4;

const APPLICATOR_LABELS: Record<ApplicatorNum, string> = {
  1: "Applicator 1",
  2: "Applicator 2",
  3: "Applicator 3",
  4: "Applicator 4",
};

export interface SetupProfileEditorProps {
  open: boolean;
  onClose: () => void;
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
  onRemoveDieType: (name: string) => void;
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
  onRemoveDieType,
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
}: SetupProfileEditorProps) {
  const [brand, setBrand] = useState(initialBrand ?? "");
  const [flavor, setFlavor] = useState(initialFlavor ?? "");
  const [lineType, setLineType] = useState<"dough" | "crusts">("dough");
  const [sauceWeightsOpen, setSauceWeightsOpen] = useState(true);
  const [pep1ShowB, setPep1ShowB] = useState(false);
  const [pep2ShowB, setPep2ShowB] = useState(false);

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
  }

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
            recipeMissing={((v[nameKey] as string) ?? "").trim() !== "" && !serverCheeseByName.has(((v[nameKey] as string) ?? "").trim().toLowerCase())}
            shredderSetting={serverCheeseByName.get(((v[nameKey] as string) ?? "").trim().toLowerCase())?.shredderSetting ?? ""}
            cellulose={serverCheeseByName.get(((v[nameKey] as string) ?? "").trim().toLowerCase())?.cellulose ?? ""}
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
            ingredientOptions={serverMixIngredients}
            onSetIngredient={(idx, val) => form.setValue(`${recipeKey}.${idx}.ingredient`, val, { shouldDirty: true })}
            onAppend={() => appendCheeseByApp[app]({ ingredient: "", lbs: 0 })}
            onRemove={removeCheeseByApp[app]}
            recipeName={(v[nameKey] as string) ?? ""}
            recipeNameOptions={serverMixNames}
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
                        <button type="button" onClick={() => setLineType("crusts")} className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${lineType === "crusts" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Crust</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Die Type</label>
                      <div className="flex flex-wrap gap-1.5">
                        {dieTypes.map(dt => (
                          <button
                            key={dt}
                            type="button"
                            onClick={() => form.setValue("dieType", v.dieType === dt ? "" : dt, { shouldDirty: true })}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${v.dieType === dt ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"}`}
                          >
                            {dt}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => { const name = window.prompt("New die type name?"); if (name?.trim()) onAddDieType(name.trim()); }}
                          className="px-2 py-1 rounded-md text-xs border border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
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
                    {PACKAGING_FIELDS.map(f => {
                      const cur = (v[f.name] as string) ?? "";
                      return (
                        <div key={f.name}>
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{f.label}</label>
                          <div className="flex flex-wrap gap-1.5">
                            {f.options.map(opt => {
                              const active = cur === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => form.setValue(f.name, active ? "" : opt, { shouldDirty: true })}
                                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border capitalize transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"}`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <NumField control={form.control} name="cartonsPerCase" label="Cartons Per Case" step="1" />
                  </div>
                </details>

                <DoughRecipeCard
                  batchesNeeded={0}
                  fields={doughFields}
                  recipe={v.doughRecipe ?? []}
                  register={form.register}
                  targetWeight={Number(v.targetDoughballWeight ?? 0)}
                  doughBatchYield={Number(v.doughBatchYield)}
                  ingredientOptions={doughIngredients}
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
                    if (val.trim()) {
                      const rows = serverDoughRowsByName.get(val.trim().toLowerCase());
                      if (rows) { form.setValue("doughRecipe", rows, { shouldDirty: true }); replaceDough(rows); }
                    }
                  }}
                />

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
                          ingredientOptions={frontlineIngredients}
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

                      {([1, 2, 3, 4] as ApplicatorNum[]).map(renderApplicator)}

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
