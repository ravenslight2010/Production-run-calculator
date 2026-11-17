import { useEffect, useRef, useState } from "react";
import {
  readRetainedHistoryForComparison, type RetainedRecordEvidence,
} from "../sharedRecordMigration";
import { fetchRetainedHistoryComparison, type HistoryComparisonOutcome } from "../retainedHistoryComparison";

const messages: Record<HistoryComparisonOutcome, string> = {
  identical: "These run details match shared history.",
  different: "The saved and shared run details differ. Nothing was changed.",
  unmatched: "No complete shared-history match was found for this saved item.",
  ambiguous: "More than one possible match was found. Review it before taking action.",
  unavailable: "Shared history could not be compared safely. Reconnect or sign in again, then retry.",
};

export function RetainedHistoryComparison({
  identity, manager, item,
}: { identity: string; manager: boolean; item: RetainedRecordEvidence }) {
  const selection = readRetainedHistoryForComparison(identity, manager, item);
  const version = selection?.version;
  const owner = `${identity}:${manager}:${item.key}:${item.recordIndex}`;
  const active = useRef({ owner, version });
  active.current = { owner, version };
  const request = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{
    owner: string; version: string | undefined; outcome: HistoryComparisonOutcome | "loading";
  } | null>(null);
  useEffect(() => () => {
    const previous = request.current;
    request.current = null;
    previous?.abort();
  }, [owner, version]);
  if (!manager || !item.canRemove) return null;
  const currentResult = result?.owner === owner && result.version === version ? result : null;
  return <div className="mt-2">
    <button type="button" className="underline" disabled={!selection || currentResult?.outcome === "loading"} onClick={() => {
      if (!selection || request.current && !request.current.signal.aborted) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const stillCurrent = () => request.current === controller && active.current.owner === owner &&
        active.current.version === version &&
        readRetainedHistoryForComparison(identity, manager, item)?.version === version;
      setResult({ owner, version, outcome: "loading" });
      const timer = window.setTimeout(() => controller.abort(), 30_000);
      void fetchRetainedHistoryComparison(selection.record, controller.signal, stillCurrent).then((outcome) => {
        if (stillCurrent()) setResult({ owner, version, outcome });
      }).finally(() => {
        window.clearTimeout(timer);
        if (request.current === controller) request.current = null;
      });
    }}>Compare with shared history</button>
    <p className="text-muted-foreground">Read-only comparison of run details. It does not confirm ownership, upload this copy, or change any records.</p>
    {!selection && <p role="status">This saved item cannot be safely compared in its current format.</p>}
    {currentResult && <p role="status" aria-live="polite">
      {currentResult.outcome === "loading" ? "Checking shared history…" : messages[currentResult.outcome]}
    </p>}
  </div>;
}
