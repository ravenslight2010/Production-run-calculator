import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LifeBuoy,
  Loader2,
  AlertTriangle,
  Bug,
  MessageSquare,
  Check,
  CheckCheck,
  ChevronRight,
  Lock,
  History,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchIncidents,
  fetchFieldChecks,
  confirmHardwareFieldCheck,
  markIncidentReviewed,
  markIncidentResolved,
  fetchIncidentAssignees,
  updateIncidentWorkflow,
  type Incident,
  type FieldCheckSummary,
} from "../inventoryShared";
import { useMe } from "../useRole";
import { useIdle } from "../hooks/useIdle";
import {
  fieldCheckDiagnosticLabel,
  getFieldCheckQueueStatus,
  FIELD_CHECK_QUEUE_EVENT,
  productionRunSaveFailureLabel,
  type FieldCheckQueueStatus,
} from "../fieldChecks";
import { FieldEvidenceFilters } from "./FieldEvidenceFilters";
import { downloadFieldCheckExport } from "../fieldCheckExport";
import type { GetFieldChecksParams } from "../inventoryShared";
import { IncidentPatternsPanel } from "./IncidentPatternsPanel";

type StatusFilter = "all" | "new" | "reviewed" | "resolved";
type PlatformFilter = "all" | "web" | "mobile";
type SourceFilter = "all" | "user_report" | "auto_crash" | "field_check";
type WorkflowFilter = "all" | Incident["workflowState"];

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function requestOperationLabel(value?: string): string {
  switch (value) {
    case "authentication": return "Checking account access";
    case "sync": return "Syncing saved changes";
    case "other": return "Using another app function";
    default: return value?.replaceAll("_", " ") || "App activity not recorded";
  }
}

function requestOutcomeLabel(value?: string): string {
  switch (value) {
    case "http_client_error": return "the server rejected the request";
    case "http_server_error": return "the server reported an error";
    case "authentication_rejected": return "account access was rejected";
    case "timeout": return "no reply arrived before the app stopped waiting";
    case "cancelled": return "the request stopped before a reply arrived";
    case "transport_failure": return "the network request could not reach the server";
    case "offline_failure": return "the browser reported no connection";
    default: return value?.replaceAll("_", " ") || "the result was not recorded";
  }
}

function diagnosticDetailLabel(value?: string): string {
  return value?.replaceAll("_", " ").replaceAll("-", " ") || "not recorded";
}

function supportRouteLabel(value?: string): string {
  return value === "other"
    ? "not identified in the available diagnostics"
    : diagnosticDetailLabel(value);
}

function IncidentRow({
  incident,
  assignees,
  initiallyExpanded = false,
  onIncidentFocus,
  onIncidentBlur,
  onHeaderButtonRef,
}: {
  incident: Incident;
  assignees: Array<{ userId: string; name: string; role: string }>;
  initiallyExpanded?: boolean;
  onIncidentFocus: (incidentId: string) => void;
  onIncidentBlur: (relatedTarget: EventTarget | null) => void;
  onHeaderButtonRef: (incidentId: string, element: HTMLButtonElement | null) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(initiallyExpanded || incident.status === "new");
  const previousStatus = useRef(incident.status);
  const resolveButtonRef = useRef<HTMLButtonElement>(null);
  const headerButtonRef = useRef<HTMLButtonElement>(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["incidents"] });
    void qc.invalidateQueries({ queryKey: ["unreviewedIncidentCount"] });
  };
  const review = useMutation({
    mutationFn: () => markIncidentReviewed(incident.id),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: () => markIncidentResolved(incident.id),
    onSuccess: invalidate,
  });
  const workflow = useMutation({
    mutationFn: (body: Parameters<typeof updateIncidentWorkflow>[1]) => updateIncidentWorkflow(incident.id, body),
    onSuccess: invalidate,
  });
  const [note, setNote] = useState("");
  const busy = review.isPending || resolve.isPending || workflow.isPending;

  useEffect(() => {
    const oldStatus = previousStatus.current;
    previousStatus.current = incident.status;
    if (oldStatus === "new" && incident.status === "reviewed") {
      resolveButtonRef.current?.focus();
    } else if (oldStatus !== "resolved" && incident.status === "resolved") {
      headerButtonRef.current?.focus();
    }
  }, [incident.id, incident.status]);

  const isCrash = incident.source === "auto_crash";
  const ctx = incident.context ?? {};
  const plainLanguageSummary = ctx.requestHttpStatus === 403
    ? "This request was denied because this account does not currently have permission. Ask a manager to check access before trying again."
    : ctx.requestHttpStatus === 409
      ? "The shared value changed before this save reached the server. Compare it with the current run and resolve the difference before retrying."
      : ctx.requestHttpStatus === 400 || ctx.requestHttpStatus === 422
        ? ctx.requestOperationCategory === "sync"
          ? "This sync update did not pass a validation check. Review the current values and run state, keep your draft, and do not retry it unchanged."
          : "The app rejected this action because some information did not pass a validation check. Review it before trying again."
      : ctx.requestOutcome === "cancelled"
        ? "The browser stopped waiting before a reply arrived. This does not show whether the server accepted the request."
        : ctx.requestOutcome === "timeout"
          ? "The browser gave up waiting for a reply. The measured wait can include time when the app was in the background; it is not server processing time."
          : ctx.requestOutcome === "transport_failure" || ctx.requestOutcome === "offline_failure"
            ? "The app could not get a network reply. Check the connection, then retry retained work once while online."
            : /stale_deployment_asset|failed to fetch dynamically imported module/i.test(ctx.errorMessage ?? "")
              ? "This browser could not load a code file for its app version. Use the guarded update action only when no work is active or unsaved; do not clear browser data."
              : null;

  return (
    <div
      data-testid="incident-row"
      className="rounded-lg border border-border bg-card"
      onFocusCapture={() => onIncidentFocus(incident.id)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onIncidentBlur(next);
      }}
    >
      <button
        ref={(element) => {
          headerButtonRef.current = element;
          onHeaderButtonRef(incident.id, element);
        }}
        data-incident-header={incident.id}
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-3 text-left"
      >
        <span
          className={`mt-0.5 flex items-center justify-center w-8 h-8 rounded-md shrink-0 ${
            isCrash ? "bg-red-500/15 text-red-400" : "bg-sky-500/15 text-sky-400"
          }`}
        >
          {isCrash ? <Bug className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {isCrash ? "Auto-captured crash" : "Reported issue"}
            </span>
            {incident.status === "new" && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold uppercase tracking-wide">
                New
              </span>
            )}
            {incident.status === "reviewed" && (
              <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 text-[10px] font-bold uppercase tracking-wide">
                Reviewed
              </span>
            )}
            {incident.status === "resolved" && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold uppercase tracking-wide">
                Resolved
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {incident.reporterName ?? "Unknown"}
            {incident.reporterRole ? ` (${incident.reporterRole})` : ""} · {incident.screen} ·{" "}
            {incident.appPlatform} · {timeAgo(incident.createdAt)}
          </p>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {ctx.description && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                What they reported
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                {ctx.description}
              </p>
            </div>
          )}
          {ctx.errorMessage && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Error
              </p>
              <p className="text-sm text-red-400 font-mono break-words mt-0.5">
                {ctx.errorMessage}
              </p>
            </div>
          )}
          {plainLanguageSummary && (
            <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-2">
              <p className="text-xs font-semibold text-foreground">In plain language</p>
              <p className="mt-1 text-sm text-muted-foreground">{plainLanguageSummary}</p>
            </div>
          )}
          {incident.recurrence && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300 w-fit">
              <History className="w-3.5 h-3.5" />
              {incident.recurrence.count > 1
                ? `Seen ${incident.recurrence.count}× before`
                : "Seen before"}
            </div>
          )}
          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
            <p><span className="font-semibold text-foreground">Incident reference:</span>{" "}
              <code className="select-all">{ctx.correlationId ?? "Unavailable for older reports"}</code>
            </p>
            {ctx.relatedCorrelationId && (
              <p className="mt-1"><span className="font-semibold text-foreground">Related request reference (client-reported):</span>{" "}
                <code className="select-all">{ctx.relatedCorrelationId}</code>
              </p>
            )}
            {ctx.requestOperationCategory && ctx.requestOutcome && (
              <>
                <p className="mt-1">
                  <span className="font-semibold text-foreground">App activity:</span>{" "}
                  {requestOperationLabel(ctx.requestOperationCategory)} · {requestOutcomeLabel(ctx.requestOutcome)}
                  {ctx.requestHttpStatus ? ` · HTTP ${ctx.requestHttpStatus}` : ""}
                  {ctx.requestRoute ? ` · support route: ${supportRouteLabel(ctx.requestRoute)}` : ""}
                </p>
                {ctx.requestReasonCode && (
                  <p className="mt-1">
                    <span className="font-semibold text-foreground">Support code:</span>{" "}
                    <code>{ctx.requestReasonCode}</code>
                  </p>
                )}
                {ctx.requestObservedAt && (
                  <p className="mt-1">
                    Observed by this browser at {new Date(ctx.requestObservedAt).toLocaleString()}
                    {typeof ctx.requestElapsedMs === "number"
                      ? ` · browser waited ${ctx.requestElapsedMs === 10_000_000 ? "at least " : ""}${Math.round(ctx.requestElapsedMs)} ms`
                      : ""}
                  </p>
                )}
                <p className="mt-1">
                  {ctx.requestBackgroundInvolvement === "observed"
                    ? "The app was in the background while waiting; the phone operating system may also have paused it."
                    : ctx.requestBackgroundInvolvement === "not_observed"
                      ? "No background change was detected; the operating-system pause state is unknown."
                      : "It is unknown whether the app or operating system paused in the background."}
                  {" "}The browser wait is not server processing time.
                </p>
              </>
            )}
            <p className="mt-1">
              <span className="font-semibold text-foreground">Extra details for support:</span>{" "}
              {diagnosticDetailLabel(ctx.action)} · {diagnosticDetailLabel(ctx.outcome)} · {ctx.retryCount ?? 0} automatic retries ·
              {" "}{diagnosticDetailLabel(ctx.connectivity)} connection · {diagnosticDetailLabel(ctx.syncState)} sync status ·
              {" "}{diagnosticDetailLabel(ctx.browserFamily ?? incident.appPlatform)} on {diagnosticDetailLabel(ctx.deviceClass)} ·
              {" "}build reference {incident.appVersion ?? "not recorded"}
            </p>
            <p className="mt-1">
              {ctx.requestOutcome === "cancelled"
                ? "Next step: this request ended before a response, so it does not show that the server rejected the session. If it happened during sign-in, sign-out, or an account switch, no action is needed. Otherwise, review the available diagnostics if it recurs; the cancellation source is unknown."
                : ctx.requestHttpStatus === 409
                  ? "Next step: review the conflicting change against the current shared run. Keep the local draft and resolve the conflict; retrying unchanged or reloading does not save it."
                  : ctx.requestHttpStatus === 400 || ctx.requestHttpStatus === 422
                    ? "Next step: review the rejected action and correct its inputs or run state. Do not retry the unchanged action. Keep this reference for a developer if the reason is unclear."
                    : ctx.requestHttpStatus === 401
                      ? "Next step: sign in again, confirm the current shared run, then explicitly retry eligible retained work."
                      : ctx.requestHttpStatus === 403
                        ? "Next step: ask an authorized manager to review access before retrying eligible retained work."
                        : "Next step: check connectivity and retry eligible retained work once. If it repeats, keep this reference for a developer; do not reload or update while work is active or unsaved."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2">
            <label className="text-xs text-muted-foreground">Priority
              <select className="ml-1 rounded border border-border bg-background px-1.5 py-1 text-xs" value={incident.priority}
                onChange={(e) => workflow.mutate({ priority: e.target.value as Incident["priority"] })} disabled={busy}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Work
              <select className="ml-1 rounded border border-border bg-background px-1.5 py-1 text-xs" value={incident.workflowState}
                onChange={(e) => workflow.mutate({ workflowState: e.target.value as Incident["workflowState"] })} disabled={busy}>
                <option value="new">New</option><option value="assigned">Assigned</option><option value="waiting">Waiting</option><option value="resolved">Resolved</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Owner
              <select className="ml-1 max-w-40 rounded border border-border bg-background px-1.5 py-1 text-xs" value={incident.assigneeId ?? ""}
                onChange={(e) => workflow.mutate({ assigneeId: e.target.value || null })} disabled={busy}>
                <option value="">Unassigned</option>
                {assignees.map((a) => <option key={a.userId} value={a.userId}>{a.name} ({a.role})</option>)}
              </select>
            </label>
          </div>
          {(incident.notes.length > 0 || incident.activity.length > 0) && (
            <div className="rounded-md border border-border p-2 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Activity</p>
              {[...incident.activity].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map((event) => (
                <p key={event.id} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{event.actorName}</span> · {event.action.replaceAll("_", " ")} · {timeAgo(event.createdAt)}</p>
              ))}
              {incident.notes.map((entry) => <p key={entry.id} className="text-sm text-foreground"><span className="font-medium">{entry.authorName}:</span> {entry.text}</p>)}
            </div>
          )}
          <div className="flex gap-2">
            <input className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Add an operational note…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            <Button size="sm" variant="outline" disabled={!note.trim() || busy} onClick={() => { workflow.mutate({ note }); setNote(""); }}>Add note</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {incident.status === "new" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => review.mutate()}
                disabled={busy}
              >
                {review.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Mark reviewed
              </Button>
            )}
            {incident.status === "reviewed" && (
              <p className="flex items-center gap-1.5 text-xs text-sky-400">
                <Check className="w-3.5 h-3.5" /> Reviewed
                {incident.reviewedAt ? ` ${timeAgo(incident.reviewedAt)}` : ""}
              </p>
            )}
            {incident.status !== "resolved" ? (
              <Button
                ref={resolveButtonRef}
                size="sm"
                onClick={() => resolve.mutate()}
                disabled={busy}
              >
                {resolve.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCheck className="w-4 h-4 mr-2" />
                )}
                Mark resolved
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCheck className="w-3.5 h-3.5" /> Resolved
                {incident.resolvedAt ? ` ${timeAgo(incident.resolvedAt)}` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const FIELD_STATUS_LABEL: Record<FieldCheckSummary["status"], string> = {
  healthy: "Healthy",
  collecting: "Collecting evidence",
  "needs-review": "Needs review",
  unsupported: "Unsupported",
};

const FIELD_STATUS_CLASS: Record<FieldCheckSummary["status"], string> = {
  healthy: "bg-emerald-500/15 text-emerald-400",
  collecting: "bg-sky-500/15 text-sky-400",
  "needs-review": "bg-amber-500/15 text-amber-400",
  unsupported: "bg-muted text-muted-foreground",
};

const FIELD_COVERAGE_LABEL: Record<FieldCheckSummary["coverage"], string> = {
  "never-observed": "Never observed",
  current: "Current success",
  stale: "Stale last success",
  "no-success": "Observed, no success",
};

function queueAgeLabel(ageMs: number): string {
  if (ageMs < 60_000) return "under 1 minute";
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)} minutes`;
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))} hours`;
  return `${Math.floor(ageMs / (24 * 60 * 60_000))} days`;
}

function FieldChecksPanel({
  report,
  isLoading,
  error,
  canConfirmHardware,
  canDownload,
  filters,
  onApplyFilters,
}: {
  report: Awaited<ReturnType<typeof fetchFieldChecks>> | undefined;
  isLoading: boolean;
  error: unknown;
  canConfirmHardware: boolean;
  canDownload: boolean;
  filters: GetFieldChecksParams;
  onApplyFilters: (filters: GetFieldChecksParams) => void;
}) {
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState(false);
  const [localQueue, setLocalQueue] = useState<FieldCheckQueueStatus>(() => getFieldCheckQueueStatus());
  useEffect(() => {
    const refreshLocalQueue = () => setLocalQueue(getFieldCheckQueueStatus());
    window.addEventListener(FIELD_CHECK_QUEUE_EVENT, refreshLocalQueue);
    const interval = window.setInterval(refreshLocalQueue, 30_000);
    refreshLocalQueue();
    return () => {
      window.removeEventListener(FIELD_CHECK_QUEUE_EVENT, refreshLocalQueue);
      window.clearInterval(interval);
    };
  }, []);
  function downloadReport() {
    if (!canDownload || !report || isLoading || error) return;
    setDownloadError(false);
    try {
      downloadFieldCheckExport(report);
    } catch {
      setDownloadError(true);
    }
  }
  const [deviceCategory, setDeviceCategory] = useState<"android-phone" | "android-tablet" | "ipad" | "iphone">("android-phone");
  const confirmation = useMutation({
    mutationFn: (input: {
      checkName: "touch-accuracy" | "keyboard-clearance" | "orientation-layout" |
        "safe-area-clearance" | "camera-file-selection" | "update-handoff" |
        "process-kill-recovery";
      outcome: "success" | "failure" | "incomplete";
    }) => confirmHardwareFieldCheck({
      ...input,
      checkVersion: "2026-09",
      observedAt: new Date().toISOString(),
      deviceCategory,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fieldChecks"] }),
  });
  const browserChecks = report?.checks.filter((check) => check.observedBy === "browser") ?? [];
  const hardwareChecks = report?.checks.filter((check) => check.observedBy === "hardware") ?? [];
  const actionable = report?.checks.filter((check) => check.actionable) ?? [];

  return (
    <section
      aria-labelledby="field-checks-heading"
      className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
      data-testid="field-checks-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="field-checks-heading" className="text-sm font-semibold text-foreground">
            Field checks
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Advisory evidence scoped to this facility. No run data, screenshots, or device fingerprints are collected.
          </p>
        </div>
        {report && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${FIELD_STATUS_CLASS[report.overallStatus]}`}>
            Overall health: {FIELD_STATUS_LABEL[report.overallStatus]}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground" aria-label="This browser's local field-check delivery queue">
        This browser only: {localQueue.available
          ? `${localQueue.count} observation${localQueue.count === 1 ? "" : "s"} retained locally · ${localQueue.retryableCount} eligible for delivery${localQueue.expiredCount > 0
            ? ` · ${localQueue.expiredCount} expired, still unconfirmed, and not retried`
            : ""}${localQueue.displacedCount > 0
            ? ` · ${localQueue.displacedCount} earlier observation${localQueue.displacedCount === 1 ? "" : "s"} displaced by the browser queue limit; delivery is unconfirmed`
            : ""}${localQueue.oldestAgeMs === null ? "" : ` · oldest ${queueAgeLabel(localQueue.oldestAgeMs)}`}. This is not a facility-wide delivery status.`
          : "queue status unavailable; delivery is unconfirmed."}
      </p>
      <FieldEvidenceFilters filters={filters} onApply={onApplyFilters} />
      {canDownload && (
        <div className="space-y-1">
          <button type="button" onClick={downloadReport}
            disabled={!report || isLoading || !!error}
            className="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50">
            Download safe field-check report
          </button>
          <p className="text-xs text-muted-foreground">
            JSON for the displayed population with bounded diagnostic details only. Advisory, not release or physical-device verification.
          </p>
          {downloadError && <p role="alert" className="text-sm text-red-400">
            Couldn’t download the report. Observations are unchanged. Try again.
          </p>}
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading field evidence…
        </div>
      ) : error ? (
        <p className="text-sm text-red-400">Couldn’t load field-check evidence.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="sm:col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Browser-observed checks
            </p>
            {browserChecks.map((check) => (
              <FieldCheckCard key={check.name} check={check} />
            ))}
          </div>
          <div className="rounded-md border border-border bg-card/60 p-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Guided hardware confirmations
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Browser evidence cannot confirm these. Follow the physical-device protocol without entering production data, then record only the device category, protocol version, outcome, and time.
            </p>
            {canConfirmHardware && (
              <label className="mt-2 block text-xs text-muted-foreground">
                Device category
                <select
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  value={deviceCategory}
                  onChange={(event) => setDeviceCategory(event.target.value as typeof deviceCategory)}
                >
                  <option value="android-phone">Android phone</option>
                  <option value="android-tablet">Android tablet</option>
                  <option value="ipad">iPad</option>
                  <option value="iphone">iPhone</option>
                </select>
              </label>
            )}
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Use a clean training or idle screen; do not start or edit a production run.</li>
              <li>Perform only the named check: rotate, inspect clearance, open and cancel a picker, update/reopen, or test the listed interaction.</li>
              <li>Record Pass, Fail, or Incomplete below immediately after the physical check.</li>
            </ol>
            <div className="mt-3 space-y-2">
              {hardwareChecks.map((check) => (
                <div key={check.name} className="rounded-md border border-border bg-background/50 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                       {check.label}: Health {FIELD_STATUS_LABEL[check.status]} · Coverage {FIELD_COVERAGE_LABEL[check.coverage]}
                    </span>
                    {canConfirmHardware && (
                      <div className="flex gap-1">
                        {(["success", "failure", "incomplete"] as const).map((outcome) => (
                          <Button
                            key={outcome}
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={confirmation.isPending}
                            onClick={() => confirmation.mutate({
                              checkName: check.name as "touch-accuracy" | "keyboard-clearance" |
                                "orientation-layout" | "safe-area-clearance" |
                                "camera-file-selection" | "update-handoff" |
                                "process-kill-recovery",
                              outcome,
                            })}
                          >
                            {outcome === "success" ? "Pass" : outcome === "failure" ? "Fail" : "Incomplete"}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{check.evidence}</p>
                  {check.lastObservedAt && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Last recorded {timeAgo(check.lastObservedAt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {confirmation.isError && (
              <p className="mt-2 text-xs text-red-400">Couldn’t save the hardware confirmation.</p>
            )}
          </div>
          {actionable.length > 0 && (
            <div className="space-y-2" aria-label="Actionable field-check failures">
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">
                Recent field-check failures
              </p>
              {actionable.flatMap((check) =>
                check.recentFailures.slice(0, 3).map((failure, index) => (
                  <div key={`${check.name}-${failure.observedAt}-${index}`} className="break-words rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{check.label}</span>
                      <span className="text-muted-foreground">{timeAgo(failure.observedAt)}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {failure.outcome === "incomplete" ? "Repeatedly incomplete" : "Failed"} · build {failure.appBuild} · {failure.deviceCategory}
                      {check.name === "production-run-save-sync" && productionRunSaveFailureLabel(failure.metrics.failureCode)
                        ? ` · ${productionRunSaveFailureLabel(failure.metrics.failureCode)}`
                        : ""}
                    </p>
                    {fieldCheckDiagnosticLabel(check.name, failure.metrics) && (
                      <p className="mt-1 text-muted-foreground">{fieldCheckDiagnosticLabel(check.name, failure.metrics)}</p>
                    )}
                    {failure.reportedRequestCorrelationId && (
                      <p className="mt-1 text-muted-foreground">
                        Client-reported request reference:{" "}
                        <code className="select-all">{failure.reportedRequestCorrelationId}</code>
                      </p>
                    )}
                    {failure.appBuild === "local" && (
                      <p className="text-muted-foreground">Unidentified local build; not release verification evidence.</p>
                    )}
                    <p className="text-muted-foreground">
                      {check.observedBy === "browser" ? "Browser-observed" : "Guided hardware"} evidence only; measurements are bounded and contain no production payload.
                    </p>
                  </div>
                )),
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FieldCheckCard({ check }: { check: FieldCheckSummary }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{check.label}</p>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FIELD_STATUS_CLASS[check.status]}`}>
          Health: {FIELD_STATUS_LABEL[check.status]}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{check.evidence}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Evidence coverage: {FIELD_COVERAGE_LABEL[check.coverage]}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Failures: {check.failureCount} · Incomplete: {check.incompleteCount} · {check.issueStatus === "recovered" ? "Recovered" : check.issueStatus === "open" ? "Open" : "No issue recorded"}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Server receipt delay estimate: {check.lastReceiptDelayMs === null
          ? "Unknown/unconfirmed"
          : `${queueAgeLabel(check.lastReceiptDelayMs)} after the browser timestamp (clock differences may affect this estimate)`}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Last success: {check.lastSuccessfulAt ? timeAgo(check.lastSuccessfulAt) : "Not yet"}
        {typeof check.lastSuccessfulMetrics?.durationMs === "number"
          ? ` · ${Math.round(check.lastSuccessfulMetrics.durationMs)} ms`
          : ""}
      </p>
      {check.recentFailures.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Recent non-successes: {check.recentFailures.length} · latest {check.recentFailures[0].outcome} · {timeAgo(check.recentFailures[0].observedAt)} · {check.recentFailures[0].deviceCategory}
          {typeof check.recentFailures[0].metrics.durationMs === "number"
            ? ` · ${Math.round(check.recentFailures[0].metrics.durationMs)} ms`
            : ""}
          {check.name === "production-run-save-sync" &&
          productionRunSaveFailureLabel(check.recentFailures[0].metrics.failureCode)
            ? ` · ${productionRunSaveFailureLabel(check.recentFailures[0].metrics.failureCode)}`
            : ""}
          {fieldCheckDiagnosticLabel(check.name, check.recentFailures[0].metrics)
            ? ` · ${fieldCheckDiagnosticLabel(check.name, check.recentFailures[0].metrics)}` : ""}
        </p>
      )}
      {check.status === "needs-review" && (
        <p className="mt-1 text-[11px] text-amber-300">
          {check.failureCount > 0 ? `${check.failureCount} failure${check.failureCount === 1 ? "" : "s"}` : "Repeated incomplete observations"} · review below
        </p>
      )}
    </div>
  );
}

// Review queue of privacy-redacted reports and auto-captured failures.
// Access is capability-gated; operators never see this tab.
export default function IncidentsTab() {
  const { hasCapability, role, isLoading: roleLoading } = useMe();
  const canReview = hasCapability("review-incidents");
  const canConfirmHardware = role === "manager";
  const isIdle = useIdle();
  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    enabled: canReview,
    refetchInterval: pollingReady ? (isIdle ? 120_000 : 20_000) : false,
  });

  const [status, setStatus] = useState<StatusFilter>("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [workflowState, setWorkflowState] = useState<WorkflowFilter>("all");
  const [fieldFilters, setFieldFilters] = useState<GetFieldChecksParams>({});
  const [selectedIncidentId] = useState(() => {
    const match = window.location.hash.match(/^#incidents\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  const incidentListHeadingRef = useRef<HTMLHeadingElement>(null);
  const incidentHeaderButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusedIncidentId = useRef<string | null>(null);
  const { data: assignees = [] } = useQuery({ queryKey: ["incidentAssignees"], queryFn: fetchIncidentAssignees, enabled: canReview });
  const { data: fieldChecks, isLoading: fieldChecksLoading, error: fieldChecksError } = useQuery({
    queryKey: ["fieldChecks", fieldFilters],
    queryFn: () => fetchFieldChecks(fieldFilters),
    enabled: canReview,
    refetchInterval: pollingReady ? (isIdle ? 120_000 : 20_000) : false,
  });

  const incidents = data ?? [];
  const filtered = useMemo(
    () =>
      incidents.filter(
        (i) =>
          (status === "all" || i.status === status) &&
          (platform === "all" || i.appPlatform === platform) &&
          (source === "all" || source === "field_check" || i.source === source) &&
          (workflowState === "all" || i.workflowState === workflowState),
      ).sort((a, b) => {
        const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;
        return (rank[a.priority] - rank[b.priority]) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }),
    [incidents, status, platform, source, workflowState],
  );
  useEffect(() => {
    const incidentId = focusedIncidentId.current;
    if (!incidentId) return;
    if (filtered.some((incident) => incident.id === incidentId)) return;
    const nextIncident = filtered[0];
    const nextHeader = nextIncident
      ? incidentHeaderButtons.current.get(nextIncident.id)
      : undefined;
    (nextHeader ?? incidentListHeadingRef.current)?.focus();
    focusedIncidentId.current = null;
  }, [filtered]);

  if (!roleLoading && !canReview) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center text-center gap-2">
          <Lock className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Issue reports are visible to managers only.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasIncidents = incidents.length > 0;
  const hasFieldFailures = (fieldChecks?.checks.some((check) => check.actionable) ?? false);
  const hasAnyIssues = hasIncidents || hasFieldFailures;

  return (
    <Card>
      <CardHeader>
        <h1 className="flex items-center gap-2 font-semibold leading-none tracking-tight">
          <LifeBuoy className="w-5 h-5 text-primary" /> Reported issues
        </h1>
      </CardHeader>
      <CardContent className="space-y-3">
        <FieldChecksPanel
          report={fieldChecks}
          isLoading={fieldChecksLoading}
          error={fieldChecksError}
          canConfirmHardware={canConfirmHardware}
          canDownload={canReview}
          filters={fieldFilters}
          onApplyFilters={setFieldFilters}
        />
        {hasIncidents && <IncidentPatternsPanel disabled={isLoading} />}
        <section aria-labelledby="incident-list-heading" className="space-y-3">
          <h2
            id="incident-list-heading"
            ref={incidentListHeadingRef}
            tabIndex={-1}
            className="text-sm font-semibold text-foreground"
          >
            Incident list
          </h2>
          {hasAnyIssues && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <FilterRow
              label="Status"
              value={status}
              onChange={(v: StatusFilter) => setStatus(v)}
              options={[
                ["all", "All"],
                ["new", "New"],
                ["reviewed", "Reviewed"],
                ["resolved", "Resolved"],
              ] as [StatusFilter, string][]}
            />
            <FilterRow label="Work" value={workflowState} onChange={(v: WorkflowFilter) => setWorkflowState(v)}
              options={[["all", "All"], ["new", "New"], ["assigned", "Assigned"], ["waiting", "Waiting"], ["resolved", "Resolved"]] as [WorkflowFilter, string][]} />
            <FilterRow
              label="Platform"
              value={platform}
              onChange={(v: PlatformFilter) => setPlatform(v)}
              options={[
                ["all", "All"],
                ["web", "Web"],
                ["mobile", "Mobile"],
              ] as [PlatformFilter, string][]}
            />
            <FilterRow
              label="Source"
              value={source}
              onChange={(v: SourceFilter) => setSource(v)}
              options={[
                ["all", "All"],
                ["user_report", "Reported"],
                ["auto_crash", "Auto-crash"],
                ["field_check", "Field checks"],
              ] as [SourceFilter, string][]}
            />
            </div>
          )}
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4" /> Couldn't load reported issues.
          </p>
        ) : source === "field_check" ? (
          hasFieldFailures ? (
            <div className="space-y-2">
              {fieldChecks?.checks.filter((check) => check.actionable).map((check) => (
                <FieldCheckCard key={check.name} check={check} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No actionable field-check failures.
            </p>
          )
        ) : !hasIncidents ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No issues reported yet. When staff report a problem or the app hits a
            crash, it'll show up here.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No issues match these filters.
          </p>
        ) : (
          <div className="space-y-3">
          {filtered.map((incident) => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              assignees={assignees}
              initiallyExpanded={incident.id === selectedIncidentId}
              onIncidentFocus={(incidentId) => {
                focusedIncidentId.current = incidentId;
              }}
              onIncidentBlur={(relatedTarget) => {
                if (!relatedTarget || relatedTarget === document.body) return;
                focusedIncidentId.current = null;
              }}
              onHeaderButtonRef={(incidentId, element) => {
                if (element) incidentHeaderButtons.current.set(incidentId, element);
                else incidentHeaderButtons.current.delete(incidentId);
              }}
            />
          ))}
          </div>
        )}
        </section>
      </CardContent>
    </Card>
  );
}

// A labelled row of mutually-exclusive filter chips.
function FilterRow<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16 shrink-0">
        {label}
      </span>
      <div className="flex gap-1.5 flex-wrap">
        {options.map(([val, text]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              value === val
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
