/** Slim countdown row + progress bar under a dough stepper. */

function fmtMS(totalSec: number): string {
  if (!Number.isFinite(totalSec)) return "\u2014:\u2014";
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TickBar({
  label,
  secLeft,
  periodSec,
  color,
}: {
  label: string;
  secLeft: number;
  periodSec: number;
  color: string;
}) {
  const pct = periodSec > 0 ? Math.min(100, Math.max(0, (1 - secLeft / periodSec) * 100)) : 0;
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-[10px] font-mono font-semibold tabular-nums ${color}`}>{fmtMS(secLeft)}</span>
      </div>
      <div className="h-1 rounded-full bg-muted/40 overflow-hidden mt-0.5">
        <div
          data-testid="tickbar-fill"
          className={`h-full rounded-full ${color.replace("text-", "bg-")}`}
          style={{ width: `${pct}%`, transition: "width 1s linear" }}
        />
      </div>
    </div>
  );
}
