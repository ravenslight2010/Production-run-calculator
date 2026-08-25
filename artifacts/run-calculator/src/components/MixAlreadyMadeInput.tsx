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
 * Inline "Already made (lbs)" field for the Mixes plan card.
 * Controlled with local state so it stays consistent during and after saves.
 * Syncs from the server mix record whenever it changes externally.
 */
export function MixAlreadyMadeInput({
  mix,
  onOptimisticSave,
  onSaveAcknowledged,
  saveMixes,
}: Props) {
  const [val, setVal] = useState(mix.amountAlreadyMade);
  const failedValueRef = useRef<number | null>(null);

  // Sync if the mix record is updated externally (e.g. another save path)
  useEffect(() => {
    setVal(mix.amountAlreadyMade);
  }, [mix.amountAlreadyMade]);

  return (
    <div className="flex items-center gap-2 text-xs mb-1.5">
      <span className="text-emerald-400/70 whitespace-nowrap">Already made:</span>
      <input
        type="number"
        min={0}
        step={0.1}
        value={val}
        onChange={(e) => setVal(Math.max(0, Number(e.target.value) || 0))}
        onBlur={async () => {
          const isRetry = failedValueRef.current === val;
          if (val === mix.amountAlreadyMade && !isRetry) return;
          try {
            const nextMix = { ...mix, amountAlreadyMade: val };
            // Update the mounted plan immediately; the network round-trip
            // should not make the warehouse badge lag behind the input.
            onOptimisticSave(nextMix);
            const saved = await saveMixes([nextMix]);
            onSaveAcknowledged(nextMix, saved);
            failedValueRef.current = null;
          } catch {
            // Keep the local value so the manager can retry without retyping.
            failedValueRef.current = val;
            toast({
              variant: "destructive",
              title: "Couldn't save already made amount",
              description: "Please check your connection and try again.",
            });
          }
        }}
        className="w-20 rounded border border-emerald-700/50 bg-emerald-950/60 px-1.5 py-0.5 text-xs text-emerald-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <span className="text-emerald-400/70">lbs</span>
    </div>
  );
}
