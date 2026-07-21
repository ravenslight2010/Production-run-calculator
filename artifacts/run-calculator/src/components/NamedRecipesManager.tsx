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
} from "lucide-react";
import {
  normalizeNamedRecipe,
  namedRecipeMatchesQuery,
  sortNamedRecipesByName,
  namedRecipeTotalLbs,
  type DoughballVariant,
  type NamedRecipe,
  type NamedRecipeComponent,
} from "@workspace/named-recipes";
import { useNamedRecipes } from "../hooks/useNamedRecipes";
import {
  saveNamedRecipes,
  deleteNamedRecipes,
  type NamedRecipeKind,
} from "../namedRecipes";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { maybeLearnPoolRename } from "@/specImportAliases";

function genId(prefix: string): string {
  return `${prefix}:` + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankNamedRecipe(prefix: string, name: string): NamedRecipe {
  return {
    id: genId(prefix),
    name,
    notes: "",
    components: [],
    enabled: true,
    brand: "",
    flavors: [],
  };
}

// Manager-only editor for factory-wide Dough / Sauce recipes. A named recipe is
// a simple name plus a list of components (each ingredient and its pounds).
// Recipes attach to products by NAME only — a profile links a dough/sauce
// recipe name and hydrates from this pool; there is no brand/flavor "who it
// goes to" targeting (stored brand/flavors fields on old rows are inert).
// This stays a flat, searchable list sorted by name. Recipes are persisted
// server-side (shared across all signed-in users) and feed the run form's
// Dough / Sauce cards, which pick one and hydrate their rows from it. This
// works exactly like Cheese Recipes / Mixes but is a SEPARATE pool per kind.
// The server enforces the manager role on writes; this card is only rendered
// for managers.
export default function NamedRecipesManager({
  kind,
  ingredientSuggestions = [],
}: {
  kind: NamedRecipeKind;
  ingredientSuggestions?: string[];
}) {
  const qc = useQueryClient();
  const { items, isLoading } = useNamedRecipes(kind);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openRecipes, setOpenRecipes] = useState<Set<string>>(new Set());

  const label = kind === "dough" ? "Dough" : "Sauce";
  const queryKey = kind === "dough" ? "doughRecipes" : "sauceRecipes";

  const filtered = useMemo(
    () =>
      sortNamedRecipesByName(
        items.filter((r) => namedRecipeMatchesQuery(r, query)),
      ),
    [items, query],
  );

  function toggleRecipe(id: string) {
    setOpenRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: (next: NamedRecipe[]) => saveNamedRecipes(kind, next),
    onSuccess: (saved) => {
      qc.setQueryData([queryKey], saved);
      setError(null);
    },
    onError: () =>
      setError(
        `Could not save the ${label.toLowerCase()} recipe. Check your connection and try again.`,
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteNamedRecipes(kind, ids),
    onSuccess: (saved) => {
      qc.setQueryData([queryKey], saved);
      setError(null);
    },
    onError: () =>
      setError(
        `Could not delete the ${label.toLowerCase()} recipe. Check your connection and try again.`,
      ),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addRecipe() {
    const draft = blankNamedRecipe(kind, `New ${label} Recipe`);
    setQuery("");
    setOpenRecipes((prev) => new Set(prev).add(draft.id));
    saveMutation.mutate([draft]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="w-4 h-4" />
          {label} Recipes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Define each {label.toLowerCase()} recipe once by{" "}
          <span className="font-semibold">name</span> and its ingredients with{" "}
          <span className="font-semibold">pounds</span>. The run "{label}" cards
          pick one of these and fill in the rows automatically.
        </p>

        {error && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border bg-red-950/40 border-red-700/40 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">
            Loading {label.toLowerCase()} recipes…
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No {label.toLowerCase()} recipes yet. Add one below.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()} recipes by name or ingredient…`}
                className="w-full rounded-md border border-input bg-background pl-7 pr-2 py-1.5 text-xs"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No {label.toLowerCase()} recipes match "{query.trim()}".
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {filtered.map((recipe) => {
                  const expanded = openRecipes.has(recipe.id);
                  return (
                    <div key={recipe.id} className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleRecipe(recipe.id)}
                        className={`w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 rounded-md text-left border ${
                          expanded
                            ? "border-primary/50 bg-primary/10"
                            : "border-border/60 hover:bg-muted/40"
                        }`}
                      >
                        {expanded ? (
                          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 text-xs font-medium truncate">
                          {recipe.name || "Unnamed recipe"}
                        </span>
                        {!recipe.enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
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
                        <NamedRecipeEditor
                          kind={kind}
                          recipe={recipe}
                          disabled={busy}
                          ingredientSuggestions={ingredientSuggestions}
                          onChange={(next) => {
                            maybeLearnPoolRename(kind, recipe.name, next.name);
                            saveMutation.mutate([next]);
                          }}
                          onDelete={() => deleteMutation.mutate([recipe.id])}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
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
            <Plus className="w-3.5 h-3.5" /> Add {label} Recipe
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function NamedRecipeEditor({
  kind,
  recipe,
  disabled,
  ingredientSuggestions,
  onChange,
  onDelete,
}: {
  kind: NamedRecipeKind;
  recipe: NamedRecipe;
  disabled: boolean;
  ingredientSuggestions: string[];
  onChange: (recipe: NamedRecipe) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<NamedRecipe>(recipe);

  const signature = JSON.stringify(recipe);
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(recipe);
  }

  function patch(p: Partial<NamedRecipe>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: NamedRecipe = draft) {
    const clean = normalizeNamedRecipe(next);
    if (clean) onChange({ ...clean, id: next.id, scope: next.scope });
  }

  function patchComponent(idx: number, p: Partial<NamedRecipeComponent>) {
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
      components: [...d.components, { ingredient: "", lbs: 0 }],
    }));
  }

  function patchVariant(idx: number, p: Partial<DoughballVariant>) {
    setDraft((d) => ({
      ...d,
      doughballVariants: (d.doughballVariants ?? []).map((variant, i) =>
        i === idx ? { ...variant, ...p } : variant,
      ),
    }));
  }

  function addVariant() {
    setDraft((d) => ({
      ...d,
      doughballVariants: [...(d.doughballVariants ?? []), { label: "" }],
    }));
  }

  function removeVariant(idx: number) {
    const next = {
      ...draft,
      doughballVariants: (draft.doughballVariants ?? []).filter((_, i) => i !== idx),
    };
    setDraft(next);
    commit(next);
  }

  function removeComponent(idx: number) {
    const next = {
      ...draft,
      components: draft.components.filter((_, i) => i !== idx),
    };
    setDraft(next);
    commit(next);
  }

  const totalLbs = namedRecipeTotalLbs({
    ...draft,
    components: draft.components.map((c) => ({
      ingredient: c.ingredient,
      lbs: Number(c.lbs) || 0,
    })),
  });

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
          placeholder="Recipe name…"
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
          title={`Delete this ${kind} recipe?`}
          description="This removes the recipe for everyone. This can't be undone."
        >
          <button
            type="button"
            disabled={disabled}
            title="Delete recipe"
            className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </ConfirmDeleteButton>
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

      {/* Dough only: per-variant doughball numbers this family recipe covers.
          A spec import fills these automatically (label = the variant's sheet
          name); managers can correct or add them here. Blank labels or rows
          with neither number are dropped on save. */}
      {kind === "dough" && (
        <div className="space-y-1.5" data-testid={`dough-variants-${draft.id}`}>
          <p className="text-[11px] font-semibold text-muted-foreground">
            Doughball variants (weight oz / per tray)
          </p>
          {(draft.doughballVariants ?? []).length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No variants yet — imports add them automatically.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {(draft.doughballVariants ?? []).map((variant, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={variant.label}
                    onChange={(e) => patchVariant(idx, { label: e.target.value })}
                    onBlur={() => commit()}
                    disabled={disabled}
                    placeholder={'Variant (e.g. 11" CRB)…'}
                    className="flex-1 min-w-[7rem] rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={variant.weightOz ?? ""}
                    onChange={(e) =>
                      patchVariant(idx, {
                        weightOz: Math.max(0, Number(e.target.value) || 0) || undefined,
                      })
                    }
                    onBlur={() => commit()}
                    disabled={disabled}
                    placeholder="oz"
                    title="Doughball weight (oz)"
                    className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                  />
                  <span className="text-[11px] text-muted-foreground">oz</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={variant.perTray ?? ""}
                    onChange={(e) =>
                      patchVariant(idx, {
                        perTray: Math.max(0, Math.round(Number(e.target.value) || 0)) || undefined,
                      })
                    }
                    onBlur={() => commit()}
                    disabled={disabled}
                    placeholder="tray"
                    title="Doughballs per tray"
                    className="w-16 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                  />
                  <span className="text-[11px] text-muted-foreground">/tray</span>
                  <button
                    type="button"
                    onClick={() => removeVariant(idx)}
                    disabled={disabled}
                    title="Remove variant"
                    className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={addVariant}
            disabled={disabled}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Add variant
          </button>
        </div>
      )}

      {/* Components */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Ingredients (lbs)
          </p>
          {totalLbs > 0 && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {totalLbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} lbs
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
                  list={`named-ingredients-${draft.id}`}
                  value={c.ingredient}
                  onChange={(e) =>
                    patchComponent(idx, { ingredient: e.target.value })
                  }
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
        <datalist id={`named-ingredients-${draft.id}`}>
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
    </div>
  );
}
