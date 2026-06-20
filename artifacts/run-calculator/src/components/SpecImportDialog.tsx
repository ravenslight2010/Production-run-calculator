import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { SpecImportPrepared } from "@/specImport";
import ReviewBadge from "./ReviewBadge";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  prepared: SpecImportPrepared | null;
  applying: boolean;
  onConfirm: () => void;
};

// Single review/summary screen for the Excel spec-sheet importer. Per product
// decision there are NO per-item prompts: the AI parses the workbook, names are
// canonicalized against the app's known lists + learned aliases, and the user
// just sees what will be created vs overwritten before confirming. Mirrors the
// mobile modal in artifacts/run-calculator-mobile (replit.md parity).
export default function SpecImportDialog({
  open,
  onClose,
  loading,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  if (!open) return null;

  const s = prepared?.summary;
  const nothing = s != null && s.totalProfiles === 0 && s.totalRecipes === 0;

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
            <h2 className="text-base font-semibold text-foreground">Import Spec Sheet</h2>
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
                Reading the workbook and interpreting spec sheets &amp; recipes…
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
                Review what will be applied. Existing brand/flavor profiles and recipes
                will be <span className="font-medium text-foreground">overwritten</span>;
                new ones will be <span className="font-medium text-foreground">added</span>.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <SummaryCard
                  label="Spec profiles"
                  total={s!.totalProfiles}
                  created={s!.profilesNew}
                  updated={s!.profilesUpdated}
                />
                <SummaryCard
                  label="Recipes"
                  total={s!.totalRecipes}
                  created={s!.recipesNew}
                  updated={s!.recipesUpdated}
                />
              </div>

              {prepared.newAliases.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {prepared.newAliases.length} new name mapping
                  {prepared.newAliases.length === 1 ? "" : "s"} will be remembered for
                  future imports.
                </p>
              )}

              {prepared.flagged.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    A second AI check flagged {prepared.flagged.length} item
                    {prepared.flagged.length === 1 ? "" : "s"} to double-check before applying:
                  </p>
                  {prepared.flagged.map((f, i) => (
                    <div key={i} className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">{f.label}</p>
                      <ReviewBadge review={f.review} />
                    </div>
                  ))}
                </div>
              )}

              {prepared.note && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Note from the parser</span>
                  </div>
                  <p className="mt-1 text-sm text-amber-700">{prepared.note}</p>
                </div>
              )}

              {nothing && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Nothing recognizable was found in this workbook. Try a different file.
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
            onClick={onConfirm}
            disabled={loading || applying || !!error || !prepared || nothing}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Apply import
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  total,
  created,
  updated,
}: {
  label: string;
  total: number;
  created: number;
  updated: number;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-2xl font-bold text-foreground">{total}</div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 flex gap-3 text-xs">
        <span className="text-green-600">{created} new</span>
        <span className="text-primary">{updated} updated</span>
      </div>
    </div>
  );
}
