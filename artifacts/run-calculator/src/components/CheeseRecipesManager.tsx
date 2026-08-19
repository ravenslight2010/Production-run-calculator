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
  ArrowRightLeft,
} from "lucide-react";
import {
  mixFromCheeseRecipe,
  cheeseComponentsHaveBatchLbs,
} from "@workspace/mixes";
import {
  normalizeCheeseRecipe,
  cheeseRecipeMatchesQuery,
  groupCheeseRecipesByBrand,
  renameCheeseRecipesBrand,
  cheeseComponentShares,
  type CheeseRecipe,
  type CheeseComponent,
} from "@workspace/cheese-recipes";
import { useCheeseRecipes } from "../hooks/useCheeseRecipes";
import { saveCheeseRecipes, deleteCheeseRecipes } from "../cheeseRecipes";
import { fetchMixes, saveMixes } from "../mixes";
import { relinkCheeseSlotsToMixInProfiles } from "../storage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { BrandRenamePanel } from "@/components/BrandRenamePanel";
import {
  maybeLearnPoolRename,
  maybeLearnBrandRename,
  maybeLearnRowBrandChange,
} from "@/specImportAliases";
// Decimal-friendly numeric input: keeps the in-progress text locally while
// focused (so typing "0.", ".5", clearing, etc. never snaps/reformats under
// the caret), selects everything on focus for easy overwrite, and reports the
// parsed number on every keystroke so derived UI (shares, batch total)
// updates live. Syncs from the prop only while NOT focused.
function DecimalInput({
  value,
  onValue,
  onBlur,
  disabled,
  className,
  max,
  "aria-label": ariaLabel,
  title,
}: {
  value: number;
  onValue: (n: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  className?: string;
  max?: number;
  "aria-label"?: string;
  title?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (n: number) =>
    Math.max(0, max != null ? Math.min(max, n) : n);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text ?? (value === 0 ? "" : String(value))}
      placeholder="0"
      onFocus={(e) => {
        setText(e.currentTarget.value);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^\d*\.?\d*$/.test(t)) return; // digits + one dot only
        setText(t);
        const n = Number(t);
        onValue(Number.isFinite(n) ? clamp(n) : 0);
      }}
      onBlur={() => {
        setText(null);
        onBlur?.();
      }}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      title={title}
    />
  );
}

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
export default function CheeseRecipesManager({
  brands = [],
  ingredientSuggestions = [],
  onSaved,
}: {
  brands?: string[];
  ingredientSuggestions?: string[];
  /** Called with the full server-normalized pool after any successful save. */
  onSaved?: (saved: CheeseRecipe[]) => void;
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
      onSaved?.(saved);
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

  // Move a misfiled non-cheese blend to the Mixes pool: create the Mix FIRST
  // (a failed save keeps the cheese row alive), then delete the cheese row,
  // then re-type any profile applicator slots linked to it ("cheese" → "Mix" —
  // the link name field is shared, see mix-applicator-slots). If a same-named
  // mix already exists (case-insensitive), keep it — the name link keeps
  // working — and only remove the cheese row.
  const moveMutation = useMutation({
    mutationFn: async (recipe: CheeseRecipe) => {
      const nameLc = recipe.name.trim().toLowerCase();
      const existing = await fetchMixes();
      const already = existing.some(
        (m) => m.name.trim().toLowerCase() === nameLc,
      );
      if (!already) {
        const mix = mixFromCheeseRecipe(recipe);
        if (!mix) throw new Error("Cheese recipe has no name");
        await saveMixes([mix]);
      }
      const remaining = await deleteCheeseRecipes([recipe.id]);
      relinkCheeseSlotsToMixInProfiles(recipe.name);
      return remaining;
    },
    onSuccess: (remaining) => {
      qc.setQueryData(["cheeseRecipes"], remaining);
      qc.invalidateQueries({ queryKey: ["mixes"] });
      setError(null);
    },
    onError: () =>
      setError(
        "Could not move the recipe to Mixes. Check your connection and try again.",
      ),
  });

  const busy =
    saveMutation.isPending || deleteMutation.isPending || moveMutation.isPending;

  // Rename a whole customer group (or merge it into another group when the
  // new name matches an existing customer — grouping is case-insensitive).
  // Rewrites only the changed rows through the normal save path.
  function renameBrandGroup(fromBrand: string, toBrand: string) {
    const changed = renameCheeseRecipesBrand(items, fromBrand, toBrand);
    setRenamingBrand(null);
    if (changed.length === 0) return;
    // Learn the rename as a spec-import brand alias (fire-and-forget) so a
    // re-import of a workbook whose tab still carries the old customer name
    // lands on the renamed group instead of resurrecting it. Applies to plain
    // renames AND merges into an existing group.
    maybeLearnBrandRename(fromBrand, toBrand);
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
                                className={`w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 rounded-md text-left border ${
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
                                <CheeseRecipeEditor
                                  recipe={recipe}
                                  disabled={busy}
                                    brands={brands}
                                  ingredientSuggestions={ingredientSuggestions}
                                  onChange={(next) => {
                                    maybeLearnPoolRename("cheese", recipe.name, next.name, next.brand);
                                    // Per-row brand edit: if no OTHER row still
                                    // carries the old brand, the whole group
                                    // effectively moved — learn the rename.
                                    const oldBrandLc = recipe.brand.trim().toLowerCase();
                                    maybeLearnRowBrandChange(
                                      recipe.brand,
                                      next.brand,
                                      items.some(
                                        (r) =>
                                          r.id !== recipe.id &&
                                          r.brand.trim().toLowerCase() === oldBrandLc,
                                      ),
                                    );
                                    saveMutation.mutate([next]);
                                  }}
                                  onDelete={() => deleteMutation.mutate([recipe.id])}
                                  onMoveToMixes={() => moveMutation.mutate(recipe)}
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

export function CheeseRecipeEditor({
  recipe,
  disabled,
  brands,
  ingredientSuggestions,
  onChange,
  onDelete,
  onMoveToMixes,
}: {
  recipe: CheeseRecipe;
  disabled: boolean;
  brands: string[];
  ingredientSuggestions: string[];
  onChange: (recipe: CheeseRecipe) => void;
  onDelete: () => void;
  onMoveToMixes?: () => void;
}) {
  const [draft, setDraft] = useState<CheeseRecipe>(recipe);

  const signature = JSON.stringify(recipe);
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(recipe);
  }

  function patch(p: Partial<CheeseRecipe>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: CheeseRecipe = draft) {
    // Stored flavors are inert (targeting removed) — pass them through
    // unchanged; recipes attach via applicator-slot name links only.
    const clean = normalizeCheeseRecipe(next);
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
      components: [...d.components, { ingredient: "", lbs: 0 }],
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

  const totalLbs = draft.components.reduce((s, c) => s + (Number(c.lbs) || 0), 0);
  // Each ingredient's share of the blend (fractions summing to 1) — explicit
  // sharePct first, then ozPerPizza proportions, then lbs proportions. Drives
  // the Share % column's derived placeholder.
  const shares = useMemo(() => cheeseComponentShares(draft.components), [draft.components]);
  const brandOptions = draft.brand && !brands.includes(draft.brand)
    ? [draft.brand, ...brands]
    : brands;

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
        {onMoveToMixes && (
          <ConfirmDeleteButton
            onConfirm={onMoveToMixes}
            title="Move this recipe to Mixes?"
            confirmLabel="Move to Mixes"
            description={
              <>
                Use this when a blend was filed under Cheese by mistake (it isn't
                a cheese blend). It becomes a Mix — keeping its customer, flavors
                and notes — and is removed from Cheese Recipes for everyone.
                Profiles linked to it switch their applicator slot to "Mix"
                automatically.
                {cheeseComponentsHaveBatchLbs(recipe.components) && (
                  <>
                    {" "}
                    <span className="font-semibold">
                      Warning: this recipe has per-batch pounds, which do NOT
                      carry into a Mix
                    </span>{" "}
                    (mixes use per-pizza ounces). Note them down first if you
                    need them.
                  </>
                )}
              </>
            }
          >
            <button
              type="button"
              disabled={disabled}
              title="Move to Mixes (for blends misfiled under Cheese)"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Move to Mixes
            </button>
          </ConfirmDeleteButton>
        )}
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
          <select
            value={draft.brand}
            onChange={(e) => patch({ brand: e.target.value })}
            onBlur={() => commit()}
            disabled={disabled}
            aria-label="Customer (brand)"
            className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="">Any customer</option>
            {brandOptions.map((brand) => (
              <option key={brand} value={brand}>
                {brand === draft.brand && !brands.includes(brand) ? `${brand} (current)` : brand}
              </option>
            ))}
          </select>
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
          {draft.components.length > 0 && (
            <span className="text-[11px] text-muted-foreground font-mono">
              Total: {totalLbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} lbs / batch
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
                <DecimalInput
                  value={c.lbs}
                  aria-label="lbs per batch"
                  onValue={(n) =>
                    // Editing a row's batch lbs makes any imported per-pizza
                    // oz on that row stale — drop it so the manager's lbs
                    // (not old spec data) drive the blend shares.
                    patchComponent(idx, { lbs: n })
                  }
                  onBlur={() => commit()}
                  disabled={disabled}
                  className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                />
                <span className="text-[11px] text-muted-foreground">lbs</span>
                {/* oz/pizza is not shown here — it is a property of the applicator
                    slot, not the recipe. The same recipe can be used by two
                    applicators at different target weights, making per-ingredient
                    oz/pizza different for each. Share % drives the per-ingredient
                    split; applicator oz/pizza lives on the run form. */}
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

    </div>
  );
}
