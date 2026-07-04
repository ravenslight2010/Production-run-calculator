import { useEffect, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { CheeseImportCandidate } from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { CheeseImportPrepared } from "@/cheeseImport";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: CheeseImportPrepared | null;
  applying: boolean;
  /** Confirm with the reviewed cheese recipes. */
  onConfirm: (recipesToApply: CheeseRecipe[]) => void;
};

type Item = { key: string; candidate: CheeseImportCandidate };

// Review screen for the "Cheese Mix Recipe Specs" importer. Each customer tab is
// parsed deterministically into cheese recipes (shredder setting, per-flavor
// assignment lines, per-batch pounds). The manager reviews every parsed recipe
// and can include/exclude each one before confirming. Mirrors the mobile modal
// in artifacts/run-calculator-mobile (replit.md parity).
export default function CheeseImportDialog({
  open,
  onClose,
  loading,
  progress,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (prepared) {
      setItems(prepared.candidates.map((c) => ({ key: c.recipe.id, candidate: c })));
      setSelected(new Set(prepared.candidates.map((c) => c.recipe.id)));
    } else {
      setItems([]);
      setSelected(new Set());
    }
  }, [prepared]);

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

  const confirm = () => {
    const included = items.filter((it) => selected.has(it.key));
    onConfirm(included.map((it) => it.candidate.recipe));
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
            <h2 className="text-base font-semibold text-foreground">Import Cheese Recipes</h2>
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
                  ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and reading cheese sheets…`
                  : "Reading the workbook and building cheese recipes from each tab…"}
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
                Review each cheese recipe below. Uncheck any you don't want.
                Checked recipes marked{" "}
                <span className="font-medium text-foreground">update</span> will
                replace the existing recipe;{" "}
                <span className="font-medium text-foreground">new</span> ones will
                be added.
              </p>

              <div className="rounded-lg border border-border p-3">
                <div className="text-2xl font-bold text-foreground">{selectedCount}</div>
                <div className="text-xs font-medium text-muted-foreground">
                  of {s!.total} recipes selected
                </div>
              </div>

              {items.length > 0 && (
                <ul className="space-y-2">
                  {items.map((it) => {
                    const c = it.candidate;
                    const r = c.recipe;
                    const isSel = selected.has(it.key);
                    return (
                      <li
                        key={it.key}
                        className="rounded-lg border border-border p-3"
                        data-testid={`cheese-candidate-${it.key}`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(it.key)}
                            className="mt-1 h-4 w-4 accent-primary"
                            aria-label={`Include ${r.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {r.name}
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

                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {r.brand && (
                                <span>
                                  Customer:{" "}
                                  <span className="text-foreground">{r.brand}</span>
                                </span>
                              )}
                              {r.shredderSetting && (
                                <span>
                                  Shredder:{" "}
                                  <span className="text-foreground">{r.shredderSetting}</span>
                                </span>
                              )}
                              <span>
                                {r.components.length} ingredient
                                {r.components.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            {r.flavors.length > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Flavors:{" "}
                                <span className="text-foreground">
                                  {r.flavors.join(", ")}
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
                  No cheese recipes were found in this workbook. Try a different file.
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
            Apply {selectedCount > 0 ? selectedCount : ""} recipe
            {selectedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
