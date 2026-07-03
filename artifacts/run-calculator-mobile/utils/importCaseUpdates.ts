import { showConfirm } from "@/utils/notify";

// A skipped re-import file row can still carry news: the office may have
// re-issued today's schedule with a DIFFERENT case count for a run that's
// already going. These helpers turn the skipAlreadyRanRuns matches into
// update offers and present them (never auto-applied). Finished runs are
// never modified. Mirrors web commitMultiDayImport's caseUpdateOffers flow.

export type RanRunInfo = {
  brand: string;
  flavor: string;
  id: string;
  startedAt?: number;
  endedAt?: number;
  casesNeeded: number;
};

export type CaseUpdateOffer = {
  runId: string;
  brand: string;
  flavor: string;
  from: number;
  to: number;
};

export function buildCaseUpdateOffers(
  matches: { row: { brand: string; flavor: string; casesNeeded: number }; run: RanRunInfo }[],
): CaseUpdateOffer[] {
  const offers: CaseUpdateOffer[] = [];
  for (const m of matches) {
    // In-progress only — finished runs are never modified.
    if (!m.run.startedAt || m.run.endedAt) continue;
    const planned = Math.round(m.row.casesNeeded ?? NaN);
    if (!Number.isFinite(planned) || planned <= 0) continue;
    const current = m.run.casesNeeded || 0;
    if (planned !== current) {
      offers.push({ runId: m.run.id, brand: m.row.brand, flavor: m.row.flavor, from: current, to: planned });
    }
  }
  return offers;
}

/**
 * Offer (never auto-apply) the collected case-count updates. `prefix` lets the
 * caller fold its usual import-summary note into the same alert (RN can't
 * reliably stack two alerts back-to-back on Android).
 */
export function promptCaseUpdates(
  offers: CaseUpdateOffer[],
  prefix: string,
  apply: (offer: CaseUpdateOffer) => void,
): void {
  if (offers.length === 0) return;
  const many = offers.length > 1;
  const lines = offers
    .map((o) => `• ${`${o.brand} ${o.flavor}`.trim() || "run"}: ${o.from} → ${o.to} cases`)
    .join("\n");
  const message = `${prefix}The re-imported schedule lists ${many ? "different case counts" : "a different case count"} for ${many ? `${offers.length} runs that are` : "a run that's"} already going:\n\n${lines}\n\nUpdate the run target${many ? "s" : ""} to the new count${many ? "s" : ""}? Progress is kept.`;
  // showConfirm renders the styled in-app dialog on web (RN Alert is a silent
  // no-op there) and the exact two-button Alert.alert on native.
  showConfirm({
    title: "Case counts changed",
    message,
    confirmText: many ? "Update Targets" : "Update Target",
    cancelText: "Keep Current",
    onConfirm: () => offers.forEach(apply),
  });
}
