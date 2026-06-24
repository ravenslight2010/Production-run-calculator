import { useEffect, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
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
  /** Confirm with the ids the manager chose to apply. */
  onConfirm: (selectedIds: string[]) => void;
};

// Review screen for the Excel premix-sheet importer. Each tab/block is parsed
// deterministically into a Mix and product names are matched against the app's
// known lists (AI only disambiguates names). The manager reviews every parsed
// mix — its matched product, batch size, components and days-early note — and
// can include/exclude each one before confirming. Mirrors the mobile modal in
// artifacts/run-calculator-mobile (replit.md parity).
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
  // Selected mix ids (default: all parsed mixes are selected for apply).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset the selection whenever a fresh prepared result arrives.
  useEffect(() => {
    if (prepared) setSelected(new Set(prepared.candidates.map((c) => c.mix.id)));
    else setSelected(new Set());
  }, [prepared]);

  if (!open) return null;

  const s = prepared?.summary;
  const nothing = s != null && s.total === 0;
  const candidates = prepared?.candidates ?? [];
  const selectedCount = candidates.filter((c) => selected.has(c.mix.id)).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
                Review each mix below and uncheck any you don't want. Checked mixes
                marked <span className="font-medium text-foreground">update</span> will
                replace the existing mix; <span className="font-medium text-foreground">new</span>{" "}
                ones will be added.
              </p>

              <div className="rounded-lg border border-border p-3">
                <div className="text-2xl font-bold text-foreground">{selectedCount}</div>
                <div className="text-xs font-medium text-muted-foreground">
                  of {s!.total} mixes selected
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  <span className="text-green-600">{s!.created} new</span>
                  <span className="text-primary">{s!.updated} updated</span>
                </div>
              </div>

              {candidates.length > 0 && (
                <ul className="space-y-2">
                  {candidates.map((c) => {
                    const m = c.mix;
                    const isSel = selected.has(m.id);
                    const product = [m.brand, m.flavor].filter(Boolean).join(" — ");
                    return (
                      <li
                        key={m.id}
                        className="rounded-lg border border-border p-3"
                        data-testid={`premix-candidate-${m.id}`}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(m.id)}
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
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {product ? `Matched to ${product}` : "No product match"}
                            </div>
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
                        </label>
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
            onClick={onClose}
            disabled={applying}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm([...selected])}
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
