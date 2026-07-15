import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  Plus,
  Trash2,
  Layers,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
import {
  normalizeCheeseRecipe,
  cheeseRecipeMatchesQuery,
  groupCheeseRecipesByBrand,
  renameCheeseRecipesBrand,
  cheeseComponentShares,
  cheesePerFlavorComponentOz,
  type CheeseRecipe,
  type CheeseComponent,
} from "@workspace/cheese-recipes";
import { useCheeseRecipes } from "../hooks/useCheeseRecipes";
import { saveCheeseRecipes, deleteCheeseRecipes } from "../cheeseRecipes";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { BrandRenamePanel } from "@/components/BrandRenamePanel";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankCheeseRecipe(): CheeseRecipe {
  return {
    id: genId(),
    name: "",
    brand: "",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
  };
}

// Manager-only editor for factory-wide cheese recipes. A cheese recipe is a
// named cheese blend a customer uses on the line — the customer (brand), the
// product flavors it is assigned to, the cheese-shredder setting, an optional
// cellulose note, notes, and a list of components (each ingredient and its
// per-BATCH pounds). Cheese recipes are persisted server-side (shared across all
// signed-in users) and feed the run applicator "Cheese" cards, which pick one
// and hydrate their rows from it. This works exactly like Mixes but is a
// SEPARATE pool (cheese is not routed into Mixes). The server enforces the
// manager role on writes; this card is only rendered for managers.
export type CheeseFlavorTarget = { flavor: string; oz: number };

export default function CheeseRecipesManager({
  brands = [],
  brandFlavors = {},
  ingredientSuggestions = [],
  getFlavorTargets,
}: {
  brands?: string[];
  brandFlavors?: Record<string, string[]>;
  ingredientSuggestions?: string[];
  // Per-flavor cheese applicator target weights (oz/pizza) for the flavors a
  // recipe covers, read from the saved brand/flavor profiles. Drives the
  // "oz per pizza by flavor" preview; optional so the editor still works
  // standalone (no preview shown).
  getFlavorTargets?: (recipe: CheeseRecipe) => CheeseFlavorTarget[];
}) {
  const qc = useQueryClient();
  const { items, isLoading } = useCheeseRecipes();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openBrands, setOpenBrands] = useState<Set<string>>(new Set());
  const [openRecipes, setOpenRecipes] = useState<Set<string>>(new Set());
  // Customer group (lowercased key) whose rename/merge panel is open, if any.
  const [renamingBrand, setRenamingBrand] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const groups = useMemo(() => {
    const filtered = items.filter((r) => cheeseRecipeMatchesQuery(r, query));
    return groupCheeseRecipesByBrand(filtered);
  }, [items, query]);
  // All customer names in the FULL pool (ignoring the search filter), so the
  // rename panel can offer every possible merge target.
  const allBrands = useMemo(
    () => groupCheeseRecipesByBrand(items).map((g) => g.brand).filter(Boolean),
    [items],
  );

  function toggleBrand(key: string) {
    setOpenBrands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRecipe(id: string) {
    setOpenRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: (next: CheeseRecipe[]) => saveCheeseRecipes(next),
    onSuccess: (saved) => {
      qc.setQueryData(["cheeseRecipes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the cheese recipe. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteCheeseRecipes(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["cheeseRecipes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the cheese recipe. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  // Rename a whole customer group (or merge it into another group when the
  // new name matches an existing customer — grouping is case-insensitive).
  // Rewrites only the changed rows through the normal save path.
  function renameBrandGroup(fromBrand: string, toBrand: string) {
    const changed = renameCheeseRecipesBrand(items, fromBrand, toBrand);
    setRenamingBrand(null);
    if (changed.length === 0) return;
    // Keep the group open under its new key so the result stays visible.
    setOpenBrands((prev) => {
      const next = new Set(prev);
      next.delete(fromBrand.trim().toLowerCase());
      next.add(toBrand.trim().toLowerCase());
      return next;
    });
    saveMutation.mutate(changed);
  }

  function addRecipe() {
    const draft = blankCheeseRecipe();
    draft.name = "New Cheese Recipe";
    setQuery("");
    setOpenBrands((prev) => new Set(prev).add(""));
    setOpenRecipes((prev) => new Set(prev).add(draft.id));
    saveMutation.mutate([draft]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="w-4 h-4" />
          Cheese Recipes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Define each customer's cheese blend once. Set the{" "}
          <span className="font-semibold">customer (brand)</span>, the{" "}
          <span className="font-semibold">flavors</span> it's used on, the{" "}
          <span className="font-semibold">shredder setting</span>, and the
          ingredients with their <span className="font-semibold">pounds per batch</span>.
          The run "Cheese" cards pick one of these and fill in the rows
          automatically.
        </p>

        {error && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border bg-red-950/40 border-red-700/40 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading cheese recipes…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No cheese recipes yet. Add one below or import a Cheese Mix Recipe
            Specs workbook.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cheese recipes by name, customer, or flavor…"
                className="w-full rounded-md border border-input bg-background pl-7 pr-2 py-1.5 text-xs"
              />
            </div>

            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No cheese recipes match "{query.trim()}".
              </p>
            ) : (
              groups.map((group) => {
                const key = group.brand.toLowerCase();
                const open =
                  searching || groups.length === 1 || openBrands.has(key);
                return (
                  <div
                    key={key || "(none)"}
                    className="rounded-md border border-border/60 overflow-hidden"
                  >
                    <div className="flex items-stretch bg-muted/40">
                      <button
                        type="button"
                        onClick={() => toggleBrand(key)}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 hover:bg-muted/60 text-left"
                      >
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-xs font-semibold flex-1 truncate">
                          {group.brand || "No customer"}
                        </span>
                        {group.shredderSetting && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            Shredder {group.shredderSetting}
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                          {group.recipes.length}
                        </span>
                      </button>
                      {group.brand && (
                        <button
                          type="button"
                          onClick={() =>
                            setRenamingBrand((prev) =>
                              prev === key ? null : key,
                            )
                          }
                          disabled={busy}
                          title="Rename or merge this customer"
                          className="px-2.5 flex items-center text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {renamingBrand === key && group.brand && (
                      <BrandRenamePanel
                        brand={group.brand}
                        nounLabel="customer (brand)"
                        itemCount={group.recipes.length}
                        itemNoun="cheese recipe"
                        otherBrands={allBrands.filter(
                          (b) => b.toLowerCase() !== key,
                        )}
                        disabled={busy}
                        onSave={(newName) => renameBrandGroup(group.brand, newName)}
                        onCancel={() => setRenamingBrand(null)}
                      />
                    )}
                    {open && (
                      <div className="flex flex-col gap-1.5 p-1.5 border-t border-border/40">
                        {group.recipes.map((recipe) => {
                          const expanded = openRecipes.has(recipe.id);
                          return (
                            <div key={recipe.id} className="flex flex-col gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleRecipe(recipe.id)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left border ${
                                  expanded
                                    ? "border-primary/50 bg-primary/10"
                                    : "border-transparent hover:bg-muted/40"
                                }`}
                              >
                                {expanded ? (
                                  <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                )}
                                <span className="text-xs font-medium truncate">
                                  {recipe.name || "Unnamed recipe"}
                                </span>
                                {recipe.flavors.length > 0 && (
                                  <span className="text-[11px] text-muted-foreground truncate">
                                    {recipe.flavors.join(", ")}
                                  </span>
                                )}
                                <span className="flex-1" />
                                {!recipe.enabled && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    Off
                                  </span>
                                )}
                                {recipe.components.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                    {recipe.components.length} ing
                                  </span>
                                )}
                              </button>
                              {expanded && (
                                <CheeseRecipeEditor
                                  recipe={recipe}
                                  disabled={busy}
                                  brands={brands}
                                  brandFlavors={brandFlavors}
                                  ingredientSuggestions={ingredientSuggestions}
                                  getFlavorTargets={getFlavorTargets}
                                  onChange={(next) => saveMutation.mutate([next])}
                                  onDelete={() => deleteMutation.mutate([recipe.id])}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="pt-1 border-t border-border/40">
          <button
            type="button"
            onClick={addRecipe}
            disabled={busy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Cheese Recipe
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function CheeseRecipeEditor({
  recipe,
  disabled,
  brands,
  brandFlavors,
  ingredientSuggestions,
  getFlavorTargets,
  onChange,
  onDelete,
}: {
  recipe: CheeseRecipe;
  disabled: boolean;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  ingredientSuggestions: string[];
  getFlavorTargets?: (recipe: CheeseRecipe) => CheeseFlavorTarget[];
  onChange: (recipe: CheeseRecipe) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<CheeseRecipe>(recipe);
  // Flavors edit as a comma-separated string so managers can type freely; it's
  // split back into the flavors[] on commit.
  const [flavorsText, setFlavorsText] = useState<string>(recipe.flavors.join(", "));

  const signature = JSON.stringify(recipe);
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(recipe);
    setFlavorsText(recipe.flavors.join(", "));
  }

  function patch(p: Partial<CheeseRecipe>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: CheeseRecipe = draft) {
    const flavors = flavorsText
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const clean = normalizeCheeseRecipe({ ...next, flavors });
    if (clean) onChange({ ...clean, id: next.id, scope: next.scope });
  }

  function patchComponent(idx: number, p: Partial<CheeseComponent>) {
    setDraft((d) => {
      const components = d.components.map((c, i) =>
        i === idx ? { ...c, ...p } : c,
      );
      return { ...d, components };
    });
  }

  function addComponent() {
    setDraft((d) => ({
      ...d,
      components: [...d.components, { ingredient: "", lbs: 0, ozPerPizza: 0 }],
    }));
  }

  function removeComponent(idx: number) {
    const next = {
      ...draft,
      components: draft.components.filter((_, i) => i !== idx),
    };
    setDraft(next);
    commit(next);
  }

  const flavorOptions = brandFlavors[draft.brand] ?? [];
  const totalLbs = draft.components.reduce((s, c) => s + (Number(c.lbs) || 0), 0);
  // Each ingredient's share of the blend (fractions summing to 1) — explicit
  // sharePct first, then ozPerPizza proportions, then lbs proportions. Drives
  // the Share % column's derived placeholder and the per-flavor preview.
  const shares = useMemo(() => cheeseComponentShares(draft.components), [draft.components]);

  // Per-flavor cheese target weights from the saved profiles (via the
  // getFlavorTargets prop wired by the page): each covered flavor's cheese
  // applicator Oz/Pizza. The per-ingredient oz/pizza shown in the preview is
  // that target split by each ingredient's blend share — the same math the run
  // "Cheese" cards use (cheesePerFlavorComponentOz), so what the manager
  // previews here is exactly what operators see on a run.
  const flavorTargets = getFlavorTargets ? getFlavorTargets(draft) : [];

  const flavorPreview = useMemo(
    () =>
      flavorTargets.map((ft) => ({
        flavor: ft.flavor,
        targetOz: ft.oz,
        rows: cheesePerFlavorComponentOz(draft.components, ft.oz).rows,
      })),
    [draft.components, flavorTargets],
  );

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
      {/* Name + enabled + delete */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          onBlur={() => commit()}
          disabled={disabled}
          placeholder="Cheese recipe name…"
          className="flex-1 min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-semibold"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => {
              const next = { ...draft, enabled: e.target.checked };
              setDraft(next);
              commit(next);
            }}
            disabled={disabled}
          />
          On
        </label>
        <ConfirmDeleteButton
          onConfirm={onDelete}
          title="Delete this cheese recipe?"
          description="This removes the cheese recipe for everyone. This can't be undone."
        >
          <button
            type="button"
            disabled={disabled}
            title="Delete cheese recipe"
            className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </ConfirmDeleteButton>
      </div>

      {/* Customer (brand) + shredder setting */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer (brand)</span>
          <input
            type="text"
            list={`cheese-brands-${draft.id}`}
            value={draft.brand}
            onChange={(e) => patch({ brand: e.target.value })}
            onBlur={() => commit()}
            disabled={disabled}
            placeholder="Any customer"
            className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <datalist id={`cheese-brands-${draft.id}`}>
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Shredder setting</span>
          <input
            type="text"
            value={draft.shredderSetting}
            onChange={(e) => patch({ shredderSetting: e.target.value })}
            onBlur={() => commit()}
            disabled={disabled}
            placeholder="e.g. 3"
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cellulose</span>
          <input
            type="text"
            value={draft.cellulose}
            onChange={(e) => patch({ cellulose: e.target.value })}
            onBlur={() => commit()}
            disabled={disabled}
            placeholder="optional"
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
        </div>
      </div>

      {/* Flavors assigned */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Flavors (comma separated — blank = all varieties)
        </span>
        <input
          type="text"
          list={`cheese-flavors-${draft.id}`}
          value={flavorsText}
          onChange={(e) => setFlavorsText(e.target.value)}
          onBlur={() => commit()}
          disabled={disabled}
          placeholder="Pepperoni, Cheese, …"
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
        <datalist id={`cheese-flavors-${draft.id}`}>
          {flavorOptions.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>

      {/* Notes */}
      <input
        type="text"
        value={draft.notes ?? ""}
        onChange={(e) => patch({ notes: e.target.value })}
        onBlur={() => commit()}
        disabled={disabled}
        placeholder="Notes (optional)…"
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
      />

      {/* Components */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Ingredients (lbs per batch · share % of blend)
          </p>
          {totalLbs > 0 && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {totalLbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} lbs / batch
            </span>
          )}
        </div>
        {draft.components.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No ingredients yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {draft.components.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  list={`cheese-ingredients-${draft.id}`}
                  value={c.ingredient}
                  onChange={(e) => patchComponent(idx, { ingredient: e.target.value })}
                  onBlur={() => commit()}
                  disabled={disabled}
                  placeholder="Ingredient…"
                  className="flex-1 min-w-[7rem] rounded-md border border-input bg-background px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={c.lbs}
                  onChange={(e) =>
                    patchComponent(idx, {
                      lbs: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  onBlur={() => commit()}
                  disabled={disabled}
                  className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                />
                <span className="text-[11px] text-muted-foreground">lbs</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={
                    c.sharePct != null && c.sharePct > 0
                      ? c.sharePct
                      : Math.round((shares[idx] ?? 0) * 1000) / 10 || ""
                  }
                  onChange={(e) =>
                    patchComponent(idx, {
                      sharePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                  onBlur={() => commit()}
                  disabled={disabled}
                  title="This ingredient's share of the blend (%). A flavor's per-ingredient oz/pizza = its cheese target oz × this share."
                  className="w-16 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                />
                <span className="text-[11px] text-muted-foreground">%</span>
                <button
                  type="button"
                  onClick={() => removeComponent(idx)}
                  disabled={disabled}
                  title="Remove ingredient"
                  className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <datalist id={`cheese-ingredients-${draft.id}`}>
          {ingredientSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={addComponent}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add ingredient
        </button>
      </div>

      {/* Per-flavor preview: target oz × share for each covered flavor */}
      {flavorPreview.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-border/40 bg-background/40 p-2">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Per-flavor oz/pizza preview (cheese target × share)
          </p>
          {flavorPreview.map((f) => (
            <div key={f.flavor} className="text-[11px]">
              <span className="font-semibold">{f.flavor}</span>
              <span className="text-muted-foreground"> — target {f.targetOz.toLocaleString(undefined, { maximumFractionDigits: 2 })} oz: </span>
              <span className="font-mono text-muted-foreground">
                {draft.components
                  .map((c, i) => ({ ingredient: c.ingredient.trim(), oz: f.rows[i] ?? 0 }))
                  .filter((r) => r.ingredient)
                  .map((r) => `${r.ingredient} ${r.oz.toLocaleString(undefined, { maximumFractionDigits: 2 })} oz`)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
