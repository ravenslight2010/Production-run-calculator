import { useState, useEffect } from "react";
import type { Mix } from "@workspace/mixes";

interface Props {
  mix: Mix;
  onSaved: (saved: Mix[]) => void;
  saveMixes: (mixes: Mix[]) => Promise<Mix[]>;
}

/**
 * Inline "Already made (lbs)" field for the Mixes plan card.
 * Controlled with local state so it stays consistent during and after saves.
 * Syncs from the server mix record whenever it changes externally.
 */
export function MixAlreadyMadeInput({ mix, onSaved, saveMixes }: Props) {
  const [val, setVal] = useState(mix.amountAlreadyMade);

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
          if (val === mix.amountAlreadyMade) return;
          const saved = await saveMixes([{ ...mix, amountAlreadyMade: val }]);
          onSaved(saved);
        }}
        className="w-20 rounded border border-emerald-700/50 bg-emerald-950/60 px-1.5 py-0.5 text-xs text-emerald-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <span className="text-emerald-400/70">lbs</span>
    </div>
  );
}
