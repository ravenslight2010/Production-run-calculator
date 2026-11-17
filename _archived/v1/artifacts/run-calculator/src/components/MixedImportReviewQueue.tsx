import { useId, useRef, useState } from "react";
import { Ban, FileSpreadsheet, Layers, Play, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  canStartMixedImport, MAX_MIXED_IMPORT_FILES, MIXED_IMPORT_LABELS, MIXED_IMPORT_TYPES,
  WORKBOOK_ACCEPT, type MixedImportStatus, type MixedImportType,
} from "@/mixedImportQueue";
import type { useMixedImportQueue } from "@/hooks/useMixedImportQueue";

const STATUS_LABEL: Record<MixedImportStatus, string> = {
  queued: "Queued", preparing: "Preparing review", reviewing: "In review", applying: "Applying",
  applied: "Applied", partial: "Partial", failed: "Failed", cancelled: "Cancelled", uncertain: "Save unconfirmed",
};
const STATUS_TONE: Record<MixedImportStatus, string> = {
  queued: "border-border bg-muted/40 text-foreground",
  preparing: "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  reviewing: "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  applying: "border-amber-600 bg-amber-200 text-amber-950 dark:bg-amber-800/50 dark:text-amber-50",
  applied: "border-border bg-secondary text-secondary-foreground",
  partial: "border-amber-700 bg-background text-amber-800 dark:text-amber-300",
  failed: "border-destructive bg-destructive/10 text-destructive",
  cancelled: "border-border bg-background text-muted-foreground",
  uncertain: "border-destructive bg-destructive/10 text-destructive",
};
const EDITABLE: MixedImportStatus[] = ["queued", "failed", "cancelled"];

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function MixedImportReviewQueue({
  queue, enabledImporters,
}: {
  queue: ReturnType<typeof useMixedImportQueue>;
  enabledImporters: ReadonlySet<string>;
}) {
  const baseId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const types = MIXED_IMPORT_TYPES.filter((type) => enabledImporters.has(type));
  const [addType, setAddType] = useState<MixedImportType | "">("");
  const [pending, setPending] = useState<File[]>([]);
  const { items, blocked } = queue;
  const active = items.find((item) => item.id === queue.activeId)
    ?? items.find((item) => ["preparing", "reviewing", "applying", "uncertain"].includes(item.status));
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const done = items.filter((item) => ["applied", "partial", "failed", "cancelled"].includes(item.status)).length;
  const room = MAX_MIXED_IMPORT_FILES - items.length;

  function addPending() {
    if (!addType || !pending.length) return;
    queue.add(pending, addType);
    setPending([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!types.length) {
    return (
      <Card data-testid="mixed-import-queue">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4" /> Mixed workbook review queue</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No importers are available for your access. Ask a manager with import access to review workbooks.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="mixed-import-queue">
      <CardHeader className="space-y-1">
        <CardTitle className="responsive-section-heading justify-between text-base">
          <span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Mixed workbook review queue</span>
          <span className="font-mono text-xs font-normal text-muted-foreground" data-testid="text-mixed-import-count">
            {items.length}/{MAX_MIXED_IMPORT_FILES} files · {done} settled
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Files stay in this browser tab's memory only and are dropped on reload or sign-out. Each file opens its own existing review; nothing is applied automatically, and every Apply needs its own confirmation. There is no Apply all and no shared transaction.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1 text-xs font-medium" htmlFor={`${baseId}-type`}>
            Workbook type for these files
            <select id={`${baseId}-type`} data-testid="select-mixed-import-add-type" value={addType}
              onChange={(e) => setAddType(e.target.value as MixedImportType | "")}
              className="min-h-11 rounded-md border border-border bg-background px-2 text-sm">
              <option value="">Choose a type…</option>
              {types.map((type) => <option key={type} value={type}>{MIXED_IMPORT_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-medium" htmlFor={`${baseId}-files`}>
            Files ({WORKBOOK_ACCEPT.replace(/,/g, " ")})
            <input id={`${baseId}-files`} ref={fileRef} type="file" multiple accept={WORKBOOK_ACCEPT}
              data-testid="input-mixed-import-files" disabled={room <= 0}
              onChange={(e) => setPending(Array.from(e.target.files ?? []))}
              className="min-h-11 min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs" />
          </label>
          <Button type="button" className="min-h-11" data-testid="button-mixed-import-add"
            disabled={!addType || !pending.length || room <= 0} onClick={addPending}>
            <Plus className="mr-1 h-4 w-4" /> Add {pending.length || ""} to queue
          </Button>
          <p className="text-[11px] text-muted-foreground md:col-span-3">
            The type is never guessed from the filename. Add one group per type, then correct any file's type below before reviewing it.
          </p>
        </div>

        <div role="status" aria-live="polite" className="space-y-2" data-testid="status-mixed-import-live">
          {active ? (
            <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              <p className="font-semibold">{STATUS_LABEL[active.status]}: <span className="responsive-label font-normal">{active.file.name}</span></p>
              <p className="text-xs text-muted-foreground">
                {active.detail ?? "Continue in the open review dialog. Other files wait until it closes."}
              </p>
            </div>
          ) : null}
          {queue.message ? <p className="rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="text-mixed-import-message">{queue.message}</p> : null}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border py-8 text-center">
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No workbooks queued</p>
            <p className="max-w-sm text-xs text-muted-foreground">Choose a type, pick one or more files, and add them. Each one is reviewed separately.</p>
          </div>
        ) : (
          <ol className="divide-y divide-border rounded-md border border-border" data-testid="list-mixed-import">
            {items.map((item, index) => {
              const editable = EDITABLE.includes(item.status) && item.id !== queue.activeId;
              const canReview = canStartMixedImport(item, blocked) && enabledImporters.has(item.type);
              return (
                <li key={item.id} data-testid={`row-mixed-import-${item.id}`}
                  className={`grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_13rem_auto] md:items-center ${item.id === active?.id ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                  <div className="min-w-0">
                    <p className="flex items-start gap-2 text-sm font-medium">
                      <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                      <span className="responsive-label" data-testid={`text-mixed-import-name-${item.id}`}>{item.file.name}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-6">
                      <Badge variant="outline" className={`text-[11px] ${STATUS_TONE[item.status]}`} data-testid={`status-mixed-import-${item.id}`}>
                        {STATUS_LABEL[item.status]}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{size(item.file.size)}</span>
                    </div>
                    {item.detail ? <p className="mt-1 pl-6 text-xs text-muted-foreground" data-testid={`text-mixed-import-detail-${item.id}`}>{item.detail}</p> : null}
                  </div>
                  {editable ? (
                    <label className="grid gap-1 text-[11px] font-medium text-muted-foreground" htmlFor={`${baseId}-${item.id}`}>
                      Type
                      <select id={`${baseId}-${item.id}`} value={item.type} disabled={blocked}
                        data-testid={`select-mixed-import-type-${item.id}`}
                        onChange={(e) => queue.setType(item.id, e.target.value as MixedImportType)}
                        className="min-h-11 rounded-md border border-border bg-background px-2 text-sm text-foreground">
                        {types.map((type) => <option key={type} value={type}>{MIXED_IMPORT_LABELS[type]}</option>)}
                        {!types.includes(item.type) ? <option value={item.type} disabled>{MIXED_IMPORT_LABELS[item.type]} (no access)</option> : null}
                      </select>
                    </label>
                  ) : (
                    <p className="text-xs"><span className="text-muted-foreground">Type: </span>{MIXED_IMPORT_LABELS[item.type]}</p>
                  )}
                  <Button type="button" variant={canReview ? "default" : "outline"} className="min-h-11"
                    disabled={!canReview} data-testid={`button-mixed-import-review-${item.id}`}
                    aria-label={`Review ${item.file.name} as ${MIXED_IMPORT_LABELS[item.type]}`}
                    onClick={() => void queue.review(item.id)}>
                    <Play className="mr-1 h-4 w-4" /> {item.status === "queued" ? "Review" : "Review again"}
                  </Button>
                </li>
              );
            })}
          </ol>
        )}

        <div className="responsive-action-row">
          <Button type="button" variant="outline" data-testid="button-mixed-import-cancel-remaining"
            disabled={blocked || queuedCount === 0} onClick={() => queue.cancelRemaining()}>
            <Ban className="mr-1 h-4 w-4" /> Cancel {queuedCount || ""} queued
          </Button>
          <Button type="button" variant="outline" data-testid="button-mixed-import-clear"
            disabled={blocked || items.length === 0} onClick={() => queue.clear()}>
            <Trash2 className="mr-1 h-4 w-4" /> Clear group
          </Button>
          {blocked ? <span className="text-xs text-muted-foreground">Finish or close the open review first.</span> : null}
        </div>

        <ul className="list-disc space-y-1 pl-5 text-[11px] text-muted-foreground">
          <li>Sauce guides use .docx, .doc or .txt documents. Other types use spreadsheet workbooks; file format and layout checks still belong to each importer.</li>
          <li>Shipping, sauce and dough guide Applies write local guide data; schedule Applies write each production day separately. Neither is grouped with other files.</li>
          <li>Cancelling or closing a review never rolls back files already applied.</li>
          <li>Outcomes, retries and guarded Undo stay in Import review history below.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
