import { useEffect, useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";
import {
  rematchPremixCandidate,
  redirectPremixCandidate,
  type PremixCandidate,
  type PremixFreezerPull,
  type SpecImportAlias,
} from "@workspace/premix-import";
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
   * plus any name mappings the "use existing mix" picks should be remembered as.
   */
  onConfirm: (
    mixesToApply: Mix[],
    freezerPulls: PremixFreezerPull[],
    newAliases: SpecImportAlias[],
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
  // "Use existing mix instead" picks: stable key → existing mix id ("" = none).
  const [redirects, setRedirects] = useState<Map<string, string>>(new Map());

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
      const existsById = (id: string) => prepared.existingIds.includes(id);
      const nextRedirects = new Map<string, string>();
      setItems(
        prepared.candidates.map((c) => {
          const key = c.mix.id;
          const suggestedId = prepared.redirectSuggestions?.[key];
          const target = suggestedId
            ? (prepared.existingMixes ?? []).find((m) => m.id === suggestedId)
            : undefined;
          if (target) {
            nextRedirects.set(key, target.id);
            return { key, candidate: redirectPremixCandidate(c, target, existsById), original: c };
          }
          return { key, candidate: c, original: c };
        }),
      );
      setSelected(new Set(prepared.candidates.map((c) => c.mix.id)));
      setRedirects(nextRedirects);
    } else {
      setItems([]);
      setSelected(new Set());
      setRedirects(new Map());
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

  // Two included rows resolving to the SAME saved mix would collide in the
  // upsert-by-id merge and silently drop one row's data — block Apply until the
  // manager changes one of the picks.
  const includedItems = items.filter((it) => selected.has(it.key));
  const finalIdCounts = new Map<string, number>();
  for (const it of includedItems) {
    const id = it.candidate.mix.id;
    finalIdCounts.set(id, (finalIdCounts.get(id) ?? 0) + 1);
  }
  const duplicateTargets = [...finalIdCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => existingMixById.get(id)?.name ?? items.find((it) => it.candidate.mix.id === id)?.candidate.mix.name ?? id);

  const confirm = () => {
    if (duplicateTargets.length > 0) return;
    const included = includedItems;
    const mixes = included.map((it) => it.candidate.mix);
    // Freezer-pull settings ride along with their mix's include/exclude pick
    // (keyed by the ORIGINAL parsed id — a re-match doesn't change the note).
    const includedPulls = included.flatMap(
      (it) => prepared?.freezerPulls?.[it.key] ?? [],
    );
    // Remember each MANUAL/kept "use existing mix" pick as a blend-name alias
    // so re-importing the same sheet pre-applies the same redirect.
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
      const dedupeKey = external.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      newAliases.push({
        kind: "appType",
        externalName: external,
        canonicalName: canonical,
        context: null,
      });
    }
    // Prep-only blocks contribute their pull notes unconditionally.
    onConfirm(mixes, [...includedPulls, ...orphanPulls], newAliases);
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

              {items.length > 0 && (
                <ul className="space-y-2">
                  {items.map((it) => {
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
                            {redirectTarget && (
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
                                {m.components.length} ingredient
                                {m.components.length === 1 ? "" : "s"}
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
              )}

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
              duplicateTargets.length > 0
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
