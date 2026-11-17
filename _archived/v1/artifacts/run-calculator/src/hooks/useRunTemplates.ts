import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunTemplate } from "../types";
import {
  deleteRunTemplate,
  localRunTemplates,
  reconcileRunTemplates,
  saveRunTemplate,
  getRunTemplatesScope,
  subscribeRunTemplates,
  runTemplatesVersion,
  runTemplatesStatus,
  runTemplatesGeneration,
  startRunTemplatesRepository,
  type RunTemplateScope,
} from "../runTemplatesRepository";
import { useAuth } from "../useAuth";

/** React Query key for run templates. Kept stable for existing consumers. */
export const RUN_TEMPLATES_QUERY_KEY = ["runTemplates"] as const;
export function runTemplatesQueryKey(scope = getRunTemplatesScope()) {
  return [...RUN_TEMPLATES_QUERY_KEY, scope] as const;
}

/**
 * Compatibility mutation helpers. They durably queue the intent and update
 * memory; callers receive the immediately visible list rather than waiting
 * for an unavailable network.
 */
export async function saveRunTemplateApi(template: RunTemplate): Promise<RunTemplate[]> {
  return saveRunTemplate(template);
}
export async function deleteRunTemplatesApi(ids: string[]): Promise<RunTemplate[]> {
  let templates = localRunTemplates();
  for (const id of ids) templates = deleteRunTemplate(id);
  return templates;
}

export function useRunTemplates(): { templates: RunTemplate[]; isLoaded: boolean } {
  const { me } = useAuth();
  const scope: RunTemplateScope = me?.sandbox ? "sandbox" : "live";
  useSyncExternalStore(subscribeRunTemplates, runTemplatesVersion);
  const generation = runTemplatesGeneration();
  const queryClient = useQueryClient();
  const queryKey = [...runTemplatesQueryKey(scope), me?.userId ?? null];
  const query = useQuery({
    queryKey,
    queryFn: () => reconcileRunTemplates(),
    initialData: localRunTemplates,
    staleTime: 30_000,
    enabled: !!me,
  });
  useEffect(() => startRunTemplatesRepository(() => {
    queryClient.setQueryData(queryKey, localRunTemplates());
  }), [queryClient, scope, me?.userId, generation]);
  return { templates: localRunTemplates(), isLoaded: runTemplatesStatus() === "ready" };
}