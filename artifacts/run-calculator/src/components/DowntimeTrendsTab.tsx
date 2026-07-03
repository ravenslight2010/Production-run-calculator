import { useMemo } from "react";
import { aggregateDowntime, type DayIn } from "@workspace/downtime-trends";
import { OctagonX, Clock, CalendarDays, TrendingDown } from "lucide-react";

// Manager view: aggregates the stoppages logged on runs across the synced
// 14-day history (plus today) into plain-language downtime trends. Pure
// client-side read — computed by @workspace/downtime-trends from data the app
// already has; nothing here writes anything.

function fmtMin(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtHour(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp} ${ampm}`;
}

const TYPE_LABELS: Record<string, string> = {
  stop: "Line stops",
  pause: "Pauses / breaks",
  manual: "Logged by hand",
  other: "Other",
};

function Bar({ value, max, color = "bg-amber-500" }: { value: number; max: number; color?: string }) {
  const pct = value <= 0 ? 0 : max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-secondary overflow-hidden flex-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function DowntimeTrendsTab({ days }: { days: DayIn[] }) {
  const trends = useMemo(
    () => aggregateDowntime(days, { nowMs: Date.now(), tzOffsetMin: new Date().getTimezoneOffset() }),
    [days],
  );

  const maxDayMin = Math.max(1, ...trends.days.map((d) => d.minutes));
  const maxHourMin = Math.max(1, ...trends.byHour.map((h) => h.minutes));
  const maxRunMin = Math.max(1, ...trends.byRun.map((r) => r.minutes));

  return (
    <div className="space-y-4 pb-24" data-testid="downtime-trends-tab">
      <div className="flex items-center gap-2 mb-2">
        <TrendingDown className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold">Downtime Trends</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Every stoppage logged on runs over the last {Math.max(trends.days.length, 1)} day{trends.days.length === 1 ? "" : "s"}, rolled up so you can spot patterns.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <Clock className="w-4 h-4 mx-auto mb-1 text-amber-400" />
          <p className="text-xl font-black" data-testid="downtime-total-minutes">{fmtMin(trends.totalMinutes)}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total downtime</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <OctagonX className="w-4 h-4 mx-auto mb-1 text-red-400" />
          <p className="text-xl font-black" data-testid="downtime-total-count">{trends.totalCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stoppages</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <CalendarDays className="w-4 h-4 mx-auto mb-1 text-sky-400" />
          <p className="text-xl font-black">{trends.daysWithDowntime}<span className="text-sm text-muted-foreground font-bold">/{trends.days.length}</span></p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Days affected</p>
        </div>
      </div>

      {trends.totalCount === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="downtime-empty">
          No stoppages logged in this window yet. When the crew logs a stop or pause on a run, the trends show up here.
        </div>
      ) : (
        <>
          {/* Per-day bars */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h3 className="text-sm font-bold mb-1">Downtime by day</h3>
            {trends.days.map((d) => (
              <div key={d.date} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">{fmtDate(d.date)}</span>
                <Bar value={d.minutes} max={maxDayMin} />
                <span className="w-16 shrink-0 text-right font-mono">{d.minutes > 0 ? `${fmtMin(d.minutes)} · ${d.count}×` : "—"}</span>
              </div>
            ))}
          </div>

          {/* Top reasons */}
          {trends.topReasons.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-bold mb-1">Most common reasons</h3>
              {trends.topReasons.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{r.key}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{fmtMin(r.minutes)} · {r.count}×</span>
                </div>
              ))}
            </div>
          )}

          {/* Time of day */}
          {trends.byHour.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-bold mb-1">When stoppages happen</h3>
              {trends.byHour.map((h) => (
                <div key={h.key} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 text-muted-foreground">{fmtHour(Number(h.key))}</span>
                  <Bar value={h.minutes} max={maxHourMin} color="bg-sky-500" />
                  <span className="w-16 shrink-0 text-right font-mono">{fmtMin(h.minutes)} · {h.count}×</span>
                </div>
              ))}
            </div>
          )}

          {/* By product */}
          {trends.byRun.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-bold mb-1">Downtime by product</h3>
              {trends.byRun.slice(0, 8).map((r) => (
                <div key={r.key} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 truncate text-muted-foreground">{r.key}</span>
                  <Bar value={r.minutes} max={maxRunMin} color="bg-red-500" />
                  <span className="w-16 shrink-0 text-right font-mono">{fmtMin(r.minutes)} · {r.count}×</span>
                </div>
              ))}
            </div>
          )}

          {/* By type */}
          {trends.byType.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-bold mb-1">By kind of stoppage</h3>
              {trends.byType.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-2 text-xs">
                  <span>{TYPE_LABELS[t.key] ?? t.key}</span>
                  <span className="font-mono text-muted-foreground">{fmtMin(t.minutes)} · {t.count}×</span>
                </div>
              ))}
            </div>
          )}

          {/* Longest single stoppages */}
          {trends.longest.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-bold mb-1">Longest single stoppages</h3>
              {trends.longest.map((l, i) => (
                <div key={`${l.date}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className="text-muted-foreground">{fmtDate(l.date)}</span> · {l.runLabel} — {l.reason}
                  </span>
                  <span className="shrink-0 font-mono font-bold text-amber-400">{fmtMin(l.minutes)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
