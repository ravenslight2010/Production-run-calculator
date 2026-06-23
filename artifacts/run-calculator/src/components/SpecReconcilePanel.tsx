// Saved spec sheets cross-reference panel (web).
//
// Lists the up-to-two most-recently-imported spec sheets that were snapshotted
// server-side. For each one the user can run a cross-reference against the
// CURRENT recipe library ("does the recipe match the spec?") and see the
// deterministic discrepancy list plus an advisory AI plain-language summary, or
// delete the saved snapshot. Mirrors the mobile section in
// artifacts/run-calculator-mobile/app/master-data.tsx (replit.md parity).

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchSavedSpecSheets,
  reconcileSpecSheet,
  deleteSpecSheet,
  type SavedSpecSheet,
  type SpecReconcileResult,
} from "@/savedSpecSheets";

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function SpecReconcilePanel() {
  const [sheets, setSheets] = useState<SavedSpecSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [result, setResult] = useState<SpecReconcileResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      setSheets(await fetchSavedSpecSheets());
    } catch {
      setListError("Couldn't load saved spec sheets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCheck(id: number) {
    setBusyId(id);
    setResult(null);
    setResultError(null);
    try {
      setResult(await reconcileSpecSheet(id));
    } catch {
      setResultError("Couldn't cross-reference that spec sheet. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      const next = await deleteSpecSheet(id);
      setSheets(next);
      if (result?.specSheetId === id) setResult(null);
    } catch {
      setResultError("Couldn't delete that spec sheet.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card data-testid="spec-reconcile-panel">
      <CardHeader>
        <CardTitle className="text-base">Saved Spec Sheets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your two most recently imported spec sheets are saved here. Cross-reference one
          against your current recipes to see whether the recipes still match the spec.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : listError ? (
          <p className="text-sm text-destructive">{listError}</p>
        ) : sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved spec sheets yet. Import a spec sheet and it will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {sheets.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                data-testid={`spec-sheet-${s.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Imported {fmtDate(s.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleCheck(s.id)}
                    disabled={busyId !== null}
                    data-testid={`button-check-spec-${s.id}`}
                  >
                    {busyId === s.id ? "Checking…" : "Check against current recipes"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(s.id)}
                    disabled={busyId !== null}
                    data-testid={`button-delete-spec-${s.id}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {resultError ? <p className="text-sm text-destructive">{resultError}</p> : null}

        {result ? (
          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3" data-testid="spec-reconcile-result">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Cross-reference result</span>
              {result.discrepancies.length === 0 ? (
                <Badge variant="secondary">Everything matches</Badge>
              ) : (
                <Badge variant="destructive">
                  {result.discrepancies.length} difference
                  {result.discrepancies.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>

            {result.summary ? (
              <p className="whitespace-pre-wrap text-sm">{result.summary}</p>
            ) : null}

            {result.discrepancies.length > 0 ? (
              <ul className="space-y-1">
                {result.discrepancies.map((d, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {d.kind} · {d.recipeName}
                    </span>
                    {" — "}
                    {d.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every recipe on this spec sheet matches your current recipes exactly.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
