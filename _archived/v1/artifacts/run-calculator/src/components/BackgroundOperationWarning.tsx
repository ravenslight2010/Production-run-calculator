import { AlertTriangle } from "lucide-react";
import {
  getGetBackgroundOperationDiagnosticsQueryKey,
  useGetBackgroundOperationDiagnostics,
} from "@workspace/api-client-react";
import { useMe } from "../useRole";

const operationLabels = {
  "daily-rollover": "Daily rollover",
  "server-job-run": "Background jobs",
  "server-job-prune": "Job cleanup",
  "web-push-schedule": "Push notifications",
} as const;

export default function BackgroundOperationWarning() {
  const { hasCapability, isLoading } = useMe();
  const canView = hasCapability("manage-staff");
  const query = useGetBackgroundOperationDiagnostics({
    query: {
      enabled: canView,
      queryKey: getGetBackgroundOperationDiagnosticsQueryKey(),
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });

  const warnings = query.data?.warnings ?? [];
  const deferred = query.data?.automaticTrackingBackoff;
  if (
    isLoading
    || !canView
    || (!warnings.length && !deferred?.deferredDateCount)
  ) return null;

  return (
    <section
      className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
      role="status"
      data-testid="background-operation-warning"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold">
            {warnings.length > 0
              ? "Background work needs attention"
              : "Background work status"}
          </h3>
          {warnings.length > 0 && (
            <p className="mt-0.5 text-xs">
              Some automated work has failed repeatedly. The warning clears automatically when failures age out.
            </p>
          )}
          {deferred && deferred.deferredDateCount > 0 && (
            <p className="mt-2 text-xs" data-testid="automatic-tracking-backoff">
              Automatic tracking is temporarily waiting to retry for{" "}
              {deferred.deferredDateCount}{deferred.deferredDateCountCapped ? "+" : ""}{" "}
              {deferred.deferredDateCount === 1 && !deferred.deferredDateCountCapped ? "date" : "dates"}.
              {deferred.nextEligibleRetryAt && (
                <>
                  {" "}Next retry is eligible{" "}
                  <time dateTime={deferred.nextEligibleRetryAt}>
                    {new Date(deferred.nextEligibleRetryAt).toLocaleString()}
                  </time>.
                </>
              )}
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {warnings.map((warning) => (
                <li
                  key={warning.operation}
                  data-testid={`background-operation-${warning.operation}`}
                >
                  <span className="font-medium">{operationLabels[warning.operation]}</span>
                  {" — latest failure "}
                  <time dateTime={warning.lastFailureAt}>
                    {new Date(warning.lastFailureAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}