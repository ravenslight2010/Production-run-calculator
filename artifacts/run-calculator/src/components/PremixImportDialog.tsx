import { useEffect, useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { rematchPremixCandidate, type PremixCandidate } from "@workspace/premix-import";
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
  /** Confirm with the reviewed mixes the manager chose to apply. */
  onConfirm: (mixesToApply: Mix[]) => void;
};

// Local stable handle for a reviewable mix: a key that survives a re-match (the
// candidate's own id changes when its product changes) plus the current
// candidate value. Keyed by the original parsed id so selection state sticks.
type Item = { key: string; candidate: PremixCandidate };

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

  // Reset the review state whenever a fresh prepared result arrives.
  useEffect(() => {
    if (prepared) {
      setItems(prepared.candidates.map((c) => ({ key: c.mix.id, candidate: c })));
      setSelected(new Set(prepared.candidates.map((c) => c.mix.id)));
    } else {
      setItems([]);
      setSelected(new Set());
    }
  }, [prepared]);

  const existing = useMemo(
    () => new Set(prepared?.existingIds ?? []),
    [prepared],
  );

  if (!open) return null;

  const s = prepared?.summary;
  const nothing = s != null && s.total === 0;
  const selectedCount = items.filter((it) => selected.has(it.key)).length;

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
              key,
              candidate: rematchPremixCandidate(it.candidate, brand, flavor, (id) =>
                existing.has(id),
              ),
            }
          : it,
      ),
    );

  const brands = prepared?.brands ?? [];
  const flavorsByBrand = prepared?.flavorsByBrand ?? {};

  const confirm = () => {
    const mixes = items.filter((it) => selected.has(it.key)).map((it) => it.candidate.mix);
    onConfirm(mixes);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
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

                            {/* Re-match: brand + flavor pickers (correct a wrong AI/auto match). */}
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
                            {!m.brand && (
                              <div className="mt-1 text-xs text-amber-600">
                                No product match — pick a brand or it won't match a run.
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
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
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
            disabled={loading || applying || !!error || !prepared || nothing || selectedCount === 0}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Apply {selectedCount > 0 ? selectedCount : ""} mix
            {selectedCount === 1 ? "" : "es"}
          </button>
        </div>
      </div>
    </div>
  );
}
