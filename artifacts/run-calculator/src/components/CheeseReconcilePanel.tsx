import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMasterDataSlice } from "../masterData";
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  deleteCheeseSheet,
  fetchSavedCheeseSheets,
  type SavedCheeseSheet,
} from "@/savedCheeseSheets";
import { latestSourceKeyIds } from "@/savedSpecSheets";
import {
  applyCheeseReconcileItem,
  reconcileCheeseSheet,
  type CheeseReconcileView,
} from "@/cheeseReconcile";
import type { CheeseRepairItem } from "@workspace/cheese-reconcile";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function CheeseReconcilePanel({
  canManageInventory,
  refreshSignal = 0,
  reopenRequest,
}: {
  canManageInventory: boolean;
  refreshSignal?: number;
  reopenRequest?: { importType: "spec" | "premix" | "cheese"; snapshotId: number; requestId: number } | null;
}) {
  const qc = useQueryClient();
  const [sheets, setSheets] = useState<SavedCheeseSheet[]>([]);
  const [result, setResult] = useState<CheeseReconcileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const latestIds = latestSourceKeyIds(sheets);

  async function refresh() {
    setLoadError(null);
    try {
      setSheets(await fetchSavedCheeseSheets());
    } catch {
      setLoadError("Couldn't load retained cheese sources.");
    }
  }
  useEffect(() => { void refresh(); }, [refreshSignal]);
  useEffect(() => {
    if (!reopenRequest || reopenRequest.importType !== "cheese") return;
    const sheet = sheets.find((candidate) => candidate.id === reopenRequest.snapshotId);
    if (sheet) void check(sheet);
  }, [reopenRequest?.requestId, sheets]);

  async function check(sheet: SavedCheeseSheet) {
    setBusy(`check-${sheet.id}`);
    setError(null);
    setApplied(new Set());
    try {
      setResult(await reconcileCheeseSheet(sheet.id, sheet.label));
    } catch {
      setError("Couldn't compare that cheese source with current master data.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(sheet: SavedCheeseSheet) {
    setBusy(`delete-${sheet.id}`);
    try {
      setSheets(await deleteCheeseSheet(sheet.id));
      if (result?.label === sheet.label) setResult(null);
    } catch {
      setError("Couldn't delete that retained source.");
    } finally {
      setBusy(null);
    }
  }

  async function apply(item: CheeseRepairItem) {
    setBusy(`apply-${item.recipeId}`);
    setError(null);
    try {
      await applyCheeseReconcileItem(item);
      await invalidateMasterDataSlice(qc, "cheeseRecipes");
      setApplied((previous) => new Set(previous).add(item.recipeId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply that repair. Refresh and review it again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="cheese-reconcile-panel">
      <CardHeader><CardTitle className="text-base">Cheese source repairs</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Retained cheese workbooks are parsed-data-only repair sources. Review each
          source against the current pool before applying individual formula or assignment changes.
          Current-only recipes are never deleted automatically.
        </p>
        {!canManageInventory && (
          <p className="text-sm text-muted-foreground">Inventory-management permission is required to apply repairs.</p>
        )}
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No retained cheese sources yet. Import a Cheese Mix Recipe Spec workbook first.</p>
        ) : (
          <div className="space-y-2">
            {sheets.map((sheet) => (
              <div key={sheet.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{sheet.label}</span>
                    {latestIds.has(sheet.id) ? <Badge variant="secondary">Latest</Badge> : <Badge variant="outline">Previous version</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">Imported {fmtDate(sheet.createdAt)}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void check(sheet)} disabled={busy !== null}>Review repair</Button>
                  <Button size="sm" variant="outline" onClick={() => void remove(sheet)} disabled={busy !== null}>Delete source</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        {result && (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Reviewing {result.label}</div>
              <Badge variant="outline">{result.items.length} review item{result.items.length === 1 ? "" : "s"}</Badge>
            </div>
            {result.items.length === 0 ? (
              <p className="text-sm text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" />Current cheese recipes match the retained source.</p>
            ) : result.items.map((item) => (
              <div key={item.recipeId} className="rounded-md border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><b>{item.recipeName}</b> <span className="text-muted-foreground">({item.brand})</span></div>
                  <Badge variant={item.status === "ambiguous" ? "destructive" : "secondary"}>{item.status}</Badge>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {item.discrepancies.map((d, index) => <li key={`${d.type}-${d.ingredient ?? ""}-${index}`}><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />{d.message}</li>)}
                </ul>
                {item.status === "new" && <p className="mt-2 text-xs text-muted-foreground">This creates a missing source recipe; manager notes and enabled status are not copied into existing records.</p>}
                {canManageInventory && item.status !== "ambiguous" && item.suggestedRecipe && !applied.has(item.recipeId) && (
                  <Button className="mt-3" size="sm" onClick={() => void apply(item)} disabled={busy !== null}>
                    Apply this repair
                  </Button>
                )}
                {applied.has(item.recipeId) && <p className="mt-2 text-xs text-green-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Applied and saved.</p>}
              </div>
            ))}
            {result.items.some((item) => item.status === "ambiguous") && (
              <p className="text-xs text-amber-700"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Ambiguous identities are review-only. Resolve them in Cheese Recipes, then reopen this source.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}