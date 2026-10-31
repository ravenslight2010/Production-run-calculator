import { fmt, type ExpiryReminders } from "./shared";

// Factual seven-day count only: no notification is sent and nothing is authorized here.
export default function ExpiryReminderPanel({ reminders }: { reminders: ExpiryReminders | null | undefined }) {
  if (reminders === undefined) return null;
  const base = "mt-3 rounded-md border p-3 text-sm";
  if (reminders === null) {
    return (
      <div className={`${base} border-dashed border-border bg-muted/30 text-muted-foreground`} data-testid="gold-approvals-reminders-unavailable">
        <p className="font-medium text-foreground">Seven-day expiry count unavailable</p>
        <p className="mt-1 text-xs">
          The server did not report an expiry summary for this scope. This is not the same as zero. Check each
          approval's Valid until date below.
        </p>
      </div>
    );
  }
  const n = reminders.expiringCount;
  const tone = n > 0 ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted/30";
  return (
    <div className={`${base} ${tone}`} data-testid="gold-approvals-reminders">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="gold-approvals-reminders-count">{n}</span>
        <span className="font-medium">
          {n === 1 ? "verified approval expires" : "verified approvals expire"} within the next {reminders.windowDays} days
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Counted across this whole scope (not just the rows shown or the current lookup), as of {fmt(reminders.asOf)}.
        No reminder is sent. Expiry cannot be extended: once an approval passes Valid until, record new metadata and
        have it verified separately.
      </p>
    </div>
  );
}
