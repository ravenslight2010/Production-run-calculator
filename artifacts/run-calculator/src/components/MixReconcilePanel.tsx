// Mix monitoring cross-reference panel (web).
//
// Lists the saved premix sheets AND the saved spec sheets, and lets the user
// cross-reference the CURRENT mixes against either one. The deterministic diff
// (which products need a NEW mix, which existing mixes have DRIFTED) runs
// client-side via @workspace/mix-reconcile; an advisory AI summary narrates it.
// Each drifted/new item offers a one-tap "Apply suggested fix" that writes
// through the manager-gated saveMixes path (only shown to managers). Mirrors the
// mobile section in artifacts/run-calculator-mobile/components/MixReconcilePanel.tsx
// (replit.md parity).

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMasterDataSlice } from "../masterData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MixReconcileItem } from "@workspace/mix-reconcile";
import {
  fetchSavedPremixSheets,
  deletePremixSheet,
  type SavedPremixSheet,
} from "@/savedPremixSheets";
import {
  fetchSavedSpecSheets,
  latestSourceKeyIds,
  type SavedSpecSheet,
} from "@/savedSpecSheets";
import {
  reconcilePremixSheet,
  reconcileSpecSheetMixes,
  applyMixReconcileItem,
  type MixReconcileView,
} from "@/mixReconcile";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import AiStatusNotice from "@/components/AiStatusNotice";

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

export default function MixReconcilePanel({
  isManager,
  canManageInventory,
  refreshSignal = 0,
  reopenRequest,
}: {
  isManager: boolean;
  canManageInventory?: boolean;
  /** Bump to re-fetch the saved sheet lists (e.g. right after an import saves one). */
  refreshSignal?: number;
  reopenRequest?: { importType: "spec" | "premix" | "cheese"; snapshotId: number; requestId: number } | null;
}) {
  const canApply = canManageInventory ?? isManager;
  const qc = useQueryClient();
  const [premixSheets, setPremixSheets] = useState<SavedPremixSheet[]>([]);
  const [specSheets, setSpecSheets] = useState<SavedSpecSheet[]>([]);

  const latestPremixIds = latestSourceKeyIds(premixSheets);
  const latestSpecIds = latestSourceKeyIds(specSheets);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [result, setResult] = useState<MixReconcileView | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      const [premix, spec] = await Promise.all([
        fetchSavedPremixSheets(),
        fetchSavedSpecSheets(),
      ]);
      setPremixSheets(premix);
      setSpecSheets(spec);
    } catch {
      setListError("Couldn't load saved sheets.");
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch on mount AND whenever an import commits a new saved sheet — the
  // import buttons live right above this panel, so without the signal the
  // lists go stale and a just-imported sheet looks like it "didn't save".
  useEffect(() => {
    void refresh();
  }, [refreshSignal]);

  useEffect(() => {
    if (!reopenRequest || reopenRequest.importType !== "premix") return;
    const sheet = premixSheets.find((item) => item.id === reopenRequest.snapshotId);
    if (sheet) void handleCheckPremix(sheet);
  }, [reopenRequest?.requestId, premixSheets]);

  async function handleCheckPremix(s: SavedPremixSheet) {
    setBusyKey(`premix-${s.id}`);
    setResult(null);
    setResultError(null);
    setAppliedIds(new Set());
    try {
      setResult(await reconcilePremixSheet(s.id, s.label));
    } catch {
      setResultError("Couldn't check that premix sheet. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCheckSpec(s: SavedSpecSheet) {
    setBusyKey(`spec-${s.id}`);
    setResult(null);
    setResultError(null);
    setAppliedIds(new Set());
    try {
      setResult(await reconcileSpecSheetMixes(s.id, s.label));
    } catch {
      setResultError("Couldn't check that spec sheet. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeletePremix(id: number) {
    setBusyKey(`premix-${id}`);
    try {
      const next = await deletePremixSheet(id);
      setPremixSheets(next);
      if (result?.source === "premix") setResult(null);
    } catch {
      setResultError("Couldn't delete that premix sheet.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleApply(item: MixReconcileItem) {
    setBusyKey(`apply-${item.mixId}`);
    try {
      await applyMixReconcileItem(item);
      await invalidateMasterDataSlice(qc, "mixes");
      setAppliedIds((prev) => new Set(prev).add(item.mixId));
    } catch (err) {
      setResultError(err instanceof Error ? err.message : "Couldn't apply that fix. Refresh and review it again.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card data-testid="mix-reconcile-panel">
      <CardHeader>
        <CardTitle className="text-base">Mix Monitoring</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Cross-reference your current mixes against an imported premix sheet or spec sheet to
          spot products that need a new mix and existing mixes whose ingredients or amounts have
          drifted.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : listError ? (
          <p className="text-sm text-destructive">{listError}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Premix sheets</div>
              {premixSheets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No saved premix sheets yet. Import a premix workbook and it will appear here.
                </p>
              ) : (
                premixSheets.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    data-testid={`premix-sheet-${s.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">{s.label}</div>
                        {latestPremixIds.has(s.id) ? (
                          <Badge variant="secondary">Latest</Badge>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Previous version
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Imported {fmtDate(s.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCheckPremix(s)}
                        disabled={busyKey !== null}
                        data-testid={`button-check-premix-${s.id}`}
                      >
                        {busyKey === `premix-${s.id}` ? "Checking…" : "Check mixes"}
                      </Button>
                      <ConfirmDeleteButton
                        onConfirm={() => handleDeletePremix(s.id)}
                        title="Delete this saved mix sheet?"
                        description="This removes the saved mix sheet. This can't be undone."
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey !== null}
                          data-testid={`button-delete-premix-${s.id}`}
                        >
                          Delete
                        </Button>
                      </ConfirmDeleteButton>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Spec sheets</div>
              {specSheets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No saved spec sheets yet. Import a spec sheet and it will appear here.
                </p>
              ) : (
                specSheets.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    data-testid={`mix-spec-sheet-${s.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">{s.label}</div>
                        {latestSpecIds.has(s.id) ? (
                          <Badge variant="secondary">Latest</Badge>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Previous version
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Imported {fmtDate(s.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCheckSpec(s)}
                        disabled={busyKey !== null}
                        data-testid={`button-check-mix-spec-${s.id}`}
                      >
                        {busyKey === `spec-${s.id}` ? "Checking…" : "Check mixes"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {resultError ? <p className="text-sm text-destructive">{resultError}</p> : null}
        <AiStatusNotice status={result?.aiStatus} feature="AI reconciliation" />

        {result ? (
          <div
            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
            data-testid="mix-reconcile-result"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{result.label}</span>
              {result.items.length === 0 ? (
                <Badge variant="secondary">All mixes match</Badge>
              ) : (
                <Badge variant="destructive">
                  {result.items.length} mix
                  {result.items.length === 1 ? "" : "es"} to review
                </Badge>
              )}
            </div>

            {result.summary ? (
              <p className="whitespace-pre-wrap text-sm">{result.summary}</p>
            ) : null}

            {result.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every current mix matches this sheet.
              </p>
            ) : (
              <ul className="space-y-3">
                {result.items.map((item) => {
                  const applied = appliedIds.has(item.mixId);
                  return (
                    <li
                      key={`${item.source}-${item.mixId}`}
                      className="space-y-2 rounded-md border border-border bg-background p-3"
                      data-testid={`mix-reconcile-item-${item.mixId}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={item.status === "new" ? "default" : "secondary"}>
                            {item.status === "new" ? "New mix" : "Drifted"}
                          </Badge>
                          <span className="text-sm font-medium">{item.mixName}</span>
                          <span className="text-xs text-muted-foreground">
                            {[item.brand, item.flavor].filter(Boolean).join(" ")}
                          </span>
                        </div>
                        {canApply ? (
                          applied ? (
                            <Badge variant="secondary">Applied</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleApply(item)}
                              disabled={busyKey !== null}
                              data-testid={`button-apply-mix-${item.mixId}`}
                            >
                              {busyKey === `apply-${item.mixId}`
                                ? "Applying…"
                                : item.status === "new"
                                  ? "Create this mix"
                                  : "Apply suggested fix"}
                            </Button>
                          )
                        ) : null}
                      </div>
                      <ul className="space-y-1">
                        {item.discrepancies.map((d, i) => (
                          <li key={i} className="text-sm text-muted-foreground">
                            {d.message}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
