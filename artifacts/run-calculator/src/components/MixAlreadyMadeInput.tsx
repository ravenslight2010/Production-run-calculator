import { useState, useEffect, useRef } from "react";
import type { Mix } from "@workspace/mixes";
import { toast } from "@/hooks/use-toast";

interface Props {
  mix: Mix;
  onOptimisticSave: (nextMix: Mix) => void;
  onSaveAcknowledged: (optimisticMix: Mix, saved: Mix[]) => void;
  saveMixes: (mixes: Mix[]) => Promise<Mix[]>;
}

/**
 * Inline "Already made (lbs)" + optional "Made today (lbs)" fields for the
 * Mixes plan card. "Already made" is the carry-in (pre-made from prior run);
 * "Made today" is the actual production for the current make-day (Feature B2).
 *
 * When "Made today" is entered and > fresh needed, the overproduction is
 * deducted from inventory and the excess is auto-carried as "Already made"
 * for the next run. If left blank, fresh-needed = total needed.
 */
export function MixAlreadyMadeInput({
  mix,
  onOptimisticSave,
  onSaveAcknowledged,
  saveMixes,
}: Props) {
  const [alreadyVal, setAlreadyVal] = useState(mix.amountAlreadyMade);
  const [actualVal, setActualVal] = useState(mix.amountActualMade ?? 0);
  const alreadyFailedRef = useRef<number | null>(null);
  const actualFailedRef = useRef<number | null>(null);

  useEffect(() => {
    setAlreadyVal(mix.amountAlreadyMade);
  }, [mix.amountAlreadyMade]);

  useEffect(() => {
    setActualVal(mix.amountActualMade ?? 0);
  }, [mix.amountActualMade]);

  async function saveField(field: "already" | "actual", value: number) {
    const nextMix = {
      ...mix,
      ...(field === "already" ? { amountAlreadyMade: value } : { amountActualMade: value }),
    };
    onOptimisticSave(nextMix);
    try {
      const saved = await saveMixes([nextMix]);
      onSaveAcknowledged(nextMix, saved);
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't save mix amount",
        description: "Please check your connection and try again.",
      });
    }
  }

  return (
    <div className="space-y-1 mb-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-emerald-400/70 whitespace-nowrap">Already made:</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={alreadyVal}
          onChange={(e) => setAlreadyVal(Math.max(0, Number(e.target.value) || 0))}
          onBlur={async () => {
            const isRetry = alreadyFailedRef.current === alreadyVal;
            if (alreadyVal === mix.amountAlreadyMade && !isRetry) return;
            alreadyFailedRef.current = null;
            await saveField("already", alreadyVal);
          }}
          className="w-20 rounded border border-emerald-700/50 bg-emerald-950/60 px-1.5 py-0.5 text-xs text-emerald-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <span className="text-emerald-400/70">lbs</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-emerald-400/70 whitespace-nowrap">Made today:</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={actualVal || ""}
          placeholder="plan"
          onChange={(e) => setActualVal(Math.max(0, Number(e.target.value) || 0))}
          onBlur={async () => {
            const isRetry = actualFailedRef.current === actualVal;
            if (actualVal === (mix.amountActualMade ?? 0) && !isRetry) return;
            actualFailedRef.current = null;
            await saveField("actual", actualVal);
            // Note: saveField saves amountAlreadyMade; this saves amountActualMade via the spread
          }}
          className="w-20 rounded border border-amber-700/50 bg-amber-950/60 px-1.5 py-0.5 text-xs text-amber-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <span className="text-emerald-400/70">lbs</span>
        {actualVal > 0 && (
          <span className="text-[10px] text-amber-400/80">optional — leave blank to use plan</span>
        )}
      </div>
    </div>
  );
}
