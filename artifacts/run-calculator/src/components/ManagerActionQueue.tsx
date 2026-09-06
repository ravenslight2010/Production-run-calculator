import { memo, useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ChevronDown, ClipboardCheck, ExternalLink, Lock, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMe } from "../useRole";
import { fetchActionQueue, updateActionItem, type ActionItem } from "../actionQueue";
import { fetchIncidentAssignees } from "../inventoryShared";
import { ATTENTION_STATE_CLASS, ATTENTION_STATE_LABEL, attentionStateForSeverity, nextActionForAttention, type AttentionState } from "../attentionStates";

const rank: Record<string, number> = { blocker: 0, review: 1, stale: 2, info: 3 };
const labels: Record<string, string> = { "data-health": "Data health", "production-rule": "Production rules", sync: "Sync", incident: "Incident", import: "Import", report: "Report" };
const age = (value: string) => {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  return days ? `${days}d old` : "today";
};
const queueStatuses = ["open", "in_progress", "deferred", "resolved"] as const;
type QueueData = { items: ActionItem[]; counts: Record<string, number>; nextCursor?: string | null };
type QueueMutationVariables = {
  item: ActionItem;
  input: Parameters<typeof updateActionItem>[1];
  queryKey: readonly ["manager-action-queue", string, string];
};

const ActionQueueItemCard = memo(function ActionQueueItemCard({
  item,
  assignees,
  mutationPending,
  noteOpen,
  note,
  onNoteChange,
  onToggleNote,
  onUpdate,
  onNavigate,
}: {
  item: ActionItem;
  assignees: Array<{ userId: string; name: string }>;
  mutationPending: boolean;
  noteOpen: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onToggleNote: (id: number) => void;
  onUpdate: (item: ActionItem, input: Parameters<typeof updateActionItem>[1]) => void;
  onNavigate?: (tab: string) => void;
}) {
  const state = (item.attentionState ?? attentionStateForSeverity(item.severity, item.status)) as AttentionState;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const primaryLabel = item.status === "open" ? "Claim" : "Open source";
  return <div key={item.id} className="rounded-md border border-border bg-background p-3" style={{ contentVisibility: "auto", containIntrinsicSize: "0 124px" }}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-sm">{item.title}</span><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ATTENTION_STATE_CLASS[state]}`} data-testid={`attention-state-${item.id}`}>{ATTENTION_STATE_LABEL[state]}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{labels[item.category] ?? item.category}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{item.description} · {age(item.createdAt)} · {item.assigneeName ?? "Unassigned"}</p>
    </div><a className="hidden shrink-0 items-center gap-1 text-xs text-primary hover:underline sm:inline-flex" href={item.sourcePath} onClick={(event) => {
      event.preventDefault();
      window.location.hash = item.sourcePath.replace(/^#/, "");
      onNavigate?.(item.sourcePath.startsWith("#incidents/")
        ? "incidents"
        : item.sourceType === "sync" ? "summary" : "setup");
    }}>Open source <ExternalLink className="h-3 w-3" /></a></div>
    <p className="mt-2 text-[11px] font-semibold text-muted-foreground">Next: {item.nextAction ?? nextActionForAttention(state, item.status)}</p>
    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 sm:flex sm:flex-wrap">
      {item.status === "open" ? <Button className="min-h-11 sm:min-h-9" disabled={mutationPending} onClick={() => onUpdate(item, { version: item.version, status: "in_progress", assigneeId: "me" })}>{primaryLabel}</Button> :
        <Button asChild className="min-h-11 sm:min-h-9"><a href={item.sourcePath} onClick={(event) => {
          event.preventDefault();
          window.location.hash = item.sourcePath.replace(/^#/, "");
          onNavigate?.(item.sourcePath.startsWith("#incidents/") ? "incidents" : item.sourceType === "sync" ? "summary" : "setup");
        }}>{primaryLabel}</a></Button>}
      <Button type="button" variant="outline" className="min-h-11 min-w-11 sm:min-h-9" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
        Details <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
      </Button>
    </div>
    {detailsOpen && <div className="mt-3 flex flex-col gap-2 rounded-md bg-muted/20 p-2 sm:flex-row sm:flex-wrap sm:items-center">
      <select aria-label={`Status for ${item.title}`} className="min-h-11 rounded border border-border bg-background px-3 text-sm sm:min-h-9 sm:text-xs" value={item.status} disabled={mutationPending} onChange={(e) => onUpdate(item, { version: item.version, status: e.target.value as ActionItem["status"] })}>
        {queueStatuses.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}
      </select>
      <select aria-label={`Owner for ${item.title}`} className="min-h-11 w-full rounded border border-border bg-background px-3 text-sm sm:min-h-9 sm:max-w-44 sm:text-xs" value={item.assigneeId ?? ""} disabled={mutationPending} onChange={(e) => onUpdate(item, { version: item.version, assigneeId: e.target.value || null })}>
        <option value="">Unassigned</option>{assignees.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
      </select>
      <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => onToggleNote(item.id)}>Add note</Button>
    </div>}
      {detailsOpen && noteOpen && <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input className="min-h-11 min-w-0 flex-1 rounded border border-border bg-background px-3 text-base sm:text-sm" placeholder={item.status === "deferred" ? "Why defer this?" : "Resolution or handoff note"} value={note} onChange={(e) => onNoteChange(e.target.value)} /><Button className="min-h-11" disabled={!note.trim() || mutationPending} onClick={() => onUpdate(item, { version: item.version, ...(item.status === "deferred" ? { deferReason: note } : { resolutionNote: note }) })}>Save note</Button></div>}
    {item.deferReason && <p className="mt-1 text-xs text-amber-600">Deferred: {item.deferReason}</p>}{item.resolutionNote && <p className="mt-1 text-xs text-muted-foreground">Note: {item.resolutionNote}</p>}
  </div>;
});

export default function ManagerActionQueue({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { hasCapability, isLoading: roleLoading } = useMe();
  const canView = hasCapability("manage-staff");
  const client = useQueryClient();
  const [filter, setFilter] = useState("open");
  const [category, setCategory] = useState("all");
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const queryKey = ["manager-action-queue", filter, category] as const;
  const query = useInfiniteQuery<QueueData, Error, InfiniteData<QueueData, string | undefined>, typeof queryKey, string | undefined>({
    queryKey: queryKey,
    queryFn: ({ pageParam }) => fetchActionQueue({
      status: filter,
      category,
      cursor: pageParam,
    }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: canView,
    staleTime: 10_000,
    // History is cursor-paginated. Polling while a manager is loading older
    // pages refetches every loaded page and can reset the cursor before the
    // manager reaches the oldest item. Active queues remain live; historical
    // views are refreshed explicitly with the existing Refresh action.
    refetchInterval: filter === "all" || filter === "resolved" ? false : 30_000,
  });
  const assignees = useQuery({ queryKey: ["incidentAssignees"], queryFn: fetchIncidentAssignees, enabled: canView });
  const mutation = useMutation({
    mutationFn: ({ item, input }: QueueMutationVariables) => updateActionItem(item.id, input),
    onSuccess: (updated, variables) => {
      // Patch the writer's cache from the authoritative PATCH response before
      // refetching. A refetch can briefly race another queue refresh, and the
      // manager should never see its own successful change revert in the UI.
      client.setQueryData<InfiniteData<QueueData, string | undefined>>(
        variables.queryKey,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => item.id === updated.id ? updated : item),
            })),
          };
        },
      );
      void client.invalidateQueries({ queryKey: ["manager-action-queue"] });
      setNoteFor(null);
      setNote("");
    },
  });
  const handleToggleNote = useCallback((id: number) => {
    setNoteFor((current) => current === id ? null : id);
  }, []);
  const handleUpdate = useCallback((item: ActionItem, input: Parameters<typeof updateActionItem>[1]) => {
    mutation.mutate({ item, input, queryKey });
  }, [mutation.mutate, queryKey]);
  const items = useMemo(() => (query.data?.pages.flatMap((page) => page.items) ?? []).filter((item) =>
    (filter === "all" || item.status === filter) && (category === "all" || item.category === category),
  ).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).sort((a, b) => {
    const aState = a.attentionState ?? attentionStateForSeverity(a.severity, a.status);
    const bState = b.attentionState ?? attentionStateForSeverity(b.severity, b.status);
    return rank[aState] - rank[bState] || Date.parse(a.createdAt) - Date.parse(b.createdAt);
  }), [query.data?.pages, filter, category]);
  const counts = query.data?.pages[0]?.counts ?? {};
  const lastPage = query.data?.pages[query.data.pages.length - 1];
  const hasOlderHistory = Boolean(lastPage?.nextCursor);
  if (!roleLoading && !canView) return <Card><CardContent className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> Manager action queue is restricted to managers.</CardContent></Card>;
  return <Card data-testid="manager-action-queue">
    <CardHeader className="pb-3"><div className="flex items-center justify-between gap-2">
      <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-primary" /> Manager action queue</CardTitle>
      <Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
    </div><p className="text-xs text-muted-foreground">One prioritized view of unresolved work. Source workflows remain the system of record.</p></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Filter action status" className="min-h-11 flex-1 rounded border border-border bg-background px-3 text-sm sm:min-h-9 sm:flex-none sm:text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
           {[...queueStatuses, "all"].map((value) => <option key={value} value={value}>{value === "all" ? "All" : value.replace("_", " ")}{value !== "all" ? ` (${counts[value] ?? 0})` : ""}</option>)}
        </select>
        <select aria-label="Filter action category" className="min-h-11 flex-1 rounded border border-border bg-background px-3 text-sm sm:min-h-9 sm:flex-none sm:text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All sources</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {query.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading manager actions…</p> :
        query.isError ? <p className="py-8 text-center text-sm text-destructive">Could not load manager actions.</p> :
        items.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{filter === "open" ? "No open actions. The facility is caught up." : "No actions match these filters."}</p> :
         <div className="space-y-2">{items.map((item) => <ActionQueueItemCard
           key={item.id}
           item={item}
           assignees={assignees.data ?? []}
           mutationPending={mutation.isPending}
           noteOpen={noteFor === item.id}
           note={note}
           onNoteChange={setNote}
           onToggleNote={handleToggleNote}
           onUpdate={handleUpdate}
           onNavigate={onNavigate}
         />)}</div>}
      {(filter === "all" || filter === "resolved") && hasOlderHistory && <Button
        className="w-full"
        variant="outline"
        onClick={() => void query.fetchNextPage()}
        disabled={query.isFetchingNextPage}
      >
        {query.isFetchingNextPage ? "Loading older history…" : "Load older history"}
      </Button>}
      {mutation.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <span>{mutation.error instanceof Error ? mutation.error.message : "This item changed. Refresh and try again."}</span>
        <Button size="sm" variant="outline" className="h-7 border-destructive/40 text-xs text-destructive" onClick={() => { mutation.reset(); void query.refetch(); }}>Refresh queue</Button>
      </div>}
    </CardContent>
  </Card>;
}