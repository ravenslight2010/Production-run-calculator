import { useQuery } from "@tanstack/react-query";
import { fetchRunTemplates } from "../runTemplatesApi";
import type { RunTemplate } from "../types";

// Facility-wide saved run templates, shared by every signed-in user. Polls in
// the background so a template saved on one device shows up on another without a
// manual refresh. Open to everyone signed in (the GET endpoint is requireAuth,
// not manager-gated) — templates are a shared convenience.
export function useRunTemplates(): {
  templates: RunTemplate[];
  isLoading: boolean;
  isSuccess: boolean;
} {
  const { data, isLoading, isSuccess } = useQuery({
    queryKey: ["runTemplates"],
    queryFn: fetchRunTemplates,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { templates: data ?? [], isLoading, isSuccess };
}
