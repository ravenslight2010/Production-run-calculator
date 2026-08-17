// React Query hook for Run Insights suggestions (mobile parity with web's
// RUN_SUGGESTIONS_QUERY_KEY / useQuery in RunInsightsCard.tsx).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRunSuggestions } from "@/context/runInsights";

export const RUN_SUGGESTIONS_QUERY_KEY = ["run-suggestions"] as const;

export function useRunSuggestions() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: RUN_SUGGESTIONS_QUERY_KEY,
    queryFn: fetchRunSuggestions,
    staleTime: 30_000,
  });

  const suggestions = data ?? [];
  const pending = suggestions
    .filter((s) => s.status === "pending")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const followUps = suggestions.filter((s) => s.status === "accepted" && s.followUpNote);

  return {
    suggestions,
    pending,
    current: pending[0] ?? null,
    followUps,
    isLoading,
    isFetching,
    refetch,
    qc,
    queryKey: RUN_SUGGESTIONS_QUERY_KEY,
  };
}
