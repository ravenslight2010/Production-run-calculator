const PIN_KEY = "run-calc-supervisor-pin";
const HISTORY_KEY = "run-calc-change-history";
/** Remove just PIN fields, including historical nested undo snapshots. */
export function purgeLegacyPinCopies(): void {
  try {
    localStorage.removeItem(PIN_KEY);
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const clean = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(clean);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).filter(([key]) => key !== PIN_KEY).map(([key, nested]) => {
        if (typeof nested === "string" && (nested.startsWith("{") || nested.startsWith("["))) {
          try { return [key, JSON.stringify(clean(JSON.parse(nested)))]; } catch {}
        }
        return [key, clean(nested)];
      }));
    };
    localStorage.setItem(HISTORY_KEY, JSON.stringify(clean(JSON.parse(raw))));
  } catch { /* No broad storage clearing, even if historical data is corrupt. */ }
}
