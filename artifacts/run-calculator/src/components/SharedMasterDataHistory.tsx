import { useEffect, useRef, useState } from "react";
import { fetchSharedMasterDataHistory, undoSharedMasterDataChange, SharedMasterDataError, type SharedMasterDataOperation } from "../sharedMasterDataUndo";
import { Button } from "./ui/button";

type Props = {
  identity: string;
  revision: number;
  onRefresh(operation: SharedMasterDataOperation): Promise<void>;
  confirm(operation: SharedMasterDataOperation): Promise<boolean>;
  onBusyChange(busy: boolean): void;
  mutationBusy: boolean;
  canUndo: boolean;
  onOpenImports(): void;
  onOpenDataHealth?: () => void;
};
export function SharedMasterDataHistory({ identity, revision, onRefresh, confirm, onBusyChange, mutationBusy, canUndo, onOpenImports, onOpenDataHealth }: Props) {
  const [items, setItems] = useState<SharedMasterDataOperation[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const lifecycle = useRef(0);
  const load = async (before?: number) => {
    const token = lifecycle.current;
    setBusy(true); setError("");
    try {
      const page = await fetchSharedMasterDataHistory(before);
      if (lifecycle.current !== token) return;
      setItems((current) => before === undefined ? page.items : [...current, ...page.items.filter((row) => !current.some((old) => old.id === row.id))].slice(-200));
      setCursor(page.nextCursor);
    } catch (failure) {
      if (lifecycle.current === token) setError(failure instanceof Error ? failure.message : "Shared history is unavailable. Retry online.");
    } finally { if (lifecycle.current === token) setBusy(false); }
  };
  useEffect(() => {
    lifecycle.current++;
    setItems([]); setCursor(null); setMessage("");
    void load();
    return () => { lifecycle.current++; };
  }, [identity, revision]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const undo = async (item: SharedMasterDataOperation) => {
    if (busy || mutationBusy || !canUndo || !online || (!item.eligible && item.status !== "conflicting")) return;
    const token = lifecycle.current;
    if (!await confirm(item) || token !== lifecycle.current) return;
    setBusy(true); setError(""); setMessage("");
    onBusyChange(true);
    try {
      const result = await undoSharedMasterDataChange(item.id);
      if (token !== lifecycle.current) return;
      const { affectedRunReferences: _references, ...metadata } = result;
      setItems((current) => current.map((row) => row.id === result.id ? metadata : row));
      setMessage("Undo confirmed by the server. Shared records are refreshing.");
      try { await onRefresh(result); }
      catch (failure) {
        if (token === lifecycle.current) setError(failure instanceof Error ? `Undo is confirmed. ${failure.message}`
          : "Undo is confirmed, but this device has not refreshed all canonical records. Reconnect and refresh before making another edit.");
      }
    } catch (failure) {
      if (token !== lifecycle.current) return;
      setError(failure instanceof Error ? failure.message : "Undo was not confirmed. Refresh shared history.");
      if (failure instanceof SharedMasterDataError && failure.status === 409) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "conflicting" } : row));
      }
    } finally { onBusyChange(false); if (token === lifecycle.current) setBusy(false); }
  };
  return <section aria-label="Shared master-data history" className="mt-6 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Shared change history</h3>
      <Button type="button" size="sm" variant="outline" disabled={busy || !online} onClick={() => { void load(); }}>Refresh history</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      Manager-only, server-recorded changes for this scope. Undo checks the current records and pending-run references before restoring anything.
      Import and Data Health repairs keep their own guarded Undo actions.
    </p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || mutationBusy} onClick={onOpenImports}>Import history</Button>
      {onOpenDataHealth && <Button type="button" size="sm" variant="outline" disabled={busy || mutationBusy} onClick={onOpenDataHealth}>Data Health</Button>}
    </div>
    {!online && <p role="status" className="mt-2 text-xs">Offline: history may be out of date. Undo requires an online canonical confirmation.</p>}
    {!canUndo && <p role="status" className="mt-2 text-xs">Undo also requires inventory and profile permissions. Shared history remains read-only.</p>}
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {busy && <p role="status" className="mt-2 text-xs">Waiting for server confirmation…</p>}
    {!busy && !error && items.length === 0 && <p className="mt-3 text-xs text-muted-foreground">No server-recorded changes in this scope.</p>}
    <ol className="mt-3 space-y-2">
      {items.map((item) => <li key={item.id} className="rounded border border-border p-3 text-xs">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 break-words">
            <p className="font-medium">{item.description}</p>
            <p className="mt-1 text-muted-foreground">{new Date(item.createdAt).toLocaleString()} · Actor {item.actorId}</p>
            <p className="mt-1">{item.affectedRecords} records · {item.affectedReferences} pending-run references · {item.status}</p>
            {item.unavailableReason && <p className="mt-1">{item.unavailableReason}</p>}
            {item.status === "conflicting" && <p className="mt-1">Review newer shared edits or started runs. Undo never overwrites a changed dependency.</p>}
            {item.status === "undone" && <p className="mt-1">Server-confirmed Undo{item.undoneAt ? ` · ${new Date(item.undoneAt).toLocaleString()}` : ""}</p>}
          </div>
          {(item.eligible || item.status === "conflicting") && item.status !== "undone" && <Button type="button" size="sm" variant="outline" disabled={busy || mutationBusy || !canUndo || !online}
            onClick={() => { void undo(item); }}>{item.status === "conflicting" ? "Recheck guarded Undo" : "Undo"}</Button>}
        </div>
      </li>)}
    </ol>
    {cursor !== null && items.length < 200 && <Button type="button" className="mt-3" size="sm" variant="outline" disabled={busy || !online}
      onClick={() => { void load(cursor); }}>Load older changes</Button>}
    {items.length >= 200 && <p className="mt-2 text-xs">This session shows up to 200 entries. Refresh to return to the newest page. Older server evidence has not been deleted.</p>}
  </section>;
}
