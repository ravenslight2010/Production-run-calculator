import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Search, X } from "lucide-react";
import type { ImportEntityChange } from "@workspace/spec-import/import-changes";
import {
  finishImportSafetyReview,
  subscribeImportSafetyReview,
  resetImportReviewIdentity,
  type ImportSafetyReview,
} from "../importSafetyReview";
import { useAccessibleDialog } from "./useAccessibleDialog";
import { useAuth } from "../useAuth";

type Action = ImportEntityChange["action"];
const ACTIONS: Action[] = ["create", "change", "link", "remove"];
const ACTION_LABEL: Record<Action, string> = { create: "Created", change: "Changed", link: "Linked", remove: "Removed" };
const ACTION_STYLE: Record<Action, string> = {
  create: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  change: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  link: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  remove: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
};

function formatValue(value: unknown): { text: string; unknown: boolean } {
  if (value === undefined || value === null) return { text: "Unknown / not supplied", unknown: true };
  if (typeof value === "string") return value.trim() === "" ? { text: "Unknown / not supplied", unknown: true } : { text: value, unknown: false };
  if (typeof value === "number" || typeof value === "boolean") return { text: String(value), unknown: false };
  try { return { text: JSON.stringify(value), unknown: false }; } catch { return { text: String(value), unknown: false }; }
}

function Value({ value, unit }: { value: unknown; unit?: string }) {
  const v = formatValue(value);
  if (v.unknown) return <span className="italic text-muted-foreground">{v.text}</span>;
  return (
    <span className="font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">
      {v.text}{unit ? <span className="ml-1 font-sans text-[11px] text-muted-foreground">{unit}</span> : null}
    </span>
  );
}

function totals(changes: ImportEntityChange[]) {
  const t: Record<Action, number> = { create: 0, change: 0, link: 0, remove: 0 };
  for (const c of changes) t[c.action] += 1;
  return t;
}

function matches(c: ImportEntityChange, q: string) {
  if (!q) return true;
  const hay = [c.entity, c.key, c.label, c.action, ...c.fields.flatMap((f) => [f.field, formatValue(f.before).text, formatValue(f.after).text, f.unit ?? ""])]
    .join(" ").toLowerCase();
  return hay.includes(q);
}

function ChangeList({ id, title, description, changes }: { id: string; title: string; description: string; changes: ImportEntityChange[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Action | "all">("all");
  const t = totals(changes);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => changes.filter((c) => (filter === "all" || c.action === filter) && matches(c, q)), [changes, filter, q]);

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-2">
      <div className="responsive-section-heading">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{changes.length} record{changes.length === 1 ? "" : "s"}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${title} filter by action`}>
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}
          className={`min-h-9 rounded-full border px-2.5 text-xs ${filter === "all" ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-muted"}`}>
          All {changes.length}
        </button>
        {ACTIONS.map((a) => (
          <button key={a} type="button" aria-pressed={filter === a} onClick={() => setFilter(a)}
            className={`min-h-9 rounded-full border px-2.5 text-xs ${ACTION_STYLE[a]} ${filter === a ? "ring-2 ring-primary/60 font-semibold" : ""}`}>
            {ACTION_LABEL[a]} {t[a]}
          </button>
        ))}
      </div>
      {changes.length > 0 && (
        <label className="relative block">
          <span className="sr-only">Search {title}</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipe, profile, field, value…"
            className="min-h-10 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" />
        </label>
      )}
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        Showing {shown.length} of {changes.length}{shown.length < changes.length ? " (filtered — nothing is hidden by a limit)" : ""}
      </p>
      <div className="max-h-[45dvh] overflow-y-auto overscroll-contain rounded-md border border-border" tabIndex={0} aria-label={`${title} list`}>
        {changes.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No records in this section.</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No records match this search or filter.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((c, i) => (
              <li key={`${c.entity}:${c.key}:${i}`} className="p-2.5 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ACTION_STYLE[c.action]}`}>{ACTION_LABEL[c.action]}</span>
                  <span className="text-sm font-semibold [overflow-wrap:anywhere]">{c.label}</span>
                  <span className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{c.entity} · {c.key}</span>
                </div>
                <table className="w-full table-fixed text-xs">
                  <thead className="sr-only sm:not-sr-only">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="w-1/3 pr-2 font-medium">Field</th>
                      <th className="w-1/3 pr-2 font-medium">Current</th>
                      <th className="w-1/3 font-medium">After import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.fields.map((f, j) => (
                      <tr key={`${f.field}:${j}`} className="align-top max-sm:block max-sm:border-t max-sm:border-border/50 max-sm:py-1">
                        <td className="pr-2 py-0.5 font-medium [overflow-wrap:anywhere] max-sm:block">{f.field}</td>
                        <td className="pr-2 py-0.5 max-sm:block"><span className="sm:hidden text-muted-foreground">Current: </span><Value value={f.before} unit={f.unit} /></td>
                        <td className="py-0.5 max-sm:block"><span className="sm:hidden text-muted-foreground">After: </span><Value value={f.after} unit={f.unit} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ImportSafetyReviewHost() {
  const [review, setReview] = useState<ImportSafetyReview | null>(null);
  const { me } = useAuth();
  useEffect(() => { resetImportReviewIdentity(); }, [me?.userId, me?.sandbox]);
  useEffect(() => subscribeImportSafetyReview(setReview), []);
  const open = review !== null;
  const dialogRef = useAccessibleDialog<HTMLDivElement>(open, () => finishImportSafetyReview(false));
  if (!review) return null;
  const t = totals(review.changes);

  return (
    <div className="responsive-dialog-overlay fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="import-safety-review-title" aria-describedby="import-safety-review-recovery"
        tabIndex={-1} data-testid="dialog-import-safety-review"
        className="responsive-dialog-card w-full !max-w-3xl flex flex-col rounded-xl border border-border bg-background shadow-xl">
        <div className="shrink-0 flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <h2 id="import-safety-review-title" className="text-sm font-semibold [overflow-wrap:anywhere]">{review.title}</h2>
          </div>
          <button type="button" aria-label="Close import review (cancel)" onClick={() => finishImportSafetyReview(false)} className="responsive-icon-button flex items-center justify-center rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          <p id="import-safety-review-recovery" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300 [overflow-wrap:anywhere]">
            <span className="font-semibold">Recovery: </span>{review.recovery}
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Factory change totals">
            {ACTIONS.map((a) => (
              <div key={a} className={`rounded-md border px-2.5 py-1.5 ${ACTION_STYLE[a]}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide">{ACTION_LABEL[a]}</dt>
                <dd className="font-mono text-lg font-bold">{t[a]}</dd>
              </div>
            ))}
          </dl>
          <ChangeList id="import-safety-factory" title="Factory recipe & profile changes"
            description="These values will be written to the calculator when you confirm." changes={review.changes} />
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span><span className="text-muted-foreground">Source version: </span><span className="font-semibold [overflow-wrap:anywhere]">{formatValue(review.baseline.label).text}</span></span>
              <span><span className="text-muted-foreground">Status: </span><span className="font-semibold">{formatValue(review.baseline.status).text}</span></span>
            </div>
            <ChangeList id="import-safety-baseline" title="Source version differences"
              description="Differences from retained successful Apply values for this source. These are not current factory changes or raw workbook evidence."
              changes={review.baseline.changes} />
          </div>
        </div>
        <div className="responsive-dialog-footer shrink-0 justify-end border-t border-border px-4 py-3">
          <button type="button" onClick={() => finishImportSafetyReview(false)} data-testid="button-import-safety-cancel"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted max-[479px]:flex-1">Cancel</button>
          <button type="button" onClick={() => finishImportSafetyReview(true)} data-testid="button-import-safety-confirm"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 max-[479px]:flex-1">
            Confirm {review.changes.length} change{review.changes.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportSafetyReviewHost;
