import { useEffect, useMemo, useState } from "react";
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
  Sparkles,
  Network,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchIncidents,
  fetchFieldChecks,
  markIncidentReviewed,
  markIncidentResolved,
  requestIncidentClusters,
  fetchIncidentAssignees,
  updateIncidentWorkflow,
  type Incident,
  type IncidentCluster,
  type IncidentClustersResult,
  type FieldCheckSummary,
} from "../inventoryShared";
import { useMe } from "../useRole";
import { useIdle } from "../hooks/useIdle";

const SEVERITY_STYLE: Record<IncidentCluster["severity"], string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-sky-500/15 text-sky-400",
};

// Manager-only AI root-cause clustering. On demand, asks the server to group the
// incident log into recurring themes; advisory and read-only. The server falls
// back to a deterministic grouping when the AI is unavailable, so this always
// returns something useful. Mirrors the mobile ClustersPanel (replit.md parity).
function ClustersPanel({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<IncidentClustersResult | null>(null);
  const find = useMutation({
    mutationFn: () => requestIncidentClusters(),
    onSuccess: setResult,
  });

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Find patterns</p>
            <p className="text-xs text-muted-foreground">
              Group recurring reports & crashes into likely root causes. Advisory only.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => find.mutate()}
          disabled={disabled || find.isPending}
        >
          {find.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 mr-2" />
          )}
          {result ? "Refresh" : "Analyze"}
        </Button>
      </div>

      {find.isError && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4" /> Couldn't analyze the incident log.
        </p>
      )}

      {result && (
        <div className="space-y-2" data-testid="incident-clusters-result">
          {result.note ? (
            <p className="text-sm text-muted-foreground">{result.note}</p>
          ) : (
            result.clusters.map((c, i) => (
              <div key={i} className="rounded-md border border-border bg-card p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[c.severity]}`}
                  >
                    {c.severity}
                  </span>
                  <span className="text-sm font-medium text-foreground">{c.theme}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.incidentCount} {c.incidentCount === 1 ? "incident" : "incidents"}
                  </span>
                </div>
                {c.rootCauseHypothesis && (
                  <p className="text-sm text-muted-foreground">{c.rootCauseHypothesis}</p>
                )}
                {c.recommendedAction && (
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Next step: </span>
                    {c.recommendedAction}
                  </p>
                )}
              </div>
            ))
          )}
          {!result.aiGenerated && !result.note && (
            <p className="text-[11px] text-muted-foreground">
              Showing a computed grouping (AI narration unavailable).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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

function IncidentRow({
  incident,
  assignees,
  initiallyExpanded = false,
}: {
  incident: Incident;
  assignees: Array<{ userId: string; name: string; role: string }>;
  initiallyExpanded?: boolean;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(initiallyExpanded || incident.status === "new");
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

  const isCrash = incident.source === "auto_crash";
  const ctx = incident.context ?? {};

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
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
          {incident.recurrence && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300 w-fit">
              <History className="w-3.5 h-3.5" />
              {incident.recurrence.count > 1
                ? `Seen ${incident.recurrence.count}× before`
                : "Seen before"}
            </div>
          )}
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
          {incident.diagnosis && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Diagnosis
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                {incident.diagnosis}
              </p>
            </div>
          )}
          {incident.workaround && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Suggested workaround
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                {incident.workaround}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {incident.status === "new" && (
              <Button size="sm" variant="outline" onClick={() => review.mutate()} disabled={busy}>
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
              <Button size="sm" onClick={() => resolve.mutate()} disabled={busy}>
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

function FieldChecksPanel({
  report,
  isLoading,
  error,
}: {
  report: Awaited<ReturnType<typeof fetchFieldChecks>> | undefined;
  isLoading: boolean;
  error: unknown;
}) {
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
            Passive evidence from normal staff use, scoped to this facility. No run data is collected.
          </p>
        </div>
        {report && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${FIELD_STATUS_CLASS[report.overallStatus]}`}>
            {FIELD_STATUS_LABEL[report.overallStatus]}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading field evidence…
        </div>
      ) : error ? (
        <p className="text-sm text-red-400">Couldn’t load field-check evidence.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {browserChecks.map((check) => (
              <FieldCheckCard key={check.name} check={check} />
            ))}
          </div>
          <div className="rounded-md border border-border bg-card/60 p-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Hardware-only checks
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              These remain unsupported by browser evidence and require guided human confirmation on the device.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hardwareChecks.map((check) => (
                <span key={check.name} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${FIELD_STATUS_CLASS[check.status]}`}>
                  {check.label}: {FIELD_STATUS_LABEL[check.status]}
                </span>
              ))}
            </div>
          </div>
          {actionable.length > 0 && (
            <div className="space-y-2" aria-label="Actionable field-check failures">
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">
                Recent field-check failures
              </p>
              {actionable.flatMap((check) =>
                check.recentFailures.slice(0, 3).map((failure, index) => (
                  <div key={`${check.name}-${failure.observedAt}-${index}`} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{check.label}</span>
                      <span className="text-muted-foreground">{timeAgo(failure.observedAt)}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {failure.outcome === "incomplete" ? "Repeatedly incomplete" : "Failed"} · build {failure.appBuild} · {failure.deviceCategory}
                    </p>
                    <p className="text-muted-foreground">
                      Browser-observed evidence only; measurements are bounded and contain no production payload.
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
          {FIELD_STATUS_LABEL[check.status]}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{check.evidence}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Last success: {check.lastSuccessfulAt ? timeAgo(check.lastSuccessfulAt) : "Not yet"}
      </p>
      {check.recentFailures.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Recent failures: {check.recentFailures.length} · latest {timeAgo(check.recentFailures[0].observedAt)} · {check.recentFailures[0].deviceCategory}
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

// Manager-only review queue of reported issues and auto-captured crashes, each
// with its stored AI diagnosis + workaround. Operators never see this tab.
export default function IncidentsTab() {
  const { hasCapability, isLoading: roleLoading } = useMe();
  const canReview = hasCapability("review-incidents");
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
  const [selectedIncidentId] = useState(() => {
    const match = window.location.hash.match(/^#incidents\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  const { data: assignees = [] } = useQuery({ queryKey: ["incidentAssignees"], queryFn: fetchIncidentAssignees, enabled: canReview });
  const { data: fieldChecks, isLoading: fieldChecksLoading, error: fieldChecksError } = useQuery({
    queryKey: ["fieldChecks"],
    queryFn: fetchFieldChecks,
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
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5 text-primary" /> Reported issues
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FieldChecksPanel report={fieldChecks} isLoading={fieldChecksLoading} error={fieldChecksError} />
        {hasIncidents && source !== "field_check" && <ClustersPanel disabled={isLoading} />}
        {hasAnyIssues && (
          <div className="space-y-2 pb-1">
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
          filtered.map((incident) => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              assignees={assignees}
              initiallyExpanded={incident.id === selectedIncidentId}
            />
          ))
        )}
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
