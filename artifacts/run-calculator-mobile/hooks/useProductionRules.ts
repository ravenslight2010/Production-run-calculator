import { useQuery } from "@tanstack/react-query";
import type { ProductionRule } from "@workspace/production-rules";
import { fetchProductionRules } from "../context/productionRules";

// Factory-wide production rules, shared by the run-config evaluation (warn/block)
// and the manager management UI. Mirrors the web hook (replit.md parity). Open to
// everyone signed in (the GET endpoint is requireAuth, not manager-gated) because
// both operators and managers need rules evaluated against their runs.
export function useProductionRules(): {
  rules: ProductionRule[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["productionRules"],
    queryFn: fetchProductionRules,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { rules: data ?? [], isLoading };
}
