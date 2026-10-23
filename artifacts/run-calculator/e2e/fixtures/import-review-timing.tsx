// Isolated, synthetic review-only fixture. No imports are parsed or applied.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import SpecImportDialog from "../../src/components/SpecImportDialog";
import PremixImportDialog from "../../src/components/PremixImportDialog";
import CheeseImportDialog from "../../src/components/CheeseImportDialog";
import { startImportReviewTiming } from "../../src/importReviewTiming";
import type { SpecImportPrepared } from "../../src/specImport";
import type { PremixImportPrepared } from "../../src/premixImport";
import type { CheeseImportPrepared } from "../../src/cheeseImport";
import "../../src/index.css";

const spec: SpecImportPrepared = {
  parsed: { profiles: [], recipes: [] },
  summary: { profilesNew: 0, profilesUpdated: 0, recipesNew: 0, recipesUpdated: 0, totalProfiles: 0, totalRecipes: 0 },
  newAliases: [], flagged: [], discrepancies: [],
  skipped: { profiles: [], recipes: [] }, brands: [], flavorsByBrand: {},
};
const premix: PremixImportPrepared = {
  mixes: [], candidates: [], summary: { total: 0, created: 0, updated: 0 },
  newAliases: [], brands: [], flavorsByBrand: {}, existingIds: [], existingMixes: [],
  redirectSuggestions: {}, freezerPulls: {}, prepItems: [],
};
const cheese: CheeseImportPrepared = {
  recipes: [], candidates: [], summary: { total: 0, added: 0, updated: 0 },
  existingIds: [], prepItems: [], existingPool: [],
};

function Fixture() {
  const [review, setReview] = useState<"spec" | "premix" | "cheese" | null>(null);
  const [waiting, setWaiting] = useState(false);
  const onClose = () => setReview(null);
  const common = { open: true, onClose, loading: false, error: null, applying: false, onConfirm: () => {} };
  function open(kind: "spec" | "premix" | "cheese", delay: number) {
    setWaiting(true);
    startImportReviewTiming({ spec, premix, cheese }[kind], kind);
    setTimeout(() => { setWaiting(false); setReview(kind); }, delay);
  }
  return <>
    <h1>Import review timing fixture</h1>
    {(["spec", "premix", "cheese"] as const).map((kind) =>
      <div key={kind}>
        <button disabled={waiting} onClick={() => open(kind, 0)}>Open {kind}</button>
        <button disabled={waiting} onClick={() => open(kind, 2_100)}>Delay {kind}</button>
      </div>,
    )}
    {review === "spec" && <SpecImportDialog {...common} prepared={spec} />}
    {review === "premix" && <PremixImportDialog {...common} prepared={premix} />}
    {review === "cheese" && <CheeseImportDialog {...common} prepared={cheese} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
