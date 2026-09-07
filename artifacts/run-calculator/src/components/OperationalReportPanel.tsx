import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, BarChart2, CheckCircle2, Download, FileSpreadsheet, Lock, Loader2, Printer, RefreshCw, Share2, ShieldAlert } from "lucide-react";
import * as XLSX from "xlsx";
import { aggregateDaySummary, type OperationalReport } from "@workspace/day-summary";
import type { SummaryInput } from "../aiSummary";
import {
  operationalReportText,
  operationalReportCsv,
  operationalReportWorkbook,
  reportFilename,
  shareOperationalReport,
} from "../reportShare";
import { useMe } from "../useRole";
import { submitAndWaitForServerJob } from "../serverJobs";

type Props = { buildInput: (scope: "day" | "week", date: string) => SummaryInput };
export type OperationalReportDetailRange = { start: string; end: string; scope: "day" | "week" };
type FinalizedReportListItem = {
  id: string;
  reportScope: "day" | "week";
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  finalizedAt: string;
  finalizedBy: string;
  contentHash: string;
};
type ProofKeyHealthResponse = {
  status: "healthy" | "attention-required";
  activeKeyId: string | null;
  storedProofKeyIds: string[];
  availableStoredProofKeyIds: string[];
  missingStoredProofKeyIds: string[];
  scan: {
    limit: number;
    checkedDistinctKeyIds: number;
    truncated: boolean;
  };
  message: string;
  remediation: string | null;
};
type ProofKeyHealthState =
  | { status: "loading" }
  | { status: "healthy"; data: ProofKeyHealthResponse }
  | { status: "attention-required" | "partial"; data: ProofKeyHealthResponse }
  | { status: "unauthorized" | "unavailable"; message: string };

function isProofKeyHealthResponse(value: unknown): value is ProofKeyHealthResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProofKeyHealthResponse>;
  return (candidate.status === "healthy" || candidate.status === "attention-required")
    && (candidate.activeKeyId === null || typeof candidate.activeKeyId === "string")
    && Array.isArray(candidate.storedProofKeyIds)
    && candidate.storedProofKeyIds.every((keyId) => typeof keyId === "string")
    && Array.isArray(candidate.availableStoredProofKeyIds)
    && candidate.availableStoredProofKeyIds.every((keyId) => typeof keyId === "string")
    && Array.isArray(candidate.missingStoredProofKeyIds)
    && candidate.missingStoredProofKeyIds.every((keyId) => typeof keyId === "string")
    && Boolean(candidate.scan)
    && typeof candidate.scan?.limit === "number"
    && typeof candidate.scan.checkedDistinctKeyIds === "number"
    && typeof candidate.scan.truncated === "boolean"
    && typeof candidate.message === "string"
    && (candidate.remediation === null || typeof candidate.remediation === "string");
}

function periodStartFor(scope: "day" | "week", date: string): string {
  if (scope === "day") return date;
  const end = new Date(`${date}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 6);
  return end.toISOString().slice(0, 10);
}

function localOfflineReport(
  input: SummaryInput,
  scope: "day" | "week",
  date: string,
): OperationalReport {
  const production = aggregateDaySummary({ scope, date, runs: input.runs });
  const productionRows = input.runs.map((run, index) => ({
    id: `local:${date}:${index}`,
    date,
    run: [run.brand, run.flavor].filter(Boolean).join(" ") || "Unnamed run",
    status: run.finished ? "finished" as const : "unfinished" as const,
    casesPlanned: run.casesPlanned,
    casesProduced: run.casesProduced,
    attainmentPct: run.casesPlanned > 0 ? Math.max(0, Math.round((run.casesProduced / run.casesPlanned) * 100)) : 0,
    downtimeMinutes: Math.max(0, Math.round(run.downtimeMinutes)),
    stoppages: Math.max(0, Math.round(run.stoppageCount)),
  }));
  const localActions = productionRows.filter((row) => row.status === "unfinished").map((row) => ({
    id: `production:${row.id}`,
    source: "production" as const,
    priority: "high",
    action: "Complete or close the production run",
    detail: `${row.run}: ${row.casesProduced}/${row.casesPlanned} cases.`,
  }));
  return {
    scope,
    date,
    periodStart: periodStartFor(scope, date),
    periodEnd: date,
    generatedAt: new Date().toISOString(),
    attribution: { generatedBy: "This device", source: "local-device" },
    freshness: {
      status: "offline-only",
      asOf: new Date().toISOString(),
      note: "Only production values currently stored on this device are included.",
    },
    calculation: {
      period: `${periodStartFor(scope, date)} through ${date}, inclusive.`,
      production: "Calculated from production runs currently stored on this device.",
      quality: "Unavailable while offline.",
      incidents: "Unavailable while offline.",
      inventory: "Unavailable while offline.",
    },
    production,
    productionRows,
    quality: {
      availability: "unavailable",
      value: null,
      note: "Unavailable in local/offline fallback.",
    },
    incidents: {
      availability: "unavailable",
      value: null,
      note: "Unavailable in local/offline fallback.",
    },
    inventory: {
      availability: "unavailable",
      value: null,
      note: "Unavailable in local/offline fallback.",
    },
    unresolvedActions: {
      availability: "offline-only",
      value: { total: localActions.length, rows: localActions },
      note: "Only unfinished production runs on this device are listed; quality, incident, and inventory actions are unavailable.",
    },
  };
}

function fmtDate(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function OperationalReportPanel({
  buildInput,
  onOpenQuality,
  onOpenIncidents,
}: Props & {
  onOpenQuality?: (range: OperationalReportDetailRange) => void;
  onOpenIncidents?: (range: OperationalReportDetailRange) => void;
}) {
  const { hasCapability } = useMe();
  const allowed = hasCapability("review-incidents");
  const [scope, setScope] = useState<"day" | "week">("day");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [reportSource, setReportSource] = useState<"authoritative" | "local-offline">("authoritative");
  // Only a finalized archive record is an immutable canonical export snapshot.
  // Preview/local reports retain the existing synchronous browser export path.
  const [finalizedSnapshotId, setFinalizedSnapshotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [history, setHistory] = useState<FinalizedReportListItem[]>([]);
  const [historyStart, setHistoryStart] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return start.toISOString().slice(0, 10);
  });
  const [historyEnd, setHistoryEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyScope, setHistoryScope] = useState<"all" | "day" | "week">("all");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [proofKeyHealth, setProofKeyHealth] = useState<ProofKeyHealthState>({ status: "loading" });

  const input = useMemo(() => buildInput(scope, date), [buildInput, scope, date]);
  async function loadProofKeyHealth() {
    setProofKeyHealth({ status: "loading" });
    try {
      const response = await fetch("/api/reports/operational/finalized/proof-key-health");
      if (response.status === 401 || response.status === 403) {
        setProofKeyHealth({
          status: "unauthorized",
          message: "Verification health is available to managers only.",
        });
        return;
      }
      if (!response.ok) throw new Error("Verification health request failed");
      const payload: unknown = await response.json();
      if (!isProofKeyHealthResponse(payload)) throw new Error("Invalid verification health response");
      setProofKeyHealth({
        status: payload.scan.truncated
          ? "partial"
          : payload.status,
        data: payload,
      });
    } catch {
      setProofKeyHealth({
        status: "unavailable",
        message: "Verification health is temporarily unavailable. The archive remains available, but report verifiability could not be confirmed.",
      });
    }
  }
  useEffect(() => {
    if (allowed) void loadProofKeyHealth();
  }, [allowed]);
  async function generate() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/reports/operational", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, date }),
      });
      if (!response.ok) throw new Error("Report request failed");
      const authoritative = (await response.json()) as OperationalReport;
      setReport(authoritative);
      setReportSource("authoritative");
      setFinalizedSnapshotId(null);
      setStatus("Report ready. Statistics are authoritative and deterministic.");
    } catch {
      setReport(localOfflineReport(input, scope, date));
      setReportSource("local-offline");
      setStatus("Local/offline fallback ready. Statistics are from this device and are not authoritative.");
    } finally {
      setBusy(false);
    }
  }
  async function finalize() {
    if (!report || reportSource !== "authoritative") return;
    setFinalizeBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports/operational/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Scope/date are selection parameters only; the server derives every
        // report fact again from canonical records.
        body: JSON.stringify({ scope, date }),
      });
      if (!response.ok) throw new Error("Finalization failed");
      const finalized = await response.json() as { id: string; report: OperationalReport; idempotent?: boolean };
      setReport(finalized.report);
      setReportSource("authoritative");
      setFinalizedSnapshotId(finalized.id);
      await loadHistory();
      setStatus(finalized.idempotent
        ? `Finalized report already exists (${finalized.id}). The original snapshot was retained.`
        : `Authoritative report finalized (${finalized.id}).`);
    } catch {
      setError("Could not finalize the authoritative report. No report was changed.");
    } finally {
      setFinalizeBusy(false);
    }
  }
  async function loadHistory() {
    if (!historyStart || !historyEnd || historyStart > historyEnd) {
      setError("Choose an archive start date on or before the end date.");
      return;
    }
    setHistoryBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        startDate: historyStart,
        endDate: historyEnd,
        limit: "100",
      });
      if (historyScope !== "all") params.set("scope", historyScope);
      const response = await fetch(`/api/reports/operational/finalized/search?${params.toString()}`);
      if (!response.ok) throw new Error("History request failed");
      setHistory(await response.json() as FinalizedReportListItem[]);
      setStatus("Finalized report archive loaded. Up to 100 matching reports are shown.");
    } catch {
      setError("Could not load finalized reports for this date range.");
    } finally {
      setHistoryBusy(false);
    }
  }
  async function openFinalized(id: string) {
    setHistoryBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/operational/finalized/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("Finalized report request failed");
      const finalized = await response.json() as { id: string; report: OperationalReport };
      setReport(finalized.report);
      setReportSource("authoritative");
      setFinalizedSnapshotId(finalized.id);
      setStatus("Viewing immutable finalized report.");
    } catch {
      setError("Could not retrieve the finalized report.");
    } finally {
      setHistoryBusy(false);
    }
  }
  async function download(kind: "csv" | "xlsx" | "print") {
    if (!report) return;
    if (reportSource === "authoritative" && finalizedSnapshotId) {
      try {
        const directUrl = `/api/reports/operational/finalized/${encodeURIComponent(finalizedSnapshotId)}/export?format=${kind}`;
        // Package large artifacts in the durable workload first. Small exports
        // retain the direct canonical endpoint as their compatibility path.
        const packaged = (report.productionRows?.length ?? 0) >= 100
          ? await submitAndWaitForServerJob<{ downloadUrl: string }>({
            type: "export-package",
            input: { finalizedReportId: finalizedSnapshotId, format: kind },
            snapshotId: finalizedSnapshotId,
          })
          : null;
        const response = await fetch(packaged?.downloadUrl ?? directUrl);
        if (!response.ok) throw new Error("Canonical export request failed");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
          ?? reportFilename(report, kind === "print" ? "csv" : kind);
        anchor.click();
        URL.revokeObjectURL(url);
        setStatus(`Downloaded canonical snapshot ${response.headers.get("X-Canonical-Snapshot-Id") ?? finalizedSnapshotId}.`);
        return;
      } catch {
        // The old browser builder remains available while job/server exports are
        // rolling out or temporarily unavailable.
        setStatus("Canonical download was unavailable; downloaded the current synchronous compatibility export.");
      }
    }
    if (kind === "print") {
      // Previews and offline reports have no immutable server snapshot.
      window.print();
      return;
    }
    if (kind === "xlsx") {
      XLSX.writeFile(operationalReportWorkbook(report), reportFilename(report, "xlsx"));
      return;
    }
    const blob = new Blob(
      [operationalReportCsv(report)],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFilename(report, "csv");
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function share() {
    if (!report) return;
    setShareBusy(true);
    const result = await shareOperationalReport(report, reportSource);
    const shareStatus =
      result === "shared"
        ? "Report shared."
        : result === "copied"
          ? "Report copied to the clipboard."
          : "Couldn’t share or copy the report. You can still export the text file.";
    setStatus(
      reportSource === "local-offline"
        ? `${shareStatus} Local/offline fallback statistics are not authoritative.`
        : shareStatus,
    );
    setShareBusy(false);
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-3 text-sm text-muted-foreground">
        <Lock className="w-5 h-5 shrink-0" /> Operational reports are available to managers only.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="operational-report" aria-busy={busy}>
      <div className="flex items-center gap-2">
        <BarChart2 className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-bold">Operational report</h2>
          <p className="text-xs text-muted-foreground">Deterministic source statistics for a day or week.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-muted-foreground">
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as "day" | "week")} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="day">Day</option><option value="week">Week</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {scope === "week" ? "Week ending" : "Date"}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm" />
        </label>
        <button type="button" onClick={() => void generate()} disabled={busy || !date} className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <><Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> Building…</> : "Preview report"}
        </button>
        {report && (
          <>
            <button type="button" onClick={() => void finalize()} disabled={finalizeBusy || reportSource !== "authoritative"} title={reportSource === "local-offline" ? "Offline fallback reports cannot be finalized." : undefined} className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">
              {finalizeBusy ? <Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> : <Lock className="w-4 h-4 inline mr-1" />}
              Finalize
            </button>
            <button type="button" onClick={() => void download("csv")} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50">
              <Download className="w-4 h-4 inline mr-1" /> CSV
            </button>
            <button type="button" onClick={() => void download("xlsx")} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50">
              <FileSpreadsheet className="w-4 h-4 inline mr-1" /> Excel
            </button>
            <button type="button" onClick={() => void download("print")} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50">
              <Printer className="w-4 h-4 inline mr-1" /> Print / PDF
            </button>
            <button type="button" onClick={() => void share()} disabled={shareBusy} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50 disabled:opacity-50">
              {shareBusy ? <Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> : <Share2 className="w-4 h-4 inline mr-1" />}
              Share
            </button>
          </>
        )}
      </div>
      <section className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3" aria-labelledby="finalized-report-archive-heading">
        <div>
          <h3 id="finalized-report-archive-heading" className="text-sm font-bold">Finalized report archive</h3>
          <p className="text-xs text-muted-foreground">Search retained day and week reports by their reporting date. Up to 100 results are shown.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-muted-foreground">
            Start date
            <input aria-label="Archive start date" type="date" value={historyStart} onChange={(e) => setHistoryStart(e.target.value)} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            End date
            <input aria-label="Archive end date" type="date" value={historyEnd} onChange={(e) => setHistoryEnd(e.target.value)} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            Report type
            <select aria-label="Archive report type" value={historyScope} onChange={(e) => setHistoryScope(e.target.value as "all" | "day" | "week")} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm">
              <option value="all">Day and week</option>
              <option value="day">Day only</option>
              <option value="week">Week only</option>
            </select>
          </label>
          <button type="button" onClick={() => void loadHistory()} disabled={historyBusy || !historyStart || !historyEnd} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50 disabled:opacity-50">
            {historyBusy ? <Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> : <Archive className="w-4 h-4 inline mr-1" />} Search archive
          </button>
        </div>
        <section
          id="report-verification-health"
          data-testid="report-verification-health"
          aria-live="polite"
          className={
            proofKeyHealth.status === "healthy"
              ? "rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs"
              : proofKeyHealth.status === "loading"
                ? "rounded-md border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground"
                : "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
          }
        >
          {proofKeyHealth.status === "loading" && (
            <p><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Checking finalized report verification health…</p>
          )}
          {proofKeyHealth.status === "healthy" && (
            <p>
              <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
              <strong>Report verification healthy.</strong>{" "}
              {proofKeyHealth.data.message} No signing key values are displayed.
            </p>
          )}
          {(proofKeyHealth.status === "attention-required" || proofKeyHealth.status === "partial") && (
            <>
              <p>
                <ShieldAlert className="mr-1 inline h-4 w-4 text-amber-600" />
                <strong>
                  {proofKeyHealth.status === "partial"
                    ? "Verification health audit is partial."
                    : "Report verification needs attention."}
                </strong>{" "}
                {proofKeyHealth.data.message}
              </p>
              {proofKeyHealth.data.missingStoredProofKeyIds.length > 0 && (
                <p className="mt-1">
                  Missing retained proof key ID{proofKeyHealth.data.missingStoredProofKeyIds.length === 1 ? "" : "s"}:{" "}
                  <strong>{proofKeyHealth.data.missingStoredProofKeyIds.join(", ")}</strong>
                </p>
              )}
              {proofKeyHealth.data.scan.truncated && (
                <p className="mt-1">
                  This bounded audit checked {proofKeyHealth.data.scan.checkedDistinctKeyIds} of more than {proofKeyHealth.data.scan.limit} distinct stored key IDs.
                </p>
              )}
              {proofKeyHealth.data.remediation && <p className="mt-1">{proofKeyHealth.data.remediation}</p>}
              <a className="mt-2 inline-block font-semibold text-primary hover:underline" href="#finalized-report-archive-heading">
                Open the finalized report archive audit
              </a>
            </>
          )}
          {(proofKeyHealth.status === "unauthorized" || proofKeyHealth.status === "unavailable") && (
            <>
              <p>
                {proofKeyHealth.status === "unauthorized"
                  ? <Lock className="mr-1 inline h-4 w-4" />
                  : <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-600" />}
                {proofKeyHealth.message}
              </p>
              {proofKeyHealth.status === "unavailable" && (
                <button type="button" className="mt-2 inline-flex items-center font-semibold text-primary hover:underline" onClick={() => void loadProofKeyHealth()}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Check again
                </button>
              )}
            </>
          )}
        </section>
      </section>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {status && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>}
      {history.length > 0 && (
        <section aria-label="Finalized report history" className="rounded-lg border border-border/60 p-3">
          <h3 className="text-sm font-bold">Finalized report results</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {history.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
              <span>
                <span className="mr-2 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{item.reportScope === "week" ? "Week" : "Day"}</span>
                {fmtDate(item.periodStart)} – {fmtDate(item.periodEnd)} · Finalized {new Date(item.finalizedAt).toLocaleString()} by {item.finalizedBy} · {item.contentHash.slice(0, 12)}
              </span>
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void openFinalized(item.id)}>View finalized report</button>
            </li>)}
          </ul>
        </section>
      )}
      {report && (
        <article className="report-print-root space-y-4 border-t border-border/60 pt-3 print:border-0 print:text-black" aria-label="Shift report">
          <header>
            <h3 className="text-lg font-bold">Shift report: {fmtDate(report.periodStart)}{report.periodStart !== report.periodEnd ? ` – ${fmtDate(report.periodEnd)}` : ""}</h3>
            <p className="text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()} by {report.attribution?.generatedBy ?? "Unknown manager"}.</p>
          </header>
          <div className={`rounded-lg border p-3 text-sm ${reportSource === "authoritative" && report.freshness?.status !== "stale" ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            {reportSource !== "authoritative" || report.freshness?.status === "stale" ? <AlertTriangle className="mr-2 inline h-4 w-4" /> : null}
            <strong>{reportSource === "authoritative" ? (report.freshness?.status === "stale" ? "STALE CANONICAL DATA" : "CONFIRMED CANONICAL REPORT") : "OFFLINE-ONLY — INCOMPLETE REPORT"}</strong>
            <span className="ml-2">{report.freshness?.note}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Scope: {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}.{" "}
            {reportSource === "authoritative"
              ? "The statistics below are authoritative source values."
              : "Local/offline fallback: the statistics below were calculated from this device and are not authoritative."}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              ["Cases", `${report.production.casesProduced}/${report.production.casesPlanned}`],
              ["Attainment", `${report.production.attainmentPct}%`],
              ["Runs finished", `${report.production.runsFinished}/${report.production.runsPlanned}`],
              ["Downtime", `${report.production.totalDowntimeMinutes}m`],
              ["Stoppages", String(report.production.totalStoppages)],
              ["Open actions", report.unresolvedActions?.value ? String(report.unresolvedActions.value.total) : "Unavailable"],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="text-lg font-black tabular-nums">{value}</p></div>)}
          </div>
          <p className="text-xs text-muted-foreground">{report.calculation?.period} {report.calculation?.production}</p>
          <details open className="rounded-lg border border-border/60 p-3">
            <summary className="cursor-pointer font-semibold">Production detail ({report.productionRows?.length ?? report.production.runsPlanned})</summary>
            {report.productionRows?.length ? <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Run</th><th>Date</th><th>Status</th><th>Cases</th><th>Attainment</th><th>Downtime</th><th>Stops</th></tr></thead><tbody>{report.productionRows.map((row) => <tr key={row.id} className="border-t border-border/50"><td>{row.run}</td><td>{row.date}</td><td>{row.status}</td><td>{row.casesProduced}/{row.casesPlanned}</td><td>{row.attainmentPct}%</td><td>{row.downtimeMinutes}m</td><td>{row.stoppages}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-xs text-muted-foreground">Detailed rows are unavailable in this report source.</p>}
          </details>
          {report.production.unfinishedRuns.length > 0 && <p className="text-sm text-amber-400">Unfinished: {report.production.unfinishedRuns.join(", ")}</p>}
          <div className="grid lg:grid-cols-3 gap-2 text-xs">
            <section className="rounded-lg border border-border/60 p-3">
              <h4 className="font-bold">Quality</h4>
              <p>Quality: {report.quality.availability === "available" && report.quality.value ? `${report.quality.value.issues} issue(s)` : `${report.quality.availability.toUpperCase()}${report.quality.note ? ` — ${report.quality.note}` : ""}`}</p>
              <p className="text-muted-foreground">{report.calculation?.quality}</p>
              {report.quality.value?.rows?.map((row) => <p key={row.id} className="mt-1 border-t pt-1">{row.product}: {row.status} · {row.issues} issue(s) {row.summary}</p>)}
              {report.quality.availability === "available" && onOpenQuality && <button type="button" className="mt-1 font-semibold text-primary hover:underline" onClick={() => onOpenQuality({ start: report.periodStart, end: report.periodEnd, scope: report.scope })}>Open quality details</button>}
            </section>
            <section className="rounded-lg border border-border/60 p-3">
              <h4 className="font-bold">Incidents</h4>
              <p>Incidents: {report.incidents.availability === "available" && report.incidents.value ? `${report.incidents.value.total} (${report.incidents.value.unresolved} unresolved)` : `${report.incidents.availability.toUpperCase()}${report.incidents.note ? ` — ${report.incidents.note}` : ""}`}</p>
              <p className="text-muted-foreground">{report.calculation?.incidents}</p>
              {report.incidents.value?.rows?.map((row) => <p key={row.id} className="mt-1 border-t pt-1">{row.priority} · {row.status}: {row.summary}</p>)}
              {report.incidents.availability === "available" && onOpenIncidents && <button type="button" className="mt-1 font-semibold text-primary hover:underline" onClick={() => onOpenIncidents({ start: report.periodStart, end: report.periodEnd, scope: report.scope })}>Open incident details</button>}
            </section>
            <section className="rounded-lg border border-border/60 p-3">
              <h4 className="font-bold">Inventory</h4>
              <p>Inventory flags: {report.inventory.availability === "available" && report.inventory.value ? report.inventory.value.flaggedItems : `${report.inventory.availability.toUpperCase()}${report.inventory.note ? ` — ${report.inventory.note}` : ""}`}</p>
              <p className="text-muted-foreground">{report.calculation?.inventory}</p>
              {report.inventory.value?.rows?.map((row) => <p key={row.id} className="mt-1 border-t pt-1">{row.item}: {row.onHand} {row.unit} (reorder {row.reorderThreshold})</p>)}
            </section>
          </div>
          {report.inventory.value?.historical && <p className="text-xs text-muted-foreground">Historical inventory events: {report.inventory.value.historical.availability === "available" && report.inventory.value.historical.value ? `${report.inventory.value.historical.value.totalEvents} total · ${report.inventory.value.historical.value.consumptionEvents} consumption · ${report.inventory.value.historical.value.wasteEvents} waste` : `Unavailable${report.inventory.value.historical.note ? ` — ${report.inventory.value.historical.note}` : ""}`}</p>}
          <p className="text-[11px] text-muted-foreground">{report.inventory.note}</p>
          <section className="rounded-lg border border-border/60 p-3">
            <h4 className="font-bold">Unresolved shift actions</h4>
            {report.unresolvedActions?.value
              ? report.unresolvedActions.value.rows.length
                ? <><p className="text-xs font-semibold text-amber-500">{report.unresolvedActions.availability !== "available" ? `${report.unresolvedActions.availability.toUpperCase()} — ${report.unresolvedActions.note}` : ""}</p><ul className="mt-2 space-y-1 text-sm">{report.unresolvedActions.value.rows.map((row) => <li key={row.id}><strong>{row.priority.toUpperCase()}</strong> — {row.action}: {row.detail}</li>)}</ul></>
                : <p className="text-sm">No unresolved actions identified.</p>
              : <p className="text-sm text-amber-500">Unavailable — {report.unresolvedActions?.note ?? "This section was not provided."}</p>}
          </section>
        </article>
      )}
    </div>
  );
}