import { FileClock } from "lucide-react";
import {
  getGetQcImportReviewBadgesQueryKey,
  useGetQcImportReviewBadges,
} from "@workspace/api-client-react";
import { requestOpenQcImportReview } from "../qcImportReviewNavigation";

export const QC_IMPORT_REVIEW_POLL_MS = 30_000;

/** Counts-only badge for every authenticated user. Never exposes details or navigation. */
export function QcImportReviewBadge() {
  const query = useGetQcImportReviewBadges({
    query: {
      queryKey: getGetQcImportReviewBadgesQueryKey(),
      refetchInterval: QC_IMPORT_REVIEW_POLL_MS,
      retry: 1,
    },
  });
  if (!query.data) return null;
  const { pending, rejected } = query.data;
  if (!pending && !rejected) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-2 py-1.5 sm:px-4">
      <button
        type="button"
        aria-label={`Open Import QC review: ${pending} pending, ${rejected} rejected`}
        onClick={requestOpenQcImportReview}
        data-testid="badge-qc-import-review"
        className="inline-flex min-h-10 max-w-full flex-wrap items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-semibold shadow-md backdrop-blur transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <FileClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span>Import QC</span>
        <span
          data-testid="text-qc-import-badge-pending"
          className="rounded-full bg-amber-500/15 px-2 text-amber-800 dark:text-amber-200"
        >
          {pending} pending
        </span>
        {rejected > 0 && (
          <span
            data-testid="text-qc-import-badge-rejected"
            className="rounded-full bg-rose-500/15 px-2 text-rose-800 dark:text-rose-200"
          >
            {rejected} rejected
          </span>
        )}
      </button>
    </div>
  );
}
