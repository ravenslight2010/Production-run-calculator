import { useState } from "react";
import { btn, inputClass, validLookup } from "./shared";

export default function LookupBar({ active, busy, onApply }: { active: string | null; busy: boolean; onApply: (ref: string | null) => void }) {
  const [text, setText] = useState(active ?? "");
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const v = text.trim();
    if (!validLookup(v)) {
      setError("Enter one exact opaque record reference: letters, digits, colon, underscore or hyphen, up to 128 characters.");
      return;
    }
    setError(null);
    onApply(v);
  };
  return (
    <div className="mt-3 rounded-md border border-border p-3" data-testid="gold-approvals-lookup">
      <label htmlFor="gold-lookup" className="text-sm font-medium">Find by record reference</label>
      <p className="text-xs text-muted-foreground">Exact match, checked by the server across this scope, not only loaded rows.</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          id="gold-lookup"
          className={`${inputClass} mt-0 flex-1 basis-48`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); apply(); } }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "gold-lookup-error" : undefined}
          data-testid="input-gold-lookup"
        />
        <button type="button" className={`${btn} border-border`} disabled={busy} onClick={apply} data-testid="button-gold-lookup">Find</button>
        {active && (
          <button type="button" className={`${btn} border-border`} disabled={busy}
            onClick={() => { setText(""); setError(null); onApply(null); }} data-testid="button-gold-lookup-clear">
            Show all
          </button>
        )}
      </div>
      {error && <p id="gold-lookup-error" className="mt-1 text-xs text-destructive">{error}</p>}
      {active && <p className="mt-2 text-xs" data-testid="gold-approvals-lookup-active">Showing matches for <span className="font-mono break-all">{active}</span></p>}
    </div>
  );
}
