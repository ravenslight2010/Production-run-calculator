import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuditLogEntry {
  id: number;
  scope: string;
  actor: string;
  action: string;
  resource: string;
  changes: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

function fmtChanges(changes: Record<string, unknown>): string {
  if (!changes || typeof changes !== "object") return "—";
  const keys = Object.keys(changes);
  if (keys.length === 0) return "—";
  // Summarise neatly: "field: before → after" for up to 3 fields
  const parts = keys.slice(0, 3).map((k) => {
    const v = changes[k];
    if (v !== null && typeof v === "object" && "from" in (v as object) && "to" in (v as object)) {
      const rec = v as { from: unknown; to: unknown };
      const from = rec.from == null ? "—" : String(rec.from).slice(0, 30);
      const to = rec.to == null ? "—" : String(rec.to).slice(0, 30);
      return `${k}: ${from} → ${to}`;
    }
    return `${k}: ${JSON.stringify(v).slice(0, 40)}`;
  });
  return parts.join(" · ") + (keys.length > 3 ? ` (+${keys.length - 3} more)` : "");
}

function fmtTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function actionBadgeClass(action: string): string {
  if (action.includes("delete") || action.includes("reset") || action.includes("purge"))
    return "bg-destructive/15 text-destructive";
  if (action.includes("create") || action.includes("add"))
    return "bg-emerald-500/15 text-emerald-400";
  if (action.includes("update") || action.includes("edit"))
    return "bg-sky-500/15 text-sky-400";
  return "bg-muted text-muted-foreground";
}

// Default date range: last 30 days
function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Manager-only read-only audit log viewer.
// Reads from GET /api/audit-logs with optional date-range and limit filters.
export default function AuditLogCard() {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [limit, setLimit] = useState(100);

  // Committed filter state — only update on explicit Apply
  const [committedStart, setCommittedStart] = useState(startDate);
  const [committedEnd, setCommittedEnd] = useState(endDate);
  const [committedLimit, setCommittedLimit] = useState(limit);

  const params = new URLSearchParams({
    scope: "live",
    ...(committedStart ? { startDate: committedStart } : {}),
    ...(committedEnd ? { endDate: committedEnd + "T23:59:59" } : {}),
    limit: String(Math.min(Math.max(1, committedLimit), 1000)),
  });

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    logs: AuditLogEntry[];
    count: number;
  }>({
    queryKey: ["audit-logs", committedStart, committedEnd, committedLimit],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch audit logs (${res.status})`);
      return res.json() as Promise<{ logs: AuditLogEntry[]; count: number }>;
    },
    staleTime: 30_000,
  });

  function applyFilter() {
    setCommittedStart(startDate);
    setCommittedEnd(endDate);
    setCommittedLimit(limit);
  }

  const logs = data?.logs ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-amber-400" />
          Audit Log
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Read-only record of high-stakes actions: factory resets, production rule changes, and
          similar manager-level events. Stored server-side and cannot be edited or deleted.
        </p>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
              From
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-7 text-xs w-36"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
              To
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-7 text-xs w-36"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
              Max rows
            </label>
            <Input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 100)}
              className="h-7 text-xs w-20"
            />
          </div>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={applyFilter}>
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive py-3">Failed to load audit log. Make sure you have manager access.</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3">No audit events in this date range.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[11px] min-w-[560px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Timestamp
                  </th>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Actor
                  </th>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Action
                  </th>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Resource
                  </th>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground">
                    Summary
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors"
                  >
                    <td className="px-2.5 py-1.5 whitespace-nowrap text-muted-foreground">
                      {fmtTimestamp(log.createdAt)}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap font-medium text-foreground">
                      {log.actor || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${actionBadgeClass(log.action)}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap text-muted-foreground">
                      {log.resource || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-muted-foreground max-w-xs truncate">
                      {fmtChanges(log.changes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !isError && logs.length > 0 && (
          <p className="text-[10px] text-muted-foreground text-right">
            {logs.length} event{logs.length === 1 ? "" : "s"} shown
            {logs.length >= committedLimit ? ` (limit ${committedLimit} — increase Max rows to see more)` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
