import { fmtNum } from "../../utils";

export function SauceStockControl(props: {
  barrels: number;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (barrels: number) => void;
}) {
  const value = Math.min(2, Math.max(0, Math.round(props.barrels * 10) / 10));
  const adjust = (delta: number) => props.onChange(Math.round((value + delta) * 10) / 10);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 py-2">
      <div>
        <div className="text-sm font-medium text-foreground">Sauce on-line stock</div>
        <div className="text-xs text-muted-foreground">Capacity 2.0 barrels · manual changes in 0.1 steps</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease Sauce stock by 0.1 barrel"
          data-testid="sauce-stock-decrease"
          disabled={props.disabled || value <= 0}
          onClick={() => adjust(-0.1)}
          className="h-9 w-9 rounded-md border border-input bg-muted/40 text-lg font-bold disabled:opacity-50"
        >−</button>
        <output
          aria-label="Sauce stock on hand"
          data-testid="sauce-stock-on-hand"
          className="min-w-24 text-center font-mono text-lg font-semibold tabular-nums"
        >{fmtNum(value, 1)} / 2.0 barrels</output>
        <button
          type="button"
          aria-label="Increase Sauce stock by 0.1 barrel"
          data-testid="sauce-stock-increase"
          disabled={props.disabled || value >= 2}
          onClick={() => adjust(0.1)}
          className="h-9 w-9 rounded-md border border-input bg-muted/40 text-lg font-bold disabled:opacity-50"
        >+</button>
      </div>
      {props.disabledReason && (
        <span role="status" className="basis-full text-right text-xs text-amber-700 dark:text-amber-400">
          {props.disabledReason}
        </span>
      )}
    </div>
  );
}
