// @vitest-environment-jsdom note: this component is DOM-only; its tests include
// "// @vitest-environment jsdom" at the top of the test file.

import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { fmtNum } from "../utils";
import {
  replaceMixSurplusAllocations,
  voidMixSurplusLot,
  type MixSurplusLedger,
} from "../mixSurplusClient";

interface Props {
  /** The mix whose freezer stock this strip renders. */
  mixId: string;
  /** Latest Mixes-tab ledger (null while first fetch is in flight). */
  ledger: MixSurplusLedger | null;
  /** Selected make-day — the allocation target for "Use on next run". */
  makeDay: string;
  /** Manager-gated actions. Show-only when false. */
  canManage: boolean;
  /** Called with the fresh ledger after a successful use/release. */
  onLedgerChanged: (next: MixSurplusLedger) => void;
}

/**
 * "X lbs of {mix} in the freezer" strip for the Mixes plan card. Surplus is
 * freezer stock: ingredients were already deducted when the mix was made, so
 * "Use on next run" only records the make-day allocation and "Release" voids
 * the lot (server decrements the mix's amountAlreadyMade). Never re-deducts.
 */
export function MixSurplusStrip({ mixId, ledger, makeDay, canManage, onLedgerChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!ledger) return null;
  const balance = ledger.balances.find((b) => b.mixId === mixId);
  const lots = ledger.lots.filter((l) => l.mixId === mixId && l.amountRemaining > 0);
  if (!balance || balance.lbs <= 0 || lots.length === 0) return null;

  async function runAction(key: string, action: () => Promise<MixSurplusLedger>) {
    if (busy) return;
    setBusy(key);
    try {
      onLedgerChanged(await action());
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't update mix surplus",
        description: "Please check your connection and try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded border border-sky-700/40 bg-sky-950/30 px-2.5 py-2 space-y-1.5"
      data-testid={`mix-surplus-${mixId}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-sky-300/90">
          {fmtNum(balance.lbs, 2)} <span className="text-sky-400/70">lbs of</span> {balance.name}{" "}
          <span className="text-sky-400/70">in the freezer</span>
        </span>
        <span className="text-[10px] text-sky-400/70 whitespace-nowrap">
          made {balance.productionDates.join(", ")}
        </span>
      </div>
      {lots.map((lot) => (
        <div key={lot.id} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-sky-300/80 truncate">
            {lot.productionDate} · {fmtNum(lot.amountRemaining, 2)} lbs
          </span>
          {canManage && (
            <span className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => runAction(`use:${lot.id}`, () =>
                  replaceMixSurplusAllocations(makeDay, [{ lotId: lot.id, amount: lot.amountRemaining }]))}
                className="rounded border border-sky-600/50 bg-sky-900/50 px-1.5 py-0.5 text-[10px] text-sky-100 hover:bg-sky-800/50 disabled:opacity-50 transition-colors"
              >
                {busy === `use:${lot.id}` ? "Applying…" : "Use on next run"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => runAction(`release:${lot.id}`, () => voidMixSurplusLot(lot.id))}
                className="rounded border border-rose-700/50 bg-rose-950/40 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-900/40 disabled:opacity-50 transition-colors"
              >
                {busy === `release:${lot.id}` ? "Releasing…" : "Release"}
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
