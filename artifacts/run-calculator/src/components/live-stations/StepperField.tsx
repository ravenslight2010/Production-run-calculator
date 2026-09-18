import { useCallback, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { createFrameRepeater } from "../../frameRepeater";
import type { FormValues } from "../../types";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";

export function StepperField({
  control, name, label, min = 0, max, step = 1, disabled, suggestion, onSuggest, onManualChange,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  suggestion?: number | null;
  onSuggest?: () => void;
  onManualChange?: (nextValue: number, previousValue: number) => void;
}) {
  const repeatRef = useRef<ReturnType<typeof createFrameRepeater> | null>(null);
  const disabledRef = useRef(!!disabled);
  disabledRef.current = !!disabled;
  const fieldRef = useRef<any>(null);
  if (!repeatRef.current) repeatRef.current = createFrameRepeater();
  const stopRepeat = useCallback(() => repeatRef.current?.stop(), []);
  useEffect(() => { if (disabled) stopRepeat(); }, [disabled, stopRepeat]);
  useEffect(() => {
    const stopWhenHidden = () => { if (document.hidden) stopRepeat(); };
    window.addEventListener("blur", stopRepeat);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => { stopRepeat(); window.removeEventListener("blur", stopRepeat); document.removeEventListener("visibilitychange", stopWhenHidden); };
  }, [stopRepeat]);
  const startRepeat = (fn: () => void) => { repeatRef.current?.start(fn); };
  return (
    <FormField control={control} name={name} render={({ field }) => {
      fieldRef.current = field;
      const current = Number(field.value) || 0;
      const atMax = max !== undefined && current >= max;
      const decrement = () => {
        if (disabledRef.current) return;
        const cur = Number(fieldRef.current?.value) || 0;
        navigator.vibrate?.(8);
        const next = Math.max(min, cur - step);
        fieldRef.current?.onChange(next);
        onManualChange?.(next, cur);
      };
      const increment = () => {
        if (disabledRef.current) return;
        const cur = Number(fieldRef.current?.value) || 0;
        if (max !== undefined && cur >= max) return;
        navigator.vibrate?.(8);
        const next = max !== undefined ? Math.min(max, cur + step) : cur + step;
        fieldRef.current?.onChange(next);
        onManualChange?.(next, cur);
      };
      return (
        <FormItem>
          <div className="flex items-center justify-between gap-2">
            <FormLabel className="text-xs text-muted-foreground">{label}</FormLabel>
            {suggestion !== null && suggestion !== undefined && suggestion !== current && onSuggest && (
              <button type="button" onClick={() => { if (!disabledRef.current) { navigator.vibrate?.(8); onSuggest(); } }} disabled={disabled} aria-disabled={disabled} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors shrink-0" title={`Set to expected value: ${suggestion}`}>
                <Sparkles className="w-2.5 h-2.5" /> Expected: {suggestion}
              </button>
            )}
          </div>
          <FormControl>
            <div className={`flex items-stretch${disabled ? " opacity-50 pointer-events-none" : ""}`}>
              <button type="button" onPointerDown={() => startRepeat(decrement)} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat} onLostPointerCapture={stopRepeat} onBlur={stopRepeat} className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none" data-testid={`btn-dec-${name}`} disabled={disabled}>−</button>
              <input type="number" inputMode="numeric" {...field} onChange={(e) => { if (disabledRef.current) return; const val = e.target.value === "" ? "" : Number(e.target.value); const next = max !== undefined && typeof val === "number" ? Math.min(max, val) : val; field.onChange(next); if (typeof next === "number" && Number.isFinite(next)) onManualChange?.(next, current); }} onFocus={e => e.target.select()} className={`h-12 flex-1 border border-input bg-background/50 text-center font-mono text-2xl font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0${atMax ? " text-amber-400" : ""}`} data-testid={`input-${name}`} disabled={disabled} />
              <button type="button" onPointerDown={() => startRepeat(increment)} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat} onLostPointerCapture={stopRepeat} onBlur={stopRepeat} className={`h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`} data-testid={`btn-inc-${name}`} disabled={disabled || atMax}>+</button>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      );
    }} />
  );
}