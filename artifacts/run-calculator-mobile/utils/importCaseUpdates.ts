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
  /** Cases already produced (skidsCompleted*casesPerSkid + casesOnCurrentSkid). */
  casesMade?: number;
};

export type CaseUpdateOffer = {
  runId: string;
  brand: string;
  flavor: string;
  from: number;
  to: number;
  /** Set when the offered target is BELOW what the floor already made. */
  madeAlready?: number;
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
      // Flag (but still allow — the office may genuinely cut the run short)
      // offers whose new target is below what the floor already produced:
      // accepting makes the run instantly "over target".
      const made = Math.max(0, Math.round(m.run.casesMade ?? 0));
      offers.push({
        runId: m.run.id,
        brand: m.row.brand,
        flavor: m.row.flavor,
        from: current,
        to: planned,
        ...(made > planned ? { madeAlready: made } : {}),
      });
    }
  }
  return offers;
}

/**
 * Offer (never auto-apply) the collected case-count updates, ONE RUN AT A
 * TIME so the user can accept the office's new count for one run while
 * keeping the floor's current target on another (mirrors web's per-run
 * Accept/Keep dialog). `prefix` lets the caller fold its usual import-summary
 * note into the first prompt (RN can't reliably stack two alerts back-to-back
 * on Android); follow-up prompts are chained from button presses, which IS
 * reliable.
 */
export function promptCaseUpdates(
  offers: CaseUpdateOffer[],
  prefix: string,
  apply: (offer: CaseUpdateOffer) => void,
): void {
  if (offers.length === 0) return;
  const many = offers.length > 1;
  const intro = `${prefix}The re-imported schedule lists ${many ? "different case counts" : "a different case count"} for ${many ? `${offers.length} runs that are` : "a run that's"} already going.${many ? " Choose for each run whether to update its target or keep the current one." : ""} Progress is kept either way.`;
  const ask = (i: number) => {
    if (i < 0 || i >= offers.length) return;
    const o = offers[i];
    const name = `${o.brand} ${o.flavor}`.trim() || "run";
    const step = many ? ` (${i + 1} of ${offers.length})` : "";
    const madeWarning = o.madeAlready != null
      ? `\n\n⚠ Already made ${o.madeAlready} — the new target of ${o.to} is BELOW that, so this run would show as over target.`
      : "";
    const body = `${i === 0 ? `${intro}\n\n` : ""}${name}: ${o.from} → ${o.to} cases.${madeWarning}\n\nUpdate this run's target to ${o.to}?`;
    // Latch so a stray double-callback can't double-advance the chain or
    // re-ask a run.
    let answered = false;
    const next = (accept: boolean) => {
      if (answered) return;
      answered = true;
      if (accept) apply(o);
      ask(i + 1);
    };
    // showConfirm renders the styled in-app dialog on web (RN Alert is a
    // silent no-op there) and the exact two-button Alert.alert on native.
    showConfirm({
      title: `Case count changed${step}`,
      message: body,
      confirmText: `Update to ${o.to}`,
      cancelText: `Keep ${o.from}`,
      onConfirm: () => next(true),
      onCancel: () => next(false),
    });
  };
  ask(0);
}
