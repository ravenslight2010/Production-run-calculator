import { useMemo, useState } from "react";
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
  markIncidentReviewed,
  markIncidentResolved,
  type Incident,
} from "../inventoryShared";
import { useMe } from "../useRole";

type StatusFilter = "all" | "new" | "reviewed" | "resolved";
type PlatformFilter = "all" | "web" | "mobile";
type SourceFilter = "all" | "user_report" | "auto_crash";

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

function IncidentRow({ incident }: { incident: Incident }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(incident.status === "new");
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
  const busy = review.isPending || resolve.isPending;

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

// Manager-only review queue of reported issues and auto-captured crashes, each
// with its stored AI diagnosis + workaround. Operators never see this tab.
export default function IncidentsTab() {
  const { isManager, isLoading: roleLoading } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    enabled: isManager,
    refetchInterval: 20_000,
  });

  const [status, setStatus] = useState<StatusFilter>("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");

  const incidents = data ?? [];
  const filtered = useMemo(
    () =>
      incidents.filter(
        (i) =>
          (status === "all" || i.status === status) &&
          (platform === "all" || i.appPlatform === platform) &&
          (source === "all" || i.source === source),
      ),
    [incidents, status, platform, source],
  );

  if (!roleLoading && !isManager) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5 text-primary" /> Reported issues
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasIncidents && (
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
            <IncidentRow key={incident.id} incident={incident} />
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
