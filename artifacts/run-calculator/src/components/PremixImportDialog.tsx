import { useEffect, useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";
import {
  rematchPremixCandidate,
  redirectPremixCandidate,
  type PremixCandidate,
  type PremixFreezerPull,
  type SpecImportAlias,
} from "@workspace/premix-import";
import { isCelluloseIngredient } from "@workspace/mixes";
import type { Mix } from "@workspace/mixes";
import type { PremixImportPrepared } from "@/premixImport";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: PremixImportPrepared | null;
  applying: boolean;
  /**
   * Confirm with the reviewed mixes (and their pull-note freezer settings),
   * plus any name mappings the "use existing mix" picks should be remembered as,
   * and the ids of absent mixes the manager chose to remove.
   */
  onConfirm: (
    mixesToApply: Mix[],
    freezerPulls: PremixFreezerPull[],
    newAliases: SpecImportAlias[],
    mixesToRemove: string[],
    destructiveChangesAcknowledged: boolean,
  ) => void;
};

// Local stable handle for a reviewable mix: a key that survives a re-match (the
// candidate's own id changes when its product changes) plus the current
// candidate value. Keyed by the original parsed id so selection state sticks
// (and so freezer-pull notes — keyed by the original parsed id — stay attached
// even after a redirect onto an existing mix changes the candidate's id).
// `original` keeps the untouched parsed candidate so clearing a redirect
// restores the sheet's own product/name.
type Item = { key: string; candidate: PremixCandidate; original: PremixCandidate };

// Review screen for the Excel premix-sheet importer. Each tab/block is parsed
// deterministically into a Mix and product names are matched against the app's
// known lists (AI only disambiguates names). The manager reviews every parsed
// mix — its matched product, batch size, components and days-early note — and
// can include/exclude or re-match (correct a wrong product) each one before
// confirming. Mirrors the mobile modal in artifacts/run-calculator-mobile
// (replit.md parity).
export default function PremixImportDialog({
  open,
  onClose,
  loading,
  progress,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  // Editable per-mix review list and the selected (included) stable keys.
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Absent-mix ids the manager wants to remove on confirm.
  const [removedMixes, setRemovedMixes] = useState<Set<string>>(new Set());
  // "Use existing mix instead" picks: stable key → existing mix id ("" = none).
  const [redirects, setRedirects] = useState<Map<string, string>>(new Map());
  // Merge-re-import rows: this sheet block's name was previously MERGED onto an
  // existing mix (learned-alias redirect suggestion) whose OWN sheet block is
  // also present in this workbook as an exact update. Both rows would target
  // the same saved mix, so the merged-away one starts UNCHECKED with an
  // explanatory note instead of tripping the generic duplicate-target block.
  const [mergedAwayKeys, setMergedAwayKeys] = useState<Set<string>>(new Set());
  const [destructiveChangesConfirmed, setDestructiveChangesConfirmed] = useState(false);

  const existing = useMemo(
    () => new Set(prepared?.existingIds ?? []),
    [prepared],
  );

  const existingMixById = useMemo(
    () => new Map((prepared?.existingMixes ?? []).map((m) => [m.id, m])),
    [prepared],
  );

  // Reset the review state whenever a fresh prepared result arrives, and
  // pre-apply any learned-alias redirect suggestions (a "use existing mix" pick
  // the manager made in a past import of the same sheet name). Keys stay the
  // ORIGINAL parsed ids so freezer-pull notes and selection survive.
  useEffect(() => {
    if (prepared) {
      setDestructiveChangesConfirmed(false);
      const existsById = (id: string) => prepared.existingIds.includes(id);
      const nextRedirects = new Map<string, string>();
      // Detect the merge-re-import case: a suggested-redirect row whose target
      // mix is ALSO present in this workbook as its own exact-id update. The
      // merged-away row starts unchecked so Apply isn't blocked by default.
      const candidateIds = new Set(prepared.candidates.map((c) => c.mix.id));
      const mergedAway = new Set<string>();
      setItems(
        prepared.candidates.map((c) => {
          const key = c.mix.id;
          const suggestedId = prepared.redirectSuggestions?.[key];
          const target = suggestedId
            ? (prepared.existingMixes ?? []).find((m) => m.id === suggestedId)
            : undefined;
          if (target) {
            nextRedirects.set(key, target.id);
            if (candidateIds.has(target.id)) mergedAway.add(key);
            return { key, candidate: redirectPremixCandidate(c, target, existsById), original: c };
          }
          return { key, candidate: c, original: c };
        }),
      );
      setMergedAwayKeys(mergedAway);
      setSelected(
        new Set(
          prepared.candidates
            .map((c) => c.mix.id)
            .filter((id) => !mergedAway.has(id)),
        ),
      );
      setRedirects(nextRedirects);
    } else {
      setDestructiveChangesConfirmed(false);
      setItems([]);
      setSelected(new Set());
      setRemovedMixes(new Set());
      setRedirects(new Map());
      setMergedAwayKeys(new Set());
    }
  }, [prepared]);

  if (!open) return null;

  const s = prepared?.summary;
  const selectedCount = items.filter((it) => selected.has(it.key)).length;

  // Pull-note reminders from prep-only blocks (blocks that produced no mix
  // candidate). They have no mix checkbox to gate on, so they always ride
  // along when the manager applies the import.
  const orphanPulls = (() => {
    const fp = prepared?.freezerPulls ?? {};
    const candidateKeys = new Set(prepared?.candidates.map((c) => c.mix.id) ?? []);
    return Object.entries(fp)
      .filter(([k]) => !candidateKeys.has(k))
      .flatMap(([, v]) => v);
  })();

  const hasPrepInfo =
    (prepared?.prepItems?.length ?? 0) > 0 || orphanPulls.length > 0;
  const nothing = s != null && s.total === 0 && !hasPrepInfo;
  const canApply = selectedCount > 0 || orphanPulls.length > 0;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Re-point a candidate to a different brand/flavor. The mix id is rebuilt and
  // its new-vs-update status recomputed; the manager's include/exclude pick (the
  // stable key) is preserved.
  const rematch = (key: string, brand: string, flavor: string) =>
    setItems((prev) =>
      prev.map((it) =>
        it.key === key
          ? {
              ...it,
              candidate: rematchPremixCandidate(it.candidate, brand, flavor, (id) =>
                existing.has(id),
              ),
            }
          : it,
      ),
    );

  const brands = prepared?.brands ?? [];
  const flavorsByBrand = prepared?.flavorsByBrand ?? {};

  // Point a candidate at an existing saved mix (or clear back to the sheet's
  // own parsed identity when targetId is ""). Selection/pull notes stay keyed
  // by the original parsed id, so only the candidate value changes.
  const redirect = (key: string, targetId: string) => {
    const target = targetId ? existingMixById.get(targetId) : undefined;
    setRedirects((prev) => {
      const next = new Map(prev);
      if (target) next.set(key, target.id);
      else next.delete(key);
      return next;
    });
    setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        if (target) {
          return {
            ...it,
            candidate: redirectPremixCandidate(it.original, target, (id) => existing.has(id)),
          };
        }
        return { ...it, candidate: it.original };
      }),
    );
  };

  const includedItems = items.filter((it) => selected.has(it.key));
  const destructiveChanges = [
    ...includedItems.map((it) => {
      const current = existingMixById.get(it.candidate.mix.id);
      return current && JSON.stringify(current.components ?? []) !== JSON.stringify(it.candidate.mix.components ?? [])
        ? `Replaces the formula for "${current.name}".`
        : null;
    }).filter((message): message is string => !!message),
    ...[...removedMixes].map((id) => `Removes "${existingMixById.get(id)?.name ?? id}".`),
  ];
  const requiresDestructiveConfirmation = destructiveChanges.length > 0;

  // Count how many included items resolve to each target mix id.
  const finalIdCounts = new Map<string, number>();
  for (const it of includedItems) {
    const id = it.candidate.mix.id;
    finalIdCounts.set(id, (finalIdCounts.get(id) ?? 0) + 1);
  }
  // Collisions onto PREP mixes are safe — their components are merged below.
  // Collisions onto regular brand/flavor mixes would silently drop one block's
  // data, so block Apply for those until the manager resolves the conflict.
  const duplicateTargets = [...finalIdCounts.entries()]
    .filter(([id, n]) => {
      if (n <= 1) return false;
      const target = existingMixById.get(id);
      return !target?.isPrep;
    })
    .map(
      ([id]) =>
        existingMixById.get(id)?.name ??
        items.find((it) => it.candidate.mix.id === id)?.candidate.mix.name ??
        id,
    );

  const confirm = () => {
    if (duplicateTargets.length > 0 || (requiresDestructiveConfirmation && !destructiveChangesConfirmed)) return;
    const included = includedItems;
    // When multiple candidates redirect to the same PREP mix (e.g. several
    // customer-specific blocks for the same ingredient), merge their components
    // rather than letting last-write-wins silently drop one block's ingredients.
    // Regular brand/flavor mix collisions are already blocked above.
    // Union by ingredient name (case-insensitive); keep the higher perPizza for
    // any ingredient that appears in more than one block.
    const byId = new Map<string, Mix>();
    for (const it of included) {
      const mix = it.candidate.mix;
      const prev = byId.get(mix.id);
      if (!prev) {
        byId.set(mix.id, { ...mix, components: [...mix.components] });
      } else {
        const merged = [...prev.components];
        for (const c of mix.components) {
          const key = c.ingredient.trim().toLowerCase();
          const idx = merged.findIndex(
            (mc) => mc.ingredient.trim().toLowerCase() === key,
          );
          if (idx === -1) {
            merged.push(c);
          } else if (c.perPizza > merged[idx].perPizza) {
            merged[idx] = c;
          }
        }
        byId.set(mix.id, { ...prev, components: merged });
      }
    }
    const mixes = [...byId.values()];
    // Freezer-pull settings ride along with their mix's include/exclude pick
    // (keyed by the ORIGINAL parsed id — a re-match doesn't change the note).
    const includedPulls = included.flatMap(
      (it) => prepared?.freezerPulls?.[it.key] ?? [],
    );
    // Remember each MANUAL/kept "use existing mix" pick as a blend-name alias
    // so re-importing the same sheet pre-applies the same redirect. Both a
    // brand-scoped row (context = the sheet block's brand — only fires on that
    // customer's re-imports) and the shared context-free fallback are written.
    const newAliases: SpecImportAlias[] = [];
    const seen = new Set<string>();
    for (const it of included) {
      const targetId = redirects.get(it.key);
      const target = targetId ? existingMixById.get(targetId) : undefined;
      if (!target) continue;
      const external = it.original.mix.name.trim();
      const canonical = target.name.trim();
      if (!external || !canonical) continue;
      if (external.toLowerCase() === canonical.toLowerCase()) continue;
      const brand = (it.original.mix.brand ?? "").trim();
      for (const context of brand ? [brand, null] : [null]) {
        const dedupeKey = `${external.toLowerCase()}\u0000${(context ?? "").toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        newAliases.push({
          kind: "appType",
          externalName: external,
          canonicalName: canonical,
          context,
        });
      }
    }
    // Prep-only blocks contribute their pull notes unconditionally.
    onConfirm(mixes, [...includedPulls, ...orphanPulls], newAliases, [...removedMixes], destructiveChangesConfirmed);
  };

  return (
    <div
      // No close-on-backdrop-click: the AI parse is slow and the review step
      // holds unsaved edits — a stray tap would silently cancel the import.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Import Premix Sheet</h2>
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
                  ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and reading premix sheets…`
                  : "Reading the workbook and building mixes from each tab…"}
              </p>
              <p className="text-xs text-muted-foreground/80">
                If the app sat idle, the server may need a moment to wake up first.
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
              <p className="text-sm text-muted-foreground">
                Review each mix below. Uncheck any you don't want, or fix a wrong
                product match. Checked mixes marked{" "}
                <span className="font-medium text-foreground">update</span> will
                replace the existing mix; <span className="font-medium text-foreground">new</span>{" "}
                ones will be added.
              </p>

              <div className="rounded-lg border border-border p-3">
                <div className="text-2xl font-bold text-foreground">{selectedCount}</div>
                <div className="text-xs font-medium text-muted-foreground">
                  of {s!.total} mixes selected
                </div>
              </div>

              {items.length > 0 && (() => {
                // Group items by resolved brand so each customer's mixes are
                // shown together under a heading — the same pattern cheese import
                // uses for customer tabs. Unbranded items go in a trailing group.
                const grouped: { brand: string; items: typeof items }[] = [];
                const brandOrder: string[] = [];
                const byBrand = new Map<string, typeof items>();
                for (const it of items) {
                  const b = it.candidate.mix.brand.trim() || "";
                  if (!byBrand.has(b)) {
                    byBrand.set(b, []);
                    brandOrder.push(b);
                  }
                  byBrand.get(b)!.push(it);
                }
                for (const b of brandOrder) grouped.push({ brand: b, items: byBrand.get(b)! });
                const showHeadings = grouped.length > 1 || (grouped[0]?.brand ?? "") !== "";
                return (
                  <div className="space-y-4">
                    {grouped.map(({ brand, items: groupItems }) => (
                      <div key={brand || "__no_brand__"}>
                        {showHeadings && (
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {brand || "No customer"}
                          </p>
                        )}
                        <ul className="space-y-2">
                          {groupItems.map((it) => {
                    const c = it.candidate;
                    const m = c.mix;
                    const isSel = selected.has(it.key);
                    const flavorOpts = m.brand ? flavorsByBrand[m.brand] ?? [] : [];
                    const redirectId = redirects.get(it.key) ?? "";
                    const redirectTarget = redirectId
                      ? existingMixById.get(redirectId)
                      : undefined;
                    return (
                      <li
                        key={it.key}
                        className="rounded-lg border border-border p-3"
                        data-testid={`premix-candidate-${it.key}`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(it.key)}
                            className="mt-1 h-4 w-4 accent-primary"
                            aria-label={`Include ${m.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {m.name}
                              </span>
                              <span
                                className={
                                  c.status === "new"
                                    ? "shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-600"
                                    : "shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary"
                                }
                              >
                                {c.status}
                              </span>
                            </div>

                            {/* Re-match: brand + flavor pickers (correct a wrong AI/auto
                                match). Hidden while redirected onto an existing mix —
                                the target's own product wins. */}
                            {!redirectTarget && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <select
                                  value={m.brand}
                                  onChange={(e) => rematch(it.key, e.target.value, "")}
                                  aria-label={`Brand for ${m.name}`}
                                  data-testid={`premix-brand-${it.key}`}
                                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                >
                                  <option value="">No brand</option>
                                  {brands.map((b) => (
                                    <option key={b} value={b}>
                                      {b}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={m.flavor}
                                  onChange={(e) => rematch(it.key, m.brand, e.target.value)}
                                  disabled={!m.brand}
                                  aria-label={`Flavor for ${m.name}`}
                                  data-testid={`premix-flavor-${it.key}`}
                                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                                >
                                  <option value="">No flavor</option>
                                  {flavorOpts.map((f) => (
                                    <option key={f} value={f}>
                                      {f}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {!redirectTarget && !m.brand && (
                              <div className="mt-1 text-xs text-amber-600">
                                No product match — pick a brand or it won't match a run.
                              </div>
                            )}
                            {(prepared?.existingMixes?.length ?? 0) > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <label
                                  className="text-xs text-muted-foreground"
                                  htmlFor={`premix-redirect-${it.key}`}
                                >
                                  Use existing mix:
                                </label>
                                <select
                                  id={`premix-redirect-${it.key}`}
                                  value={redirectId}
                                  onChange={(e) => redirect(it.key, e.target.value)}
                                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                  data-testid={`premix-redirect-${it.key}`}
                                >
                                  <option value="">No — import as shown above</option>
                                  {(prepared?.existingMixes ?? []).map((em) => (
                                    <option key={em.id} value={em.id}>
                                      {em.name}
                                      {em.brand
                                        ? ` (${em.brand}${em.flavor ? ` · ${em.flavor}` : ""})`
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {redirectTarget && mergedAwayKeys.has(it.key) && (
                              <div
                                className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-500/10 p-2"
                                data-testid={`premix-merged-away-${it.key}`}
                              >
                                <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span className="text-xs text-amber-700">
                                  This sheet was merged into{" "}
                                  <span className="font-medium">"{redirectTarget.name}"</span>
                                  , which is also in this workbook — so it's left
                                  unchecked. Check it only if you want it to
                                  overwrite that mix.
                                </span>
                              </div>
                            )}
                            {redirectTarget && !mergedAwayKeys.has(it.key) && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-blue-400/50 bg-blue-500/10 p-2">
                                <Link2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                <span className="text-xs text-blue-700">
                                  Will update your existing{" "}
                                  <span className="font-medium">"{redirectTarget.name}"</span>{" "}
                                  with this sheet's ingredients — and remember this
                                  choice for future imports.
                                </span>
                              </div>
                            )}

                            {(() => {
                              const existingComponents = existingMixById.get(m.id)?.components ?? [];
                              const importedIngredientKeys = new Set(m.components.map(c => c.ingredient.trim().toLowerCase()).filter(Boolean));
                              const removedComponents = c.status === "update"
                                ? existingComponents.filter(ec =>
                                    !isCelluloseIngredient(ec.ingredient) &&
                                    !importedIngredientKeys.has(ec.ingredient.trim().toLowerCase()),
                                  )
                                : [];
                              return removedComponents.length > 0 ? (
                                <div
                                  className="mt-2 rounded-md border border-amber-400/60 bg-amber-500/10 p-2 text-xs text-amber-700"
                                  data-testid={`premix-removed-components-${it.key}`}
                                >
                                  Removes {removedComponents.length} ingredient{removedComponents.length === 1 ? "" : "s"} no longer in the sheet:{" "}
                                  {removedComponents.map((rc, i) => (
                                    <span key={rc.ingredient}>
                                      <span className="line-through">{rc.ingredient}</span>
                                      {i < removedComponents.length - 1 ? ", " : ""}
                                    </span>
                                  ))}
                                </div>
                              ) : null;
                            })()}
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              <span>
                                Batch:{" "}
                                <span className="text-foreground">
                                  {m.batchSize.toLocaleString(undefined, {
                                    maximumFractionDigits: 4,
                                  })}{" "}
                                  lbs
                                </span>
                              </span>
                              <span>
                                {(() => {
                                  const existingComponents = existingMixById.get(m.id)?.components ?? [];
                                  if (c.status === "update" && existingComponents.length > 0 && existingComponents.length !== m.components.length) {
                                    return <>{existingComponents.length} → <span className="text-foreground">{m.components.length}</span> ingredient{m.components.length === 1 ? "" : "s"}</>;
                                  }
                                  return <>{m.components.length} ingredient{m.components.length === 1 ? "" : "s"}</>;
                                })()}
                              </span>
                              {m.daysEarly > 0 && (
                                <span>
                                  Pull{" "}
                                  <span className="text-foreground">{m.daysEarly}</span> day
                                  {m.daysEarly === 1 ? "" : "s"} early
                                </span>
                              )}
                            </div>
                            {m.notes && (
                              <div className="mt-1 text-xs italic text-muted-foreground">
                                {m.notes}
                              </div>
                            )}
                            {(prepared?.freezerPulls?.[it.key] ?? []).length > 0 && (
                              <div
                                className="mt-1 text-xs text-muted-foreground"
                                data-testid={`premix-freezer-pull-${it.key}`}
                              >
                                Sets freezer-pull reminder:{" "}
                                <span className="text-foreground">
                                  {(prepared?.freezerPulls?.[it.key] ?? [])
                                    .map(
                                      (p) =>
                                        `${p.ingredient} (${p.daysEarly} day${p.daysEarly === 1 ? "" : "s"} early)`,
                                    )
                                    .join(", ")}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {prepared.prepItems.length > 0 && (
                <div
                  className="rounded-md border border-border bg-muted/40 p-3"
                  data-testid="premix-prep-items"
                >
                  <p className="text-sm font-medium text-foreground">
                    Prep / pull-early items ({prepared.prepItems.length})
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Items that need run-day prep. Batch-only rows are left out of the
                    mixes above; items tagged “stays in mix” are still per-pizza
                    ingredients that also need prepping (e.g. drain the juices). Manage
                    them in Freezer Pull / prep.
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {prepared.prepItems.map((p, i) => (
                      <li key={`${p.mixName}-${p.ingredient}-${i}`}>
                        <span className="text-foreground">{p.ingredient}</span>
                        {p.perBatch > 0 && <> — {p.perBatch} lbs/batch</>}
                        {p.mixName && <> · from {p.mixName}</>}
                        {p.alsoInMix && (
                          <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                            stays in mix — prep before use
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(prepared.absentMixes?.length ?? 0) > 0 && (
                <div
                  className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3"
                  data-testid="premix-absent-mixes"
                >
                  <p className="text-sm font-medium text-amber-700">
                    No longer in workbook ({prepared.absentMixes.length})
                  </p>
                  <p className="mt-1 text-xs text-amber-700/80">
                    These saved mixes share a brand with the imported file but are not in
                    it. Check the boxes to remove them, or leave unchecked to keep them.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {prepared.absentMixes.map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`absent-mix-${m.id}`}
                          checked={removedMixes.has(m.id)}
                          onChange={() =>
                            setRemovedMixes((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            })
                          }
                          className="h-4 w-4 rounded border-amber-400 accent-amber-600"
                        />
                        <label
                          htmlFor={`absent-mix-${m.id}`}
                          className="text-xs text-amber-800 cursor-pointer"
                        >
                          {m.name}
                          {m.brand && <> · {m.brand}</>}
                          {m.flavor && <> · {m.flavor}</>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {duplicateTargets.length > 0 && (
                <div
                  className="rounded-md border border-destructive/60 bg-destructive/10 p-3"
                  data-testid="premix-duplicate-target-warning"
                >
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      Two mixes point at the same saved mix
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-destructive/90">
                    More than one checked mix would update{" "}
                    {duplicateTargets.map((n) => `"${n}"`).join(", ")} — only one
                    would survive. Change one of the "Use existing mix" picks (or
                    uncheck one) before applying.
                  </p>
                  {includedItems.some((it) => mergedAwayKeys.has(it.key)) && (
                    <p className="mt-1 text-sm text-destructive/90" data-testid="premix-merge-hint">
                      Tip: these sheets were merged in Manage Lists — uncheck
                      the old (merged-away) sheet's row to apply.
                    </p>
                  )}
                </div>
              )}

              {prepared.newAliases.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {prepared.newAliases.length} new name mapping
                  {prepared.newAliases.length === 1 ? "" : "s"} will be remembered for
                  future imports.
                </p>
              )}

              {prepared.note && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Note</span>
                  </div>
                  <p className="mt-1 text-sm text-amber-700">{prepared.note}</p>
                </div>
              )}

              {nothing && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  No premix blocks were found in this workbook. Try a different file.
                </div>
              )}
              {requiresDestructiveConfirmation && (
                <label className="flex cursor-pointer items-start gap-2 rounded border border-amber-400/60 bg-amber-500/10 p-3 text-xs text-amber-900" data-testid="premix-import-destructive-confirmation">
                  <input type="checkbox" checked={destructiveChangesConfirmed} onChange={(event) => setDestructiveChangesConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
                  <span><b>Review required.</b> {destructiveChanges.slice(0, 3).join(" ")} I want to apply these shared mix changes.</span>
                </label>
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
          <button
            type="button"
            onClick={confirm}
            disabled={
              loading ||
              applying ||
              !!error ||
              !prepared ||
              nothing ||
              !canApply ||
               duplicateTargets.length > 0 ||
               (requiresDestructiveConfirmation && !destructiveChangesConfirmed)
            }
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {selectedCount > 0
              ? `Apply ${selectedCount} mix${selectedCount === 1 ? "" : "es"}`
              : "Apply pull items"}
          </button>
        </div>
      </div>
    </div>
  );
}
