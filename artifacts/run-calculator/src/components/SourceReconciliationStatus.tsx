import type { SourceLibraryReconciliationStatus } from "@workspace/api-client-react";

export function SourceReconciliationStatus({
  status,
}: {
  status: SourceLibraryReconciliationStatus;
}) {
  if (status.status === "not-applicable")
    return (
      <div
        data-testid="source-reconciliation-status"
        role="status"
        aria-live="polite"
        className="rounded border border-border/70 bg-muted/20 p-2.5 text-xs"
      >
        <p className="font-medium">
          Historical production audit: Not applicable
        </p>
        <p className="mt-1 text-muted-foreground">
          This is a fresh self-hosted installation. Replit’s historical audit
          data and repair authority are not included. No historical repair has
          been claimed or verified. The current data-health checks below still
          apply.
        </p>
      </div>
    );
  const sourceStatusLabel =
    status.status === "not-verified"
      ? "Not verified"
      : status.status === "clean"
        ? "Clean"
        : status.status === "warning"
          ? "Review needed"
          : "Verification error";
  const sourceStatusClass =
    status.status === "clean"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status.status === "warning"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-destructive/10 text-destructive";

  return (
    <div
      data-testid="source-reconciliation-status"
      role="status"
      aria-live="polite"
      className="rounded border border-border/70 bg-muted/20 p-2.5 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Authoritative source reconciliation</p>
          <p className="text-muted-foreground">
            Report {status.report.sha256.slice(0, 12)} · captured{" "}
            {new Date(status.report.snapshot.capturedAt).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-[10px] font-semibold ${sourceStatusClass}`}
        >
          {sourceStatusLabel} · {status.freshness}
        </span>
      </div>
      <p className="mt-1 break-all text-[11px] text-muted-foreground">
        {status.report.path} · verified{" "}
        {new Date(status.checkedAt).toLocaleString()}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-muted px-1.5 py-0.5">
          {status.report.automaticProposals} approved proposals
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {status.report.stubs} protected-stub candidates
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {status.summary.protectedHistoryReferences} protected history links
        </span>
        {status.summary.omittedFindings > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {status.summary.omittedFindings} additional findings summarized
          </span>
        )}
      </div>
      {!status.heal.markerValid && (
        <p className="mt-2 text-[11px] text-destructive">
          The approved source heal marker is missing or invalid. Findings are
          review-only until the release verification is restored.
        </p>
      )}
    </div>
  );
}
