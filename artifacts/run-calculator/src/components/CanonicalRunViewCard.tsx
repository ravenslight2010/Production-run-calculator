import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Server } from "lucide-react";
import type { OperationalRunView } from "@workspace/api-client-react";
import { reportUnauthorized } from "../inventoryShared";
import { useMe } from "../useRole";
import { shouldAdoptOperationalSnapshot } from "../operationalState";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: OperationalRunView };

function number(value: number, maximumFractionDigits = 1): string {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function duration(seconds: number): string {
  const wholeMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(wholeMinutes / 60);
  const minutes = wholeMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function phaseLabel(view: OperationalRunView): string {
  const phase = view.elapsed.phase;
  const active = [phase.stage1, phase.stage2, phase.stage3]
    .filter((stage) => stage.state !== "empty")
    .map((stage) => `${stage.label} (${stage.state})`);
  return active.length > 0 ? active.join(" · ") : view.observed.status.replace("-", " ");
}

export default function CanonicalRunViewCard({
  date,
  runId,
}: {
  date: string;
  runId: string;
}) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const requestGenerationRef = useRef(0);
  const adoptedSnapshotRef = useRef<{ runId: string; snapshotId: string; capturedAt: number } | null>(null);
  const { hasCapability } = useMe();
  const allowed = hasCapability("review-incidents");

  useEffect(() => {
    const ageTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    const refreshTimer = window.setInterval(() => setRefresh((value) => value + 1), 15_000);
    return () => {
      window.clearInterval(ageTimer);
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    if (!date || !runId || !allowed) return;
    const requestGeneration = ++requestGenerationRef.current;
    adoptedSnapshotRef.current = null;
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetch(
      `/api/reports/operational-view?date=${encodeURIComponent(date)}&runId=${encodeURIComponent(runId)}`,
      { cache: "no-store", signal: controller.signal },
    ).then(async (response) => {
      if (response.status === 401) reportUnauthorized();
      if (!response.ok) {
        const body = await response.json().catch(() => null) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Canonical run snapshot is unavailable.");
      }
      return response.json() as Promise<OperationalRunView>;
    }).then((view) => {
      const candidate = {
        runId: view.runId,
        snapshotId: view.freshness.snapshotId,
        capturedAt: view.freshness.capturedAt,
      };
      if (controller.signal.aborted) return;
      if (!shouldAdoptOperationalSnapshot({
        requestGeneration,
        currentRequestGeneration: requestGenerationRef.current,
        selectedRunId: runId,
        responseRunId: view.runId,
        candidate,
        adopted: adoptedSnapshotRef.current,
      })) return;
      adoptedSnapshotRef.current = candidate;
      setState({ kind: "ready", view });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && requestGeneration === requestGenerationRef.current) {
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Canonical run snapshot is unavailable.",
        });
      }
    });
    return () => controller.abort();
  }, [date, runId, refresh, allowed]);

  if (!allowed) return null;
  const isStale = state.kind === "ready"
    && (state.view.freshness.status === "stale"
      || now - state.view.freshness.capturedAt > state.view.freshness.maxAgeMs);

  return (
    <section className="mb-3 rounded-xl border border-border/50 bg-card/40 p-4" data-testid="canonical-run-view" aria-busy={state.kind === "loading"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Server className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-bold">Canonical run snapshot</h3>
            <p className="text-xs text-muted-foreground">Server-calculated production facts shared by operational reports.</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted/50"
          onClick={() => setRefresh((value) => value + 1)}
          aria-label="Refresh canonical run snapshot"
        >
          <RefreshCw className="inline h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {state.kind === "loading" && <p className="mt-3 text-xs text-muted-foreground">Loading server snapshot…</p>}
      {state.kind === "error" && (
        <p className="mt-3 text-xs text-amber-500" role="status">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {state.message} Local live displays continue as offline/provisional values.
        </p>
      )}
      {state.kind === "ready" && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Cases", `${number(state.view.recap.casesCompleted, 0)}/${number(state.view.recap.casesNeeded, 0)}`],
              ["Remaining", number(state.view.recap.casesLeftToRun, 0)],
              ["Pace", `${number(state.view.pace.ppm)} ppm`],
              ["Elapsed", duration(state.view.elapsed.batchSec)],
              ["Phase", phaseLabel(state.view)],
              ["On line", `${number(state.view.advisory.line.cases, 0)} cases`],
              ["In freezer", `${number(state.view.advisory.freezer.cases, 0)} cases`],
              ["Estimate", state.view.pace.catchUpPpm == null ? "On plan" : `${number(state.view.pace.catchUpPpm)} ppm needed`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border/50 bg-muted/20 p-2">
                <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
                <p className="text-sm font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <p className={`mt-3 text-xs ${isStale ? "text-amber-500" : "text-muted-foreground"}`}>
            {isStale && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
            {isStale ? "Stale canonical" : "Canonical"} snapshot as of{" "}
            {new Date(state.view.freshness.capturedAt).toLocaleString()} · revision {state.view.version} ·{" "}
             server snapshot {state.view.freshness.snapshotId.slice(0, 12)} · source {state.view.formulaProvenance.calculator}
          </p>
        </>
      )}
    </section>
  );
}