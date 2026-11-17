// A skipped re-import file row can still carry news: the office may have
// re-issued today's schedule with a DIFFERENT case count for a run that's
// already going. This pure helper turns the skipAlreadyRanRuns matches into
// update offers (never auto-applied by callers). Finished runs are never
// modified. Mirrors artifacts/run-calculator-mobile/utils/importCaseUpdates.ts
// (buildCaseUpdateOffers) — keep the flag semantics identical.

export type CaseUpdateOffer = {
  runId: string;
  brand: string;
  flavor: string;
  from: number;
  to: number;
  /** Set when the offered target is BELOW what the floor already made. */
  madeAlready?: number;
};

/** The per-run form fields the offer builder needs (web stores cases-made
 *  progress as skid counters, unlike mobile's precomputed casesMade). */
export type RunCaseFields = {
  casesNeeded?: unknown;
  skidsCompleted?: unknown;
  casesPerSkid?: unknown;
  casesOnCurrentSkid?: unknown;
};

export type SkippedRowMatch = {
  row: { brand: string; flavor: string; casesPlanned?: number | null };
  run: { id: string; inProgress: boolean };
};

/** Cases already produced: skidsCompleted*casesPerSkid + casesOnCurrentSkid,
 *  rounded and clamped to >= 0 (mirrors mobile's `made` computation, which
 *  receives the same product precomputed as casesMade). */
export function casesMadeFromValues(vals: RunCaseFields): number {
  return Math.max(
    0,
    Math.round(
      (Number(vals.skidsCompleted) || 0) * (Number(vals.casesPerSkid) || 0) +
        (Number(vals.casesOnCurrentSkid) || 0),
    ),
  );
}

export function buildCaseUpdateOffers(
  matches: SkippedRowMatch[],
  getRunValues: (runId: string) => RunCaseFields,
): CaseUpdateOffer[] {
  const offers: CaseUpdateOffer[] = [];
  for (const m of matches) {
    // In-progress only — finished runs are never modified.
    if (!m.run.inProgress) continue;
    const planned = Math.round(m.row.casesPlanned ?? NaN);
    if (!Number.isFinite(planned) || planned <= 0) continue;
    const vals = getRunValues(m.run.id);
    const current = Number(vals.casesNeeded) || 0;
    if (planned !== current) {
      // Flag (but still allow — the office may genuinely cut the run short)
      // offers whose new target is below what the floor already produced:
      // accepting makes the run instantly "over target".
      const made = casesMadeFromValues(vals);
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

/** Default Accept/Keep choices for the offer dialog: runs whose new target is
 *  BELOW what's already made default to Keep (accepting would instantly show
 *  the run as over target); all others default to Accept. */
export function defaultCaseUpdateAccepted(
  offers: CaseUpdateOffer[],
): Record<string, boolean> {
  return Object.fromEntries(offers.map((o) => [o.runId, o.madeAlready == null]));
}

/** The lowered-target warning line shown under a flagged offer, or null when
 *  the offer isn't flagged. Same meaning as the mobile prompt's "⚠ Already
 *  made N — the new target of X is BELOW that" line. */
export function caseUpdateWarningLine(o: CaseUpdateOffer): string | null {
  if (o.madeAlready == null) return null;
  return `⚠ Already made ${o.madeAlready} — the new target of ${o.to} is below that, so this run would show as over target.`;
}
