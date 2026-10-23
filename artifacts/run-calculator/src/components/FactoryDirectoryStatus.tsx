import { useState, useSyncExternalStore } from "react";
import { factoryDirectoryState, factoryDirectoryVersion, subscribeFactoryDirectory } from "../factoryDirectory";
import { fetchFactoryData, hydrateFromServer, flushFactoryQueue, legacyDirectoryReviews, resolveLegacyDirectoryReview } from "../factoryDataSync";

export function FactoryDirectoryStatus() {
  useSyncExternalStore(subscribeFactoryDirectory, factoryDirectoryVersion, factoryDirectoryVersion);
  const [reviewError, setReviewError] = useState("");
  const state = factoryDirectoryState();
  const reviews = legacyDirectoryReviews();
  if (state.status === "ready") return reviews.length ? <aside className="mb-3 rounded-md border border-amber-500 p-3 text-sm">
    <details><summary>{reviews.length} legacy browser edits need manager review</summary>
      <p>These saved edits have not been used as live settings or lists. Their account or ordering could not be confirmed. Applying one replaces that setting or list using your current manager session.</p>
      {reviews.map((review) => <div className="my-2 flex flex-wrap gap-3" key={`${review.source}:${review.key}`}>
        <span>{review.key.replace("run-calc-", "")}</span>
        {review.problem && <p role="alert">{review.problem}</p>}
        <pre className="w-full max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(review.value, null, 2)}</pre>
        <button type="button" disabled={!!review.problem} className="underline" onClick={() => {
          if (!window.confirm("Use this device's saved edit in the current facility? This replaces the current server setting or list.")) return;
          void resolveLegacyDirectoryReview(review, true).then((ok) => setReviewError(ok ? "" : "Edit remains saved. Connect online and retry."));
        }}>Apply saved edit</button>
        <button type="button" className="underline" onClick={() => {
          if (!window.confirm("Discard this legacy edit and keep the current server value?")) return;
          void resolveLegacyDirectoryReview(review, false).then((ok) => setReviewError(ok ? "" : "Review remains saved. Reconnect and let any pending edit finish, then retry."));
        }}>Keep server value</button>
      </div>)}
      {reviewError && <p role="alert">{reviewError}</p>}
    </details>
  </aside> : null;
  return <aside role="status" className="mb-3 rounded-md border border-amber-500 p-3 text-sm">
    <p>{state.status === "loading" ? "Loading operational lists from the server…" : "Operational lists unavailable. Connect online to load lists or edit recipes. Saved run recovery remains available."}</p>
    {state.error && <p>{state.error}</p>}
    <button type="button" className="mt-2 underline" onClick={() => {
      void fetchFactoryData().then((data) => { hydrateFromServer(data); return flushFactoryQueue(); }).catch(() => {});
    }}>Retry loading lists</button>
  </aside>;
}
