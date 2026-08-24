import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Download, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useState } from "react";
import type { SyncDiagnostic } from "../syncDiagnostics";
import { ATTENTION_STATE_CLASS, ATTENTION_STATE_LABEL, type AttentionState } from "../attentionStates";

export type SyncStatus = "connected" | "syncing" | "retrying" | "synchronized" | "delayed" | "failed";

type Props = {
  status: SyncStatus;
  connected: boolean;
  date: string;
  lastAcknowledgedAt: number | null;
  pendingCount: number;
  failedCount: number;
  diagnostics: SyncDiagnostic[];
  canViewConflicts: boolean;
  onRetry: () => void;
  onOpenConflicts: () => void;
  onExportDiagnostics: () => void;
};

const labels: Record<SyncStatus, string> = {
  connected: "Connected",
  syncing: "Syncing",
  retrying: "Retrying",
  synchronized: "Synchronized",
  delayed: "Delayed",
  failed: "Sync failed",
};

function time(at: number | null): string {
  return at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not yet";
}

export default function SyncStatusPopover(props: Props) {
  const [open, setOpen] = useState(false);
  const failed = props.status === "failed";
  const delayed = props.status === "delayed";
  const Icon = failed ? AlertTriangle : !props.connected ? WifiOff : props.status === "syncing" || props.status === "retrying" ? Loader2 : props.status === "synchronized" ? CheckCircle2 : delayed ? Clock3 : Wifi;
  const color = failed ? "text-red-400" : delayed || props.status === "retrying" ? "text-amber-400" : props.status === "synchronized" ? "text-emerald-400" : "text-muted-foreground";
  const attentionState: AttentionState = failed ? "blocker" : delayed || props.status === "retrying" || props.pendingCount > 0 ? "review" : "info";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={props.connected ? "Sync connected" : `Sync: ${labels[props.status]}`}
        className={`flex h-8 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold ${color} hover:bg-muted/60`}>
        <Icon className={`h-3.5 w-3.5 ${props.status === "syncing" ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">{labels[props.status]}</span>
        {(props.pendingCount > 0 || props.failedCount > 0) && <span className="rounded-full bg-red-500/20 px-1 text-[9px]">{props.pendingCount + props.failedCount}</span>}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 rounded-md border border-border bg-background p-3 text-xs shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
               <div className="flex items-center gap-2"><p className={`font-semibold ${color}`}>{labels[props.status]}</p><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ATTENTION_STATE_CLASS[attentionState]}`}>{ATTENTION_STATE_LABEL[attentionState]}</span></div>
              <p className="mt-1 text-muted-foreground">
                {failed || delayed || props.status === "retrying"
                  ? "Your local change is retained on this device. It is not shared until the server acknowledges it."
                  : "Local changes are safe here; the server acknowledgment below confirms shared persistence."}
              </p>
            </div>
            <span className={`h-2 w-2 rounded-full ${failed ? "bg-red-500" : delayed || props.status === "retrying" ? "bg-amber-400" : "bg-emerald-500"}`} />
          </div>
           <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-muted/30 p-2">
             <span>Next action</span><strong className="text-right">{failed ? "Retry latest retained change" : attentionState === "review" ? "Retry and confirm acknowledgment" : "Monitor"}</strong>
            <span>Production date</span><strong className="text-right">{props.date}</strong>
            <span>Last acknowledgment</span><strong className="text-right">{time(props.lastAcknowledgedAt)}</strong>
            <span>Pending writes</span><strong className="text-right">{props.pendingCount}</strong>
            <span>Failed writes</span><strong className="text-right">{props.failedCount}</strong>
          </div>
          {(failed || delayed || props.pendingCount > 0) && (
            <button type="button" onClick={props.onRetry} className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-primary px-2 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
              <RefreshCw className="h-3.5 w-3.5" /> Retry latest retained change
            </button>
          )}
          {props.canViewConflicts && (
            <button type="button" onClick={props.onOpenConflicts} className="mt-2 w-full rounded border border-border px-2 py-1.5 text-left hover:bg-muted/50">
              Open manager conflict monitor <span className="text-muted-foreground">(history only)</span>
            </button>
          )}
          <button type="button" onClick={props.onExportDiagnostics} className="mt-2 flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 font-semibold hover:bg-muted/50">
            <Download className="h-3.5 w-3.5" /> Download sync diagnostics
          </button>
          <div className="mt-3 border-t border-border pt-2">
            <p className="mb-1 font-semibold">Recent sync activity</p>
            <div className="max-h-36 space-y-1 overflow-auto text-[11px] text-muted-foreground">
              {props.diagnostics.length === 0 ? <p>No activity recorded yet.</p> : props.diagnostics.slice().reverse().map((event) => (
                <p key={event.id}><span className="mr-1 text-foreground">{time(event.at)}</span>{event.message}{event.response ? ` [${event.response}]` : ""}{event.runId ? ` · Run ${event.runId.slice(0, 12)}` : ""}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}