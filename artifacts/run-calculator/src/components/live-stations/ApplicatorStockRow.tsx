import { useEffect, useState } from "react";
import { fmtNum } from "../../utils";

export function ApplicatorStockRow(props: {
  label: string;
  stockLbs: number;
  capacityLbs: number;
  disabled?: boolean;
  disabledReason?: string;
  testId: string;
  onSave: (stockLbs: number) => void;
}) {
  const { label, stockLbs, capacityLbs, disabled, disabledReason, testId, onSave } = props;
  const [draft, setDraft] = useState(String(stockLbs));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(String(stockLbs));
  }, [dirty, stockLbs]);

  const save = (value = Number(draft)) => {
    if (!Number.isFinite(value) || value < 0 || value > capacityLbs) {
      setDraft(String(stockLbs));
      setDirty(false);
      return;
    }
    onSave(value);
    setDraft(String(value));
    setDirty(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <div className="min-w-32">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">Capacity {fmtNum(capacityLbs, 1)} lb</div>
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`${testId}-input`}>{label} pounds on hand</label>
        <input
          id={`${testId}-input`}
          data-testid={testId}
          aria-label={`${label} pounds on hand`}
          type="number"
          min={0}
          max={capacityLbs}
          step="0.01"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          className="h-9 w-28 rounded-md border border-input bg-background px-2 text-right font-mono text-sm tabular-nums"
        />
        <span className="text-xs text-muted-foreground">lb</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => save(capacityLbs)}
          className="h-9 rounded-md border border-input px-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Fill to cap
        </button>
        <button
          type="button"
          disabled={disabled || !dirty}
          onClick={() => save()}
          className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
        {disabledReason && (
          <span role="status" className="basis-full text-right text-xs text-amber-700 dark:text-amber-400">
            {disabledReason}
          </span>
        )}
      </div>
    </div>
  );
}
