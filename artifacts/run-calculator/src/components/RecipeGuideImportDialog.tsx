import { useEffect, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { SauceGuideCandidate, DoughGuideCandidate } from "@workspace/recipe-guide-import";
import type { SauceGuideImportPrepared, DoughGuideImportPrepared } from "@/recipeGuideImport";
import { loadProfile } from "@/storage";
import { useAccessibleDialog } from "./useAccessibleDialog";

/**
 * Returns true when a candidate has no confident match on EITHER side (brand
 * and recipe are both null).  These rows need manual resolution before they
 * can be applied — otherwise every brand profile would get a wrong recipe.
 */
function isBothUnmatched(
  c: SauceGuideCandidate | DoughGuideCandidate,
): boolean {
  if ("matchedRecipeName" in c) return c.brand === null && c.matchedRecipeName === null;
  return c.brand === null && c.matchedDoughRecipeName === null;
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function MatchBadge({ matched, guide }: { matched: string | null; guide: string }) {
  if (matched) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/30 px-2 py-0.5 text-[11px] text-green-700 dark:text-green-400 font-medium">
        <CheckCircle2 className="w-3 h-3" /> {matched}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
      <AlertTriangle className="w-3 h-3" /> {guide} (no match)
    </span>
  );
}

function FlavorChips({
  id,
  brand,
  flavors,
  picks,
  flavorsByBrand,
  onToggle,
  onClear,
}: {
  id: string;
  brand: string;
  flavors: string[] | null;
  picks: Set<string>;
  flavorsByBrand: Record<string, string[]>;
  onToggle: (id: string, f: string) => void;
  onClear: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const available = flavorsByBrand[brand] ?? [];
  // Default flavor scope from the guide row
  const defaultScope = flavors
    ? flavors.join(", ")
    : available.length > 0
    ? `All flavors (${available.length})`
    : "All flavors";

  if (available.length === 0) {
    return <p className="text-[11px] text-muted-foreground pl-1">All flavors (no stored flavors yet)</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Flavors:</span>
        {picks.size > 0 ? (
          <button
            type="button"
            onClick={() => onClear(id)}
            className="text-[11px] text-primary underline"
          >
            Reset to guide default
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">{defaultScope}</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Hide" : "Narrow"}
        </button>
      </div>
      {expanded && (
        <div className="flex flex-wrap gap-1 pl-1">
          {available.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onToggle(id, f)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                picks.has(f)
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f || "(brand-level)"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sauce Guide Dialog ───────────────────────────────────────────────────────

type SauceProps = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  prepared: SauceGuideImportPrepared | null;
  applying: boolean;
  onConfirm: (
    rows: { brand: string; flavors: string[]; recipeName: string; ozPerPizza: number; wasNullBrand: boolean; wasNullRecipe: boolean }[],
    acknowledged: boolean,
  ) => void;
};

export function SauceGuideImportDialog({
  open, onClose, loading, error, prepared, applying, onConfirm,
}: SauceProps) {
  const dialogRef = useAccessibleDialog<HTMLDivElement>(open, onClose);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brandPicks, setBrandPicks] = useState<Record<string, string>>({});
  const [recipePicks, setRecipePicks] = useState<Record<string, string>>({});
  const [flavorPicks, setFlavorPicks] = useState<Record<string, Set<string>>>({});
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (prepared) {
      setSelected(new Set(prepared.candidates.filter((c) => c.brand).map((c) => c.id)));
      setBrandPicks(Object.fromEntries(prepared.candidates.map((c) => [c.id, c.brand ?? ""])));
      setRecipePicks(
        Object.fromEntries(
          prepared.candidates.map((c) => [c.id, c.matchedRecipeName ?? c.guideName]),
        ),
      );
      setFlavorPicks({});
      setAcknowledged(false);
    } else {
      setSelected(new Set());
      setBrandPicks({});
      setRecipePicks({});
      setFlavorPicks({});
    }
  }, [prepared]);

  if (!open) return null;

  const candidates = prepared?.candidates ?? [];
  const brands = prepared?.brands ?? [];
  const flavorsByBrand = prepared?.flavorsByBrand ?? {};
  const sauceRecipeNames = prepared?.sauceRecipeNames ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pickBrand = (id: string, brand: string) => {
    setBrandPicks((p) => ({ ...p, [id]: brand }));
    setFlavorPicks((p) => { const n = { ...p }; delete n[id]; return n; });
    setSelected((prev) => { const n = new Set(prev); brand ? n.add(id) : n.delete(id); return n; });
  };

  const toggleFlavor = (id: string, f: string) =>
    setFlavorPicks((prev) => {
      const cur = new Set(prev[id] ?? []);
      cur.has(f) ? cur.delete(f) : cur.add(f);
      return { ...prev, [id]: cur };
    });

  const clearFlavors = (id: string) =>
    setFlavorPicks((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const applyRows = candidates
    .filter((c) => {
      if (!selected.has(c.id)) return false;
      if (!(brandPicks[c.id] ?? "").trim()) return false;
      if (!(recipePicks[c.id] ?? "").trim()) return false;
      // Rows where BOTH brand and recipe were unmatched need at least one side
      // to be resolved to a known pool name before they can be applied.
      if (isBothUnmatched(c)) {
        const recipeResolved = sauceRecipeNames.includes(recipePicks[c.id] ?? "");
        const brandResolved = c.brand !== null;
        if (!recipeResolved && !brandResolved) return false;
      }
      return true;
    })
    .map((c) => {
      const guideFlavors = c.flavors ?? [];
      const picks = [...(flavorPicks[c.id] ?? new Set())];
      return {
        brand: brandPicks[c.id],
        flavors: picks.length > 0 ? picks : guideFlavors,
        recipeName: recipePicks[c.id].trim(),
        ozPerPizza: c.ozPerPizza,
        wasNullBrand: c.brand === null,
        wasNullRecipe: c.matchedRecipeName === null,
      };
    });
  const requiresAcknowledgement = applyRows.some((row) => {
    const targets = row.flavors.length ? row.flavors : ["", ...(flavorsByBrand[row.brand] ?? [])];
    return targets.some((flavor) => {
      const profile = loadProfile(row.brand, flavor) as Record<string, unknown> | null;
      return profile?.frontlineRecipeName && profile.frontlineRecipeName !== row.recipeName;
    });
  });

  const confirm = () => { if (!requiresAcknowledgement || acknowledged) onConfirm(applyRows, true); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sauce-guide-import-dialog-title" className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-background border border-border shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="sauce-guide-import-dialog-title" className="font-semibold text-sm">Import Sauce Guide</h2>
          <button type="button" aria-label="Close sauce guide import" onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading sauce guide…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-destructive/10 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && candidates.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Review the sauce assignments below. Uncheck rows to skip. Adjust
                the brand, recipe, or flavor targeting as needed before applying.
              </p>
              <div className="space-y-2">
                {candidates.map((c) => {
                  const brand = brandPicks[c.id] ?? "";
                  const recipe = recipePicks[c.id] ?? c.guideName;
                  const isIncluded = selected.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`rounded-lg border p-3 space-y-2 ${isIncluded ? "border-border bg-muted/20" : "border-border/40 bg-muted/5 opacity-60"}`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isIncluded}
                          onChange={() => toggle(c.id)}
                          className="mt-0.5 h-4 w-4 accent-primary shrink-0"
                        />
                        <div className="flex-1 space-y-1.5">
                          {/* Brand row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Brand</span>
                            {c.brand ? (
                              <span className="text-sm font-semibold">{brand || c.guideBrandName}</span>
                            ) : (
                              <select
                                value={brand}
                                onChange={(e) => pickBrand(c.id, e.target.value)}
                                className="text-xs border border-border rounded px-2 py-1 bg-background max-w-[180px]"
                              >
                                <option value="">— pick brand —</option>
                                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                            )}
                            {/* Show guide brand whenever it differs from the matched brand —
                                covers both unmatched rows (amber) and fuzzy-matched sub-brands
                                like "Lucia's Craft" → "Lucia's" (muted info note). */}
                            {c.guideBrandName !== (c.brand ?? c.guideBrandName) ? (
                              <span className="text-[11px] text-muted-foreground italic">
                                guide: "{c.guideBrandName}"
                              </span>
                            ) : !c.brand ? (
                              <span className="text-[11px] text-amber-600">
                                Guide: "{c.guideBrandName}"
                              </span>
                            ) : null}
                          </div>
                          {/* Recipe row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Sauce</span>
                            {sauceRecipeNames.length > 0 ? (
                              <select
                                value={recipe}
                                onChange={(e) => setRecipePicks((p) => ({ ...p, [c.id]: e.target.value }))}
                                className="text-xs border border-border rounded px-2 py-1 bg-background max-w-[240px]"
                              >
                                {!sauceRecipeNames.includes(recipe) && (
                                  <option value={recipe}>{recipe} (guide name)</option>
                                )}
                                {sauceRecipeNames.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            ) : (
                              <span className="text-sm">{recipe}</span>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              {c.ozPerPizza} oz
                            </span>
                          </div>
                          {/* Flavor targeting */}
                          {brand && (
                            <FlavorChips
                              id={c.id}
                              brand={brand}
                              flavors={c.flavors}
                              picks={flavorPicks[c.id] ?? new Set()}
                              flavorsByBrand={flavorsByBrand}
                              onToggle={toggleFlavor}
                              onClear={clearFlavors}
                            />
                          )}
                          {!c.brand && !brand && (
                            <p className="text-[11px] text-amber-600">Pick a brand to include this row.</p>
                          )}
                          {isBothUnmatched(c) && brand && !sauceRecipeNames.includes(recipePicks[c.id] ?? "") && (
                            <p className="text-[11px] text-red-400 font-medium">
                              Neither brand nor sauce recipe was auto-matched — pick a known sauce recipe above before applying.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          {applyRows.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-amber-700">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              I reviewed the changes; existing profile assignments may be replaced.
            </label>
          )}
          <span className="text-xs text-muted-foreground">
            {prepared ? `${applyRows.length} of ${candidates.length} row${candidates.length === 1 ? "" : "s"} will apply` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted">
              Cancel
            </button>
            <button
              type="button"
              disabled={applying || loading || !!error || applyRows.length === 0 || (requiresAcknowledgement && !acknowledged)}
              onClick={confirm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {applying ? "Applying…" : "Apply Sauce Assignments"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dough Guide Dialog ───────────────────────────────────────────────────────

type DoughProps = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  prepared: DoughGuideImportPrepared | null;
  applying: boolean;
  onConfirm: (
    rows: { brand: string; flavors: string[]; doughRecipeName: string; wasNullBrand: boolean; wasNullRecipe: boolean }[],
    acknowledged: boolean,
  ) => void;
};

export function DoughGuideImportDialog({
  open, onClose, loading, error, prepared, applying, onConfirm,
}: DoughProps) {
  const dialogRef = useAccessibleDialog<HTMLDivElement>(open, onClose);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brandPicks, setBrandPicks] = useState<Record<string, string>>({});
  const [recipePicks, setRecipePicks] = useState<Record<string, string>>({});
  const [flavorPicks, setFlavorPicks] = useState<Record<string, Set<string>>>({});
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (prepared) {
      setSelected(new Set(prepared.candidates.filter((c) => c.brand).map((c) => c.id)));
      setBrandPicks(Object.fromEntries(prepared.candidates.map((c) => [c.id, c.brand ?? ""])));
      setRecipePicks(
        Object.fromEntries(
          prepared.candidates.map((c) => [c.id, c.matchedDoughRecipeName ?? c.guideName]),
        ),
      );
      setFlavorPicks({});
      setAcknowledged(false);
    } else {
      setSelected(new Set());
      setBrandPicks({});
      setRecipePicks({});
      setFlavorPicks({});
    }
  }, [prepared]);

  if (!open) return null;

  const candidates = prepared?.candidates ?? [];
  const brands = prepared?.brands ?? [];
  const flavorsByBrand = prepared?.flavorsByBrand ?? {};
  const doughRecipeNames = prepared?.doughRecipeNames ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pickBrand = (id: string, brand: string) => {
    setBrandPicks((p) => ({ ...p, [id]: brand }));
    setFlavorPicks((p) => { const n = { ...p }; delete n[id]; return n; });
    setSelected((prev) => { const n = new Set(prev); brand ? n.add(id) : n.delete(id); return n; });
  };

  const toggleFlavor = (id: string, f: string) =>
    setFlavorPicks((prev) => {
      const cur = new Set(prev[id] ?? []);
      cur.has(f) ? cur.delete(f) : cur.add(f);
      return { ...prev, [id]: cur };
    });

  const clearFlavors = (id: string) =>
    setFlavorPicks((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const applyRows = candidates
    .filter((c) => {
      if (!selected.has(c.id)) return false;
      if (!(brandPicks[c.id] ?? "").trim()) return false;
      if (!(recipePicks[c.id] ?? "").trim()) return false;
      // Rows where BOTH brand and recipe were unmatched need at least one side
      // to be resolved to a known pool name before they can be applied.
      if (isBothUnmatched(c)) {
        const recipeResolved = doughRecipeNames.includes(recipePicks[c.id] ?? "");
        const brandResolved = c.brand !== null;
        if (!recipeResolved && !brandResolved) return false;
      }
      return true;
    })
    .map((c) => {
      const guideFlavors = c.flavors ?? [];
      const picks = [...(flavorPicks[c.id] ?? new Set())];
      return {
        brand: brandPicks[c.id],
        flavors: picks.length > 0 ? picks : guideFlavors,
        doughRecipeName: recipePicks[c.id].trim(),
        wasNullBrand: c.brand === null,
        wasNullRecipe: c.matchedDoughRecipeName === null,
      };
    });
  const requiresAcknowledgement = applyRows.some((row) => {
    const targets = row.flavors.length ? row.flavors : ["", ...(flavorsByBrand[row.brand] ?? [])];
    return targets.some((flavor) => {
      const profile = loadProfile(row.brand, flavor) as Record<string, unknown> | null;
      return profile?.doughRecipeName && profile.doughRecipeName !== row.doughRecipeName;
    });
  });

  const confirm = () => { if (!requiresAcknowledgement || acknowledged) onConfirm(applyRows, true); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dough-guide-import-dialog-title" className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-background border border-border shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="dough-guide-import-dialog-title" className="font-semibold text-sm">Import Dough Recipe Guide</h2>
          <button type="button" aria-label="Close dough guide import" onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading dough recipe guide…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-destructive/10 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && candidates.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Review the dough recipe assignments below. Uncheck rows to skip.
                Adjust the brand, recipe, or flavor targeting before applying.
              </p>
              <div className="space-y-2">
                {candidates.map((c) => {
                  const brand = brandPicks[c.id] ?? "";
                  const recipe = recipePicks[c.id] ?? c.guideName;
                  const isIncluded = selected.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`rounded-lg border p-3 space-y-2 ${isIncluded ? "border-border bg-muted/20" : "border-border/40 bg-muted/5 opacity-60"}`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isIncluded}
                          onChange={() => toggle(c.id)}
                          className="mt-0.5 h-4 w-4 accent-primary shrink-0"
                        />
                        <div className="flex-1 space-y-1.5">
                          {/* Brand row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Brand</span>
                            {c.brand ? (
                              <span className="text-sm font-semibold">{brand || c.guideBrandName}</span>
                            ) : (
                              <select
                                value={brand}
                                onChange={(e) => pickBrand(c.id, e.target.value)}
                                className="text-xs border border-border rounded px-2 py-1 bg-background max-w-[180px]"
                              >
                                <option value="">— pick brand —</option>
                                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                            )}
                            {c.guideBrandName !== (c.brand ?? c.guideBrandName) ? (
                              <span className="text-[11px] text-muted-foreground italic">
                                guide: "{c.guideBrandName}"
                              </span>
                            ) : !c.brand ? (
                              <span className="text-[11px] text-amber-600">Guide: "{c.guideBrandName}"</span>
                            ) : null}
                          </div>
                          {/* Recipe row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Dough</span>
                            {doughRecipeNames.length > 0 ? (
                              <select
                                value={recipe}
                                onChange={(e) => setRecipePicks((p) => ({ ...p, [c.id]: e.target.value }))}
                                className="text-xs border border-border rounded px-2 py-1 bg-background max-w-[240px]"
                              >
                                {!doughRecipeNames.includes(recipe) && (
                                  <option value={recipe}>{recipe} (guide name)</option>
                                )}
                                {doughRecipeNames.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            ) : (
                              <span className="text-sm">{recipe}</span>
                            )}
                            <MatchBadge matched={c.matchedDoughRecipeName} guide={c.guideName} />
                          </div>
                          {/* Flavor targeting */}
                          {brand && (
                            <FlavorChips
                              id={c.id}
                              brand={brand}
                              flavors={c.flavors}
                              picks={flavorPicks[c.id] ?? new Set()}
                              flavorsByBrand={flavorsByBrand}
                              onToggle={toggleFlavor}
                              onClear={clearFlavors}
                            />
                          )}
                          {!c.brand && !brand && (
                            <p className="text-[11px] text-amber-600">Pick a brand to include this row.</p>
                          )}
                          {isBothUnmatched(c) && brand && !doughRecipeNames.includes(recipePicks[c.id] ?? "") && (
                            <p className="text-[11px] text-red-400 font-medium">
                              Neither brand nor dough recipe was auto-matched — pick a known dough recipe above before applying.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          {applyRows.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-amber-700">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              I reviewed the changes; existing profile assignments may be replaced.
            </label>
          )}
          <span className="text-xs text-muted-foreground">
            {prepared ? `${applyRows.length} of ${candidates.length} row${candidates.length === 1 ? "" : "s"} will apply` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted">
              Cancel
            </button>
            <button
              type="button"
              disabled={applying || loading || !!error || applyRows.length === 0 || (requiresAcknowledgement && !acknowledged)}
              onClick={confirm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {applying ? "Applying…" : "Apply Dough Assignments"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
