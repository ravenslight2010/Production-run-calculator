import { useRef, useState, useSyncExternalStore } from "react";
import { factoryDirectoryState, factoryDirectoryVersion, subscribeFactoryDirectory, directoryRaw } from "../factoryDirectory";
import {
  fetchFactoryData, hydrateFromServer, flushFactoryQueue, legacyDirectoryReviews,
  resolveLegacyDirectoryReview, getStopReasons, getPackagingSettings, getShiftStartTime,
  getProductionStartTime,
} from "../factoryDataSync";
import {
  CIRCLES_KEY, GRIP_SHEETS_KEY, PRODUCTION_START_TIME_KEY, SHIPPER_KEY,
  SHIFT_START_TIME_KEY, SKID_STACKING_KEY, STOP_REASONS_KEY,
} from "../types";

const DIRECTORY_LABELS: Record<string, string> = {
  "run-calc-brands": "Brands",
  "run-calc-brand-flavors": "Brand and flavor choices",
  "run-calc-ingredient-types": "Ingredient types",
  "run-calc-pep-types": "Pepperoni types",
  "run-calc-die-types": "Crust and die types",
  "run-calc-cheese-ingredients": "Cheese ingredients",
  "run-calc-dough-ingredients": "Dough ingredients",
  "run-calc-frontline-ingredients": "Sauce ingredients",
  "run-calc-mix-ingredients": "Mix ingredients",
  "run-calc-dough-recipe-names": "Dough recipe names",
  "run-calc-dough-recipe-presets": "Dough recipes",
  "run-calc-frontline-recipe-names": "Sauce recipe names",
  "run-calc-frontline-recipe-presets": "Sauce recipes",
  "run-calc-cheese-recipe-names": "Cheese recipe names",
  "run-calc-cheese-recipe-presets": "Cheese recipes",
  "run-calc-mix-recipe-names": "Mix recipe names",
  "run-calc-stop-reasons": "Stop reasons",
  "run-calc-circles": "Packaging circles",
  "run-calc-shippers": "Shippers",
  "run-calc-skid-stacking": "Skid stacking choices",
  "run-calc-grip-sheets": "Grip-sheet choices",
  "run-calc-shift-start-time": "Shift start time",
  "run-calc-production-start-time": "Production start time",
};

function describeItem(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item, index) => `${index + 1}) ${describeItem(item)}`).join("; ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([name, field]) => `${name.replaceAll(/([A-Z])/g, " $1").replaceAll(/[-_]/g, " ").toLowerCase()}: ${describeItem(field)}`)
      .join(" · ");
  }
  return value === null ? "No value" : "Saved value";
}

function readableLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (!value.length) return ["No entries"];
    return value.map((item, index) => `${index + 1}. ${describeItem(item)}`);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return ["No entries"];
    return entries.map(([name, item]) => {
      const label = name.replaceAll(/([A-Z])/g, " $1").replaceAll(/[-_]/g, " ").trim();
      if (Array.isArray(item)) {
        return `${label}: ${item.length} ${item.length === 1 ? "item" : "items"}${item.length ? ` — ${item.map(describeItem).join("; ")}` : ""}`;
      }
      return `${label}: ${describeItem(item)}`;
    });
  }
  return [describeItem(value)];
}

function currentFacilityValue(key: string): unknown {
  const packaging = getPackagingSettings();
  const settings: Record<string, unknown> = {
    [STOP_REASONS_KEY]: getStopReasons(),
    [CIRCLES_KEY]: packaging.circles,
    [SHIPPER_KEY]: packaging.shipper,
    [SKID_STACKING_KEY]: packaging.skidStacking,
    [GRIP_SHEETS_KEY]: packaging.gripSheets,
    [SHIFT_START_TIME_KEY]: getShiftStartTime(),
    [PRODUCTION_START_TIME_KEY]: getProductionStartTime(),
  };
  if (Object.hasOwn(settings, key)) return settings[key];
  const raw = directoryRaw(key);
  if (raw === null) return key.includes("presets") ? {} : [];
  try { return JSON.parse(raw); } catch { return "The current value is unavailable for preview."; }
}

export function FactoryDirectoryStatus() {
  useSyncExternalStore(subscribeFactoryDirectory, factoryDirectoryVersion, factoryDirectoryVersion);
  const [reviewError, setReviewError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);
  const resolvingReviewId = useRef<string | null>(null);
  const state = factoryDirectoryState();
  const reviews = legacyDirectoryReviews();
  if (state.status === "ready") {
    if (!reviews.length && !reviewError && !reviewNotice) return null;
    return <aside data-testid="factory-directory-review" className="mb-3 rounded-md border border-amber-500 p-3 text-sm">
      {reviews.length > 0 && <details><summary>{reviews.length} saved facility-list edits need review</summary>
        <p className="mt-2">These copies are saved on this device, not currently in use as shared facility lists. Their owner or order could not be confirmed, so they were not applied automatically. Compare both versions before choosing.</p>
        {reviews.map((review) => <div className="my-3 rounded border border-border p-3" key={review.id}>
          <h3 className="font-medium">{DIRECTORY_LABELS[review.key] ?? "Saved facility list"}</h3>
          {review.problem && <p role="alert" className="mt-1">{review.problem}</p>}
          <p className="mt-2 font-semibold">Currently in use</p>
          <ul className="max-h-60 overflow-auto list-disc pl-5" tabIndex={0} aria-label="Current facility value, complete list">
            {readableLines(currentFacilityValue(review.key)).map((line, index) => <li key={`current-${index}`}>{line}</li>)}
          </ul>
          <p className="mt-2 font-semibold">{review.source === "run-calc-fkv-queue-v1" ? "Saved change awaiting review" : "Saved copy on this device"}</p>
          <ul className="max-h-60 overflow-auto list-disc pl-5" tabIndex={0} aria-label="Saved device copy, complete list">
            {readableLines(review.value).map((line, index) => <li key={`saved-${index}`}>{line}</li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={!!busyReviewId || !!review.problem || !review.canApply} className="underline" onClick={() => {
              if (!window.confirm(`Replace the facility’s current ${DIRECTORY_LABELS[review.key] ?? "list"} with this device’s saved copy?`)) return;
              setReviewError("");
              setReviewNotice("");
              void resolveLegacyDirectoryReview(review, true).then((ok) => setReviewError(ok ? "" : "The saved edit could not be safely applied. It remains available for review."));
            }}>Apply saved copy</button>
            <button type="button" disabled={!review.canRemove || !!busyReviewId} className="underline" onClick={() => {
              if (resolvingReviewId.current || !review.canRemove) return;
              if (!window.confirm("Permanently remove this saved copy from this device? This will not change the facility’s shared value.")) return;
              resolvingReviewId.current = review.id;
              setBusyReviewId(review.id);
              setReviewError("");
              setReviewNotice("");
              void resolveLegacyDirectoryReview(review, false)
                .then((ok) => {
                  setReviewError(ok ? "" : "The copy changed or could not be removed. Nothing else was removed; refresh this review and try again.");
                  setReviewNotice(ok ? "Saved copy removed from this device." : "");
                })
                .catch(() => {
                  setReviewError("The copy could not be removed. Nothing else was removed; refresh this review and try again.");
                })
                .finally(() => {
                  resolvingReviewId.current = null;
                  setBusyReviewId(null);
                });
            }}>{busyReviewId === review.id ? "Removing saved copy…" : review.canRemove ? "Remove saved copy from this device" : "Removal unavailable"}</button>
          </div>
          {!review.canRemove && review.removeBlockedReason && <p className="mt-2 text-muted-foreground">{review.removeBlockedReason}</p>}
        </div>)}
      </details>}
      {reviewError && <p role="alert" className="mt-2">{reviewError}</p>}
      {reviewNotice && <p role="status" aria-live="polite" className="mt-2">{reviewNotice}</p>}
    </aside>;
  }
  return <aside role="status" className="mb-3 rounded-md border border-amber-500 p-3 text-sm">
    <p>{state.status === "loading" ? "Loading operational lists from the server…" : "Operational lists unavailable. Connect online to load lists or edit recipes. Saved run recovery remains available."}</p>
    {state.error && <p>{state.error}</p>}
    <button type="button" className="mt-2 underline" onClick={() => {
      void fetchFactoryData().then((data) => { hydrateFromServer(data); return flushFactoryQueue(); }).catch(() => {});
    }}>Retry loading lists</button>
  </aside>;
}
