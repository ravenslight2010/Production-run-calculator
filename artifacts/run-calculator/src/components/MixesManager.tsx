import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  Plus,
  Trash2,
  Blend,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
import {
  DEFAULT_DAYS_EARLY,
  normalizeMix,
  mixMatchesQuery,
  groupMixesByBrand,
  renameMixesBrand,
  type Mix,
  type MixComponent,
} from "@workspace/mixes";
import {
  detectMixComponentConflicts,
  resolveMixByPerPizza,
  resolveMixByPerBatchLbs,
} from "@workspace/setup-math-check";
import { useMixes } from "../hooks/useMixes";
import { saveMixes, deleteMixes } from "../mixes";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { BrandRenamePanel } from "@/components/BrandRenamePanel";
import {
  maybeLearnPoolRename,
  maybeLearnBrandRename,
  maybeLearnRowBrandChange,
} from "@/specImportAliases";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankMix(): Mix {
  return {
    id: genId(),
    name: "",
    brand: "",
    flavor: "",
    batchSize: 0,
    daysEarly: DEFAULT_DAYS_EARLY,
    notes: "",
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
  };
}

// Manager-only editor for factory-wide mixes. A mix is a pre-blended recipe
// (veggie/topping, cheese, sauce, …) made ahead for a product. Each mix names
// the product (brand + flavor) it matches against scheduled runs, a batch size
// (lbs/batch), an optional "make N days early" window, optional notes, an
// optional "amount already made", and a list of components (each ingredient and
// its per-pizza ounces). Mixes are persisted server-side (shared across all
// signed-in users) and drive the Mixes make-day plan. The server enforces the
// manager role on writes; this card is only rendered for managers.
export default function MixesManager({
  brands = [],
  brandFlavors = {},
  ingredientSuggestions = [],
}: {
  brands?: string[];
  brandFlavors?: Record<string, string[]>;
  ingredientSuggestions?: string[];
}) {
  const qc = useQueryClient();
  const { items, isLoading } = useMixes();
  const [error, setError] = useState<string | null>(null);
  // Browsing state: search + which brand groups / mix editors are open. With
  // dozens of imported mixes a flat list of full editors is unusable, so the
  // list is grouped by brand (collapsed by default) and each mix is a compact
  // row that expands to the full editor on tap.
  const [query, setQuery] = useState("");
  const [openBrands, setOpenBrands] = useState<Set<string>>(new Set());
  const [openMixes, setOpenMixes] = useState<Set<string>>(new Set());
  // Brand group (lowercased key) whose rename/merge panel is open, if any.
  const [renamingBrand, setRenamingBrand] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const groups = useMemo(() => {
    const filtered = items.filter((m) => mixMatchesQuery(m, query));
    return groupMixesByBrand(filtered);
  }, [items, query]);
  // All brand names in the FULL pool (ignoring the search filter), so the
  // rename panel can offer every possible merge target.
  const allBrands = useMemo(
    () => groupMixesByBrand(items).map((g) => g.brand).filter(Boolean),
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

  function toggleMix(id: string) {
    setOpenMixes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: (next: Mix[]) => saveMixes(next),
    onSuccess: (saved) => {
      qc.setQueryData(["mixes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the mix. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteMixes(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["mixes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the mix. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  // Rename a whole brand group (or merge it into another group when the new
  // name matches an existing brand — grouping is case-insensitive). Rewrites
  // only the changed rows through the normal save path.
  function renameBrandGroup(fromBrand: string, toBrand: string) {
    const changed = renameMixesBrand(items, fromBrand, toBrand);
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

  function addMix() {
    const draft = blankMix();
    draft.name = "New Mix";
    // Open the new mix (and its no-brand group) so it's immediately editable.
    setQuery("");
    setOpenBrands((prev) => new Set(prev).add(""));
    setOpenMixes((prev) => new Set(prev).add(draft.id));
    saveMutation.mutate([draft]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Blend className="w-4 h-4" />
          Mixes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Define pre-blended mixes made ahead for a product. Match a mix to a
          product by <span className="font-semibold">brand + flavor</span>, set
          its batch size and components (oz per pizza). The Mixes tab shows what
          to make for a chosen day — within the{" "}
          <span className="font-semibold text-sky-300">days-early</span> window
          (default {DEFAULT_DAYS_EARLY}).
        </p>

        {error && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border bg-red-950/40 border-red-700/40 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading mixes…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No mixes yet. Add one below.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search mixes by name, brand, or flavor…"
                className="w-full rounded-md border border-input bg-background pl-7 pr-2 py-1.5 text-xs"
              />
            </div>

            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No mixes match "{query.trim()}".
              </p>
            ) : (
              groups.map((group) => {
                const key = group.brand.toLowerCase();
                // While searching, matched groups stay open so results are
                // visible. A single lone group is always open (no point
                // hiding the whole list behind one header).
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
                          {group.brand || "No brand"}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                          {group.mixes.length}
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
                          title="Rename or merge this brand"
                          className="px-2.5 flex items-center text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {renamingBrand === key && group.brand && (
                      <BrandRenamePanel
                        brand={group.brand}
                        nounLabel="brand"
                        itemCount={group.mixes.length}
                        itemNoun="mix"
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
                        {group.mixes.map((mix) => {
                          const expanded = openMixes.has(mix.id);
                          return (
                            <div key={mix.id} className="flex flex-col gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleMix(mix.id)}
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
                                  {mix.name || "Unnamed mix"}
                                </span>
                                {!mix.enabled && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                                    Off
                                  </span>
                                )}
                                {mix.isPrep && (
                                  <span className="text-[10px] rounded px-1.5 py-0.5 bg-violet-900/30 text-violet-300 border border-violet-700/40 shrink-0">
                                    prep
                                  </span>
                                )}
                                {mix.batchSize > 0 && (
                                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                    {mix.batchSize} lbs
                                  </span>
                                )}
                                {mix.components.length > 0 &&
                                  mix.components.every((c) => !(c.perPizza > 0)) && (
                                    <span className="flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-amber-900/30 text-amber-300 border border-amber-700/40 shrink-0">
                                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                                      no oz/pizza
                                    </span>
                                  )}
                                {mix.flavor && (
                                  <span className="basis-full sm:basis-auto ml-5 sm:ml-0 max-w-full min-w-0 text-[11px] text-muted-foreground truncate sm:max-w-[14rem]">
                                    {mix.flavor}
                                  </span>
                                )}
                              </button>
                              {expanded && (
                                <MixEditor
                                  mix={mix}
                                  disabled={busy}
                                  brands={brands}
                                  brandFlavors={brandFlavors}
                                  ingredientSuggestions={ingredientSuggestions}
                                  onChange={(next) => {
                                    maybeLearnPoolRename("mixes", mix.name, next.name, next.brand);
                                    // Per-row brand edit: if no OTHER row still
                                    // carries the old brand, the whole group
                                    // effectively moved — learn the rename.
                                    const oldBrandLc = mix.brand.trim().toLowerCase();
                                    maybeLearnRowBrandChange(
                                      mix.brand,
                                      next.brand,
                                      items.some(
                                        (m) =>
                                          m.id !== mix.id &&
                                          m.brand.trim().toLowerCase() === oldBrandLc,
                                      ),
                                    );
                                    saveMutation.mutate([next]);
                                  }}
                                  onDelete={() => deleteMutation.mutate([mix.id])}
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
            onClick={addMix}
            disabled={busy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Mix
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function MixEditor({
  mix,
  disabled,
  brands,
  brandFlavors,
  ingredientSuggestions,
  onChange,
  onDelete,
}: {
  mix: Mix;
  disabled: boolean;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  ingredientSuggestions: string[];
  onChange: (mix: Mix) => void;
  onDelete: () => void;
}) {
  // Local draft so component rows / numbers edit smoothly; commit on blur.
  const [draft, setDraft] = useState<Mix>(mix);

  // Keep the local draft in step when the upstream record changes (e.g. a
  // background poll or a save round-trip returns the canonical row).
  const signature = JSON.stringify(mix);
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(mix);
  }

  function patch(p: Partial<Mix>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: Mix = draft) {
    const clean = normalizeMix(next);
    if (clean) onChange({ ...clean, id: next.id, scope: next.scope });
  }

  function patchComponent(idx: number, p: Partial<MixComponent>) {
    setDraft((d) => {
      const components = d.components.map((c, i) =>
        i === idx ? { ...c, ...p } : c,
      );
      return { ...d, components };
    });
  }

  function addComponent() {
    const next = {
      ...draft,
      components: [...draft.components, { ingredient: "", perPizza: 0 }],
    };
    setDraft(next);
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
          placeholder="Mix name…"
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
          title="Delete this mix?"
          description="This removes the mix for everyone. This can't be undone."
        >
          <button
            type="button"
            disabled={disabled}
            title="Delete mix"
            className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </ConfirmDeleteButton>
      </div>

      {/* Product match: brand + flavor */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Brand</span>
          <input
            type="text"
            list={`mix-brands-${draft.id}`}
            value={draft.brand}
            onChange={(e) => patch({ brand: e.target.value })}
            onBlur={() => commit()}
            disabled={disabled}
            placeholder="Any brand"
            className="w-36 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <datalist id={`mix-brands-${draft.id}`}>
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Flavor</span>
          <input
            type="text"
            list={`mix-flavors-${draft.id}`}
            value={draft.flavor}
            onChange={(e) => patch({ flavor: e.target.value })}
            onBlur={() => commit()}
            disabled={disabled}
            placeholder="Any flavor"
            className="w-36 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <datalist id={`mix-flavors-${draft.id}`}>
            {flavorOptions.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Batch size, days early, amount already made */}
      <div className="flex flex-wrap items-end gap-2">
        <NumberField
          label="Batch size (lbs)"
          value={draft.batchSize}
          min={0}
          step={0.1}
          disabled={disabled}
          onChange={(v) => patch({ batchSize: v })}
          onCommit={() => commit()}
        />
        <NumberField
          label="Days early"
          value={draft.daysEarly}
          min={0}
          step={1}
          integer
          disabled={disabled}
          onChange={(v) => patch({ daysEarly: v })}
          onCommit={() => commit()}
        />
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

      {/* Prep mix toggle */}
      <label className="flex items-start gap-2 cursor-pointer group">
        <input
          type="checkbox"
          checked={!!draft.isPrep}
          onChange={(e) => {
            const next = { ...draft, isPrep: e.target.checked };
            setDraft(next);
            commit(next);
          }}
          disabled={disabled}
          className="mt-0.5 accent-violet-500 shrink-0"
        />
        <div>
          <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">Prep mix</span>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">When checked, this mix appears in the plan for any run that uses one of its component ingredients — regardless of brand/flavor.</p>
        </div>
      </label>

      {/* Components */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground">
          Components (oz per pizza · lbs per batch)
        </p>
        {draft.components.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No components yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {draft.components.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  list={`mix-ingredients-${draft.id}`}
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
                  step={0.001}
                  value={c.perPizza}
                  onChange={(e) =>
                    patchComponent(idx, {
                      perPizza: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  onBlur={() => commit()}
                  disabled={disabled}
                  className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                />
                <span className="text-[11px] text-muted-foreground">oz/pizza</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={c.perBatchLbs ?? 0}
                  onChange={(e) =>
                    patchComponent(idx, {
                      perBatchLbs: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  onBlur={() => commit()}
                  disabled={disabled}
                  title="Pounds per batch (reference only — plan math uses oz/pizza)"
                  className="w-16 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                />
                <span className="text-[11px] text-muted-foreground">lbs/batch</span>
                <button
                  type="button"
                  onClick={() => removeComponent(idx)}
                  disabled={disabled}
                  title="Remove component"
                  className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Mix component math conflict panel */}
        {(() => {
          const conflicts = detectMixComponentConflicts(draft.components, draft.batchSize);
          if (conflicts.length === 0) return null;
          return (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-[12px] font-medium text-amber-700 dark:text-amber-400 flex-1 leading-tight">
                  {conflicts.length === 1
                    ? "1 component has mismatched oz/pizza and lbs/batch"
                    : `${conflicts.length} components have mismatched oz/pizza and lbs/batch`}
                </span>
              </div>
              <div className="space-y-1.5">
                {conflicts.map((cf) => (
                  <div key={cf.componentIdx} className="rounded bg-muted/40 px-2.5 py-1.5 text-[11px]">
                    <span className="font-semibold">{cf.ingredient || `Row ${cf.componentIdx + 1}`}</span>
                    {": "}
                    <span className="font-mono">{cf.perPizza} oz/pizza</span> implies{" "}
                    <span className="font-mono">{cf.expectedPerBatchLbs.toFixed(2)} lbs/batch</span>, but{" "}
                    <span className="font-mono">{cf.perBatchLbs} lbs/batch</span> is entered.
                  </div>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const resolved = resolveMixByPerPizza(draft.components, draft.batchSize);
                    const next = { ...draft, components: resolved as MixComponent[] };
                    setDraft(next);
                    commit(next);
                  }}
                  className="flex-1 min-w-[140px] px-2 py-1.5 rounded-md border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-semibold text-amber-800 dark:text-amber-300 transition-colors disabled:opacity-50 text-left"
                >
                  Use oz/pizza → fix all lbs/batch values
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const { components: resolvedComps, batchSize: resolvedBatchSize } =
                      resolveMixByPerBatchLbs(draft.components, draft.batchSize);
                    const next = {
                      ...draft,
                      components: resolvedComps as MixComponent[],
                      batchSize: resolvedBatchSize,
                    };
                    setDraft(next);
                    commit(next);
                  }}
                  className="flex-1 min-w-[140px] px-2 py-1.5 rounded-md border border-border/60 bg-muted/40 hover:bg-muted/70 text-[11px] font-semibold text-foreground transition-colors disabled:opacity-50 text-left"
                >
                  Use lbs/batch → redistribute oz/pizza values
                </button>
              </div>
            </div>
          );
        })()}
        <datalist id={`mix-ingredients-${draft.id}`}>
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
          <Plus className="w-3 h-3" /> Add component
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  step,
  integer = false,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  integer?: boolean;
  disabled: boolean;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => {
          const raw = Number(e.target.value) || 0;
          const v = integer ? Math.trunc(raw) : raw;
          onChange(Math.max(min, v));
        }}
        onBlur={onCommit}
        disabled={disabled}
        className="w-28 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
      />
    </div>
  );
}
