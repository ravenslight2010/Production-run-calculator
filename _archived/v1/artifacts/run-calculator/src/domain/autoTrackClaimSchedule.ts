type StockAnchorMutation = {
  field: string;
  to: number;
};

type StockClaimScheduleInput = {
  channel: string;
  dueAt: number;
  nextDueAt: number;
  mutations: readonly StockAnchorMutation[];
};

/**
 * Keep a rebased stock claim's scheduled window aligned with its canonical
 * anchor mutation. The server validates that a stock claim's anchor target is
 * exactly its due time.
 */
export function getStockClaimScheduleAfterRebase({
  channel,
  dueAt,
  nextDueAt,
  mutations,
}: StockClaimScheduleInput): { dueAt: number; nextDueAt: number } {
  const appStockMatch = /^app([1-4])-stock$/.exec(channel);
  const anchorField = channel === "sauce-stock"
    ? "sauceStockAnchorNetSec"
    : appStockMatch
      ? `app${appStockMatch[1]}StockAnchorNetSec`
      : null;
  if (!anchorField) return { dueAt, nextDueAt };

  const anchor = mutations.find((mutation) => mutation.field === anchorField);
  if (!anchor) {
    throw new Error(`Missing ${anchorField} in ${channel} automatic claim`);
  }
  const cadence = nextDueAt - dueAt;
  if (
    !Number.isFinite(dueAt)
    || !Number.isFinite(nextDueAt)
    || !Number.isFinite(anchor.to)
    || !Number.isFinite(cadence)
    || cadence <= 0
  ) {
    throw new Error(`Invalid scheduled window in ${channel} automatic claim`);
  }
  return {
    dueAt: anchor.to,
    nextDueAt: anchor.to + cadence,
  };
}
