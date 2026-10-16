import { useId, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import {
  applyRecipeSubstitutions,
} from "@workspace/inventory-math";
import {
  cheesePerFlavorComponentOz,
  type CheeseComponent,
} from "@workspace/cheese-recipes";
import type { IngredientSubstitution, RecipeRow } from "../types";
import {
  computeCheesePerPizzaOz,
  computeCheesePull,
  fmtNum,
} from "../utils";
import { useAutomaticUpdateReloadBlocker } from "../updateReloadSafety";
import { IngredientSelect } from "./SetupPickerControls";
import { TouchSelect } from "./TouchOptionPicker";
import { RecipeShareButtons } from "./RecipeShareButtons";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Separator } from "./ui/separator";

export function CheesePickCard({
  label,
  batches,
  ozPerPizza,
  recipe,
  substitutions,
  recipeName,
  recipeNameOptions,
  shredderSetting,
  cellulose,
  onRecipeNameChange,
  embedded,
  recipeMissing,
  poolComponents,
  optionLabels,
  recipePickerLabel,
  recipePickerTestId,
}: {
  label: string;
  batches: number;
  ozPerPizza: number;
  substitutions?: IngredientSubstitution[];
  recipe: RecipeRow[];
  poolComponents?: CheeseComponent[];
  recipeName: string;
  recipeNameOptions: string[];
  shredderSetting: string;
  cellulose: string;
  onRecipeNameChange: (v: string) => void;
  embedded?: boolean;
  recipeMissing?: boolean;
  optionLabels?: ReadonlyMap<string, string>;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const updateReloadBlockerId = useId();
  const effectiveRecipe = applyRecipeSubstitutions(recipe, substitutions);
  const displayRecipe = effectiveRecipe.rows;
  const totalLbsPerBatch = displayRecipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const pull = computeCheesePull(displayRecipe, batches);
  const namedPool = (poolComponents ?? []).filter(c => c.ingredient.trim());
  const perPizzaOz =
    !effectiveRecipe.changed && namedPool.length > 0 && namedPool.length === displayRecipe.length
      ? cheesePerFlavorComponentOz(namedPool, ozPerPizza)
      : computeCheesePerPizzaOz(displayRecipe, ozPerPizza);
  const options =
    recipeName.trim() && !recipeNameOptions.includes(recipeName)
      ? [recipeName, ...recipeNameOptions]
      : recipeNameOptions;

  const recipeSelector = (
    <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
      <TouchSelect
        value={recipeName}
        onChange={e => onRecipeNameChange(e.target.value)}
        aria-label={recipePickerLabel ?? "Pick a cheese recipe"}
        title={recipePickerLabel ?? "Pick a cheese recipe"}
        data-testid={recipePickerTestId}
        className="h-8 w-full px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm outline-none focus:border-primary/60"
      >
        <option value="">Pick a cheese recipe…</option>
        {options.map(name => (
          <option key={name} value={name}>{optionLabels?.get(name) ?? name}</option>
        ))}
      </TouchSelect>
    </div>
  );

  const showMissingWarning = recipeName.trim() !== "" && !!recipeMissing;
  useAutomaticUpdateReloadBlocker(
    `missing-cheese-recipe-${updateReloadBlockerId}`,
    showMissingWarning,
  );
  const body = (
    <>
      {effectiveRecipe.changed && (
        <div
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          data-testid="temporary-cheese-recipe-overlay"
        >
          Today&apos;s temporary substitution is reflected below. The saved cheese recipe is unchanged.
        </div>
      )}
      {showMissingWarning && (
        <div className="flex items-start gap-2 mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold text-amber-200">“{recipeName.trim()}”</span> isn&apos;t in Cheese Recipes — pick a blend above, or a manager can add it in Manage Lists.
          </span>
        </div>
      )}
      {(shredderSetting.trim() || cellulose.trim()) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground">
          {shredderSetting.trim() && (
            <span>Shredder setting: <span className="font-mono text-foreground">{shredderSetting}</span></span>
          )}
          {cellulose.trim() && (
            <span>Cellulose: <span className="font-mono text-foreground">{cellulose}</span></span>
          )}
        </div>
      )}
      {displayRecipe.length === 0 ? (
        showMissingWarning ? null : (
          <p className="text-xs text-muted-foreground mb-1">
            {recipeName.trim()
              ? "This cheese recipe has no ingredients yet. A manager can edit it under Manage Lists → Cheese Recipes."
              : "Pick a cheese recipe above to load its ingredients. Managers add recipes under Manage Lists → Cheese Recipes."}
          </p>
        )
      ) : (
        <div className="w-full mb-1">
          <div className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] gap-x-1 sm:grid-cols-[1fr_88px_88px_88px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Oz<span className="hidden sm:inline"> / Pizza</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Pull<span className="hidden sm:inline"> / Run</span></span>
          </div>
          <div className="space-y-1.5">
            {displayRecipe.map((row, idx) => {
              const rowLbs = Number(row.lbs ?? 0);
              return (
                <div key={idx} className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] gap-x-1 sm:grid-cols-[1fr_88px_88px_88px] sm:gap-x-2 items-center">
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm flex items-center truncate text-foreground/90">{row.ingredient || "—"}</div>
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(perPizzaOz.rows[idx] ?? 0, 2)}</div>
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(rowLbs, 1)}</div>
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(pull.rows[idx].lbs, 1)}</div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] gap-x-1 sm:grid-cols-[1fr_88px_88px_88px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(perPizzaOz.totalOz, 2)} oz</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(totalLbsPerBatch, 1)} lbs</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(pull.totalLbs, 1)} lbs</span>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend</span>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
          <RecipeShareButtons recipe={{ title: `${label} — Cheese Blend`, name: recipeName, unit: "lbs/batch", rows: displayRecipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-amber-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend Recipe</CardTitle>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
          <RecipeShareButtons recipe={{ title: `${label} — Cheese Blend`, name: recipeName, unit: "lbs/batch", rows: displayRecipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

export function MixRecipeCard({
  label,
  totalRunLbs,
  fields,
  recipe,
  fieldPrefix,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  embedded,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  recipeNameLabels,
  recipePickerLabel,
  recipePickerTestId,
}: {
  label: string;
  totalRunLbs: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  fieldPrefix: string;
  register: any;
  ingredientOptions: string[];
  onAddIngredient?: (v: string) => void;
  onRemoveIngredient?: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  embedded?: boolean;
  recipeName?: string;
  recipeNameOptions?: string[];
  onAddRecipeName?: (v: string) => void;
  onRemoveRecipeName?: (v: string) => void;
  onRecipeNameChange?: (v: string) => void;
  recipeNameLabels?: ReadonlyMap<string, string>;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const rowTotal = (rowLbs: number) =>
    totalLbsPerBatch > 0 ? (rowLbs / totalLbsPerBatch) * totalRunLbs : 0;

  const body = (
    <>
      {recipeNameOptions && onRecipeNameChange && (
        <div className="w-full sm:max-w-xs mb-3">
          <IngredientSelect
            value={recipeName ?? ""}
            onChange={onRecipeNameChange}
            options={recipeNameOptions}
            onAddOption={onAddRecipeName}
            onRemoveOption={onRemoveRecipeName}
            placeholder="Recipe name…"
            optionLabels={recipeNameLabels}
            ariaLabel={recipePickerLabel}
            testId={recipePickerTestId}
          />
        </div>
      )}
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">No ingredients yet. Add rows to build the mix.</p>
      ) : (
        <div className="w-full mb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_32px] gap-x-1 sm:grid-cols-[1fr_110px_110px_32px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Oz<span className="hidden sm:inline"> / Pizza</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Total Lbs</span>
            <span />
          </div>
          <div className="space-y-1.5">
            {fields.map((field, idx) => {
              const rowLbs = Number(recipe[idx]?.lbs ?? 0);
              return (
                <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_76px_76px_auto] sm:grid-cols-[1fr_110px_110px_auto]" : "grid-cols-[minmax(0,1fr)_76px_76px_32px] sm:grid-cols-[1fr_110px_110px_32px]"}`}>
                  <IngredientSelect value={recipe[idx]?.ingredient ?? ""} onChange={val => onSetIngredient(idx, val)} options={ingredientOptions} onAddOption={onAddIngredient} onRemoveOption={onRemoveIngredient} />
                  <input {...register(`${fieldPrefix}.${idx}.lbs`, { valueAsNumber: true })} type="number" min="0" step="0.1" placeholder="0" onFocus={e => e.target.select()} className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full" />
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(rowTotal(rowLbs), 1)}</div>
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmIdx(idx)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_32px] gap-x-1 sm:grid-cols-[1fr_110px_110px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(totalLbsPerBatch, 2)} oz</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(totalRunLbs, 1)} lbs</span>
            <span />
          </div>
        </div>
      )}
      <button type="button" onClick={onAppend} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add Ingredient
      </button>
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label} — Mix Recipe</span>
          <span className="text-xs text-muted-foreground"><span className="font-mono text-foreground">{fmtNum(totalRunLbs, 1)}</span> lbs needed</span>
          <RecipeShareButtons recipe={{ title: `${label} — Mix Recipe`, name: recipeName, unit: "oz/pizza", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-purple-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label} — Mix Recipe</CardTitle>
          <span className="text-xs text-muted-foreground"><span className="font-mono text-foreground">{fmtNum(totalRunLbs, 1)}</span> lbs needed</span>
          <RecipeShareButtons recipe={{ title: `${label} — Mix Recipe`, name: recipeName, unit: "oz/pizza", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

export function DoughRecipeCard({
  batchesNeeded,
  fields,
  recipe,
  register,
  targetWeight,
  doughBatchYield,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  onTargetWeightChange,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  recipePickerLabel,
  recipePickerTestId,
}: {
  batchesNeeded: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  register: any;
  targetWeight: number;
  doughBatchYield: number;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  onTargetWeightChange: (v: number) => void;
  recipeName: string;
  recipeNameOptions: string[];
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const recipeYield = targetWeight > 0 ? (totalLbsPerBatch * 16) / targetWeight : 0;
  const runYield = Number(doughBatchYield);
  const yieldDiff = runYield - recipeYield;

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-orange-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Dough Recipe</CardTitle>
          <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
            <IngredientSelect value={recipeName} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName} onRemoveOption={onRemoveRecipeName} placeholder="Recipe name…" ariaLabel={recipePickerLabel} testId={recipePickerTestId} />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            <span className="font-mono text-foreground">{batchesNeeded > 0 ? fmtNum(batchesNeeded, 2) : "—"}</span> batches needed
          </span>
          <RecipeShareButtons recipe={{ title: "Dough Recipe", name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className={`grid grid-cols-1 gap-3 mb-4 ${runYield > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div className="p-3 rounded-lg bg-muted/30">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Target Weight (oz)</label>
            <input type="number" min="0" step="0.01" value={targetWeight || ""} onChange={e => onTargetWeightChange(Number(e.target.value))} onFocus={e => e.target.select()} placeholder="0.00" className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 w-full" />
          </div>
          <div className="p-3 rounded-lg bg-muted/30 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recipe Yield</p>
            <p className="text-xl font-mono font-bold text-foreground">{recipeYield > 0 ? fmtNum(recipeYield, 1) : "—"}</p>
            <p className="text-[10px] text-muted-foreground">doughballs / batch</p>
          </div>
          {runYield > 0 && (
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Run Yield</p>
              <p className={`text-xl font-mono font-bold ${recipeYield > 0 ? Math.abs(yieldDiff) < 0.5 ? "text-green-400" : yieldDiff < 0 ? "text-red-400" : "text-amber-400" : "text-foreground"}`}>
                {fmtNum(runYield, 1)}
              </p>
              {recipeYield > 0 && <p className="text-[10px] text-muted-foreground font-mono">{yieldDiff > 0 ? "+" : ""}{fmtNum(yieldDiff, 1)} vs recipe</p>}
            </div>
          )}
        </div>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">No ingredients yet. Add rows to build the recipe.</p>
        ) : (
          <div className="w-full mb-3">
            <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
              <span />
            </div>
            <div className="space-y-1.5">
              {fields.map((field, idx) => (
                <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_88px_auto] sm:grid-cols-[1fr_120px_auto]" : "grid-cols-[minmax(0,1fr)_88px_32px] sm:grid-cols-[1fr_120px_32px]"}`}>
                  <IngredientSelect value={recipe[idx]?.ingredient ?? ""} onChange={val => onSetIngredient(idx, val)} options={ingredientOptions} onAddOption={onAddIngredient} onRemoveOption={onRemoveIngredient} />
                  <input {...register(`doughRecipe.${idx}.lbs`, { valueAsNumber: true })} type="number" min="0" step="0.1" placeholder="0" onFocus={e => e.target.select()} className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full" />
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmIdx(idx)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
              <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(totalLbsPerBatch, 1)} lbs</span>
              <span />
            </div>
          </div>
        )}
        <button type="button" onClick={onAppend} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Ingredient
        </button>
      </CardContent>
    </Card>
  );
}

export function FrontlineRecipeCard({
  fields,
  recipe,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  embedded,
  recipePickerLabel,
  recipePickerTestId,
}: {
  fields: { id: string }[];
  recipe: RecipeRow[];
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  recipeName: string;
  recipeNameOptions: string[];
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
  embedded?: boolean;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const recipeSelector = (
    <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
      <IngredientSelect value={recipeName} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName} onRemoveOption={onRemoveRecipeName} placeholder="Recipe name…" ariaLabel={recipePickerLabel} testId={recipePickerTestId} />
    </div>
  );
  const body = (
    <>
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">No ingredients yet. Add rows to build the recipe.</p>
      ) : (
        <div className="w-full mb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
            <span />
          </div>
          <div className="space-y-1.5">
            {fields.map((field, idx) => (
              <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_88px_auto] sm:grid-cols-[1fr_120px_auto]" : "grid-cols-[minmax(0,1fr)_88px_32px] sm:grid-cols-[1fr_120px_32px]"}`}>
                <IngredientSelect value={recipe[idx]?.ingredient ?? ""} onChange={val => onSetIngredient(idx, val)} options={ingredientOptions} onAddOption={onAddIngredient} onRemoveOption={onRemoveIngredient} />
                <input {...register(`frontlineRecipe.${idx}.lbs`, { valueAsNumber: true })} type="number" min="0" step="0.1" placeholder="0" onFocus={e => e.target.select()} className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full" />
                {confirmIdx === idx ? (
                  <div className="flex items-center gap-1">
                    <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                    <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmIdx(idx)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(totalLbsPerBatch, 1)} lbs</span>
            <span />
          </div>
        </div>
      )}
      <button type="button" onClick={onAppend} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add Ingredient
      </button>
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Sauce Recipe</span>
          {recipeSelector}
          <RecipeShareButtons recipe={{ title: "Sauce Recipe", name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-red-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Sauce Recipe</CardTitle>
          {recipeSelector}
          <RecipeShareButtons recipe={{ title: "Sauce Recipe", name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}
