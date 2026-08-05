import { useQuery } from "@tanstack/react-query";
import type { RunTemplate } from "../types";

// ── Run templates API helpers ─────────────────────────────────────────────────
// The server is the source of truth for run templates (facility-wide, shared
// across all devices signed into the same scope). localStorage is used only
// during the one-time migration heal (see factoryDataSync.ts:runTemplatesMigration).

async function fetchRunTemplates(): Promise<RunTemplate[]> {
  const res = await fetch("/api/run-templates");
  if (!res.ok) throw new Error(`fetchRunTemplates failed (${res.status})`);
  const body = (await res.json()) as { templates?: RunTemplate[] };
  return body.templates ?? [];
}

/** POST one template to the server; returns the updated server list. */
export async function saveRunTemplateApi(template: RunTemplate): Promise<RunTemplate[]> {
  const res = await fetch("/api/run-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templates: [template] }),
  });
  if (!res.ok) throw new Error(`saveRunTemplate failed (${res.status})`);
  const body = (await res.json()) as { templates?: RunTemplate[] };
  return body.templates ?? [];
}

/** DELETE templates by id from the server; returns the updated server list. */
export async function deleteRunTemplatesApi(ids: string[]): Promise<RunTemplate[]> {
  const res = await fetch("/api/run-templates", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`deleteRunTemplates failed (${res.status})`);
  const body = (await res.json()) as { templates?: RunTemplate[] };
  return body.templates ?? [];
}

/** React Query key for run templates. */
export const RUN_TEMPLATES_QUERY_KEY = ["runTemplates"] as const;

/**
 * Fetch and cache the facility-wide run templates list.
 * Suitable for use in multiple components — they all share the same cache entry.
 */
export function useRunTemplates(): {
  templates: RunTemplate[];
  isLoaded: boolean;
} {
  const { data, isFetched } = useQuery({
    queryKey: RUN_TEMPLATES_QUERY_KEY,
    queryFn: fetchRunTemplates,
    staleTime: 30_000,
  });
  return { templates: data ?? [], isLoaded: isFetched };
}
