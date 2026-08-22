import { useEffect, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { describeShippingPatch, type ShippingCandidate, type ShippingPatch } from "@workspace/shipping-import";
import type { ShippingImportPrepared } from "@/shippingImport";
import { loadProfile } from "@/storage";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  prepared: ShippingImportPrepared | null;
  applying: boolean;
  /**
   * Confirm with the reviewed rows (brand picked, include/exclude applied).
   * `flavors` empty = apply to the whole brand; otherwise only those flavors.
   */
  onConfirm: (rows: { brand: string; flavors: string[]; patch: ShippingPatch }[], acknowledged: boolean) => void;
};

// Review screen for the Shipping & Palletizing Guide importer. Each guide row
// is parsed deterministically and matched to a known brand; the manager
// reviews the packaging values each brand will get, can re-point a row to a
// different brand (or leave unmatched rows out), and confirms. Values the
// guide carries but the app can't map confidently (e.g. gripsheets "X") are
// listed as "kept as-is" — the import never guesses.
export default function ShippingImportDialog({
  open,
  onClose,
  loading,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brandPicks, setBrandPicks] = useState<Record<string, string>>({});
  // Per-row flavor targets. Missing/empty set = "All flavors" (whole brand).
  const [flavorPicks, setFlavorPicks] = useState<Record<string, Set<string>>>({});
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset review state whenever a fresh prepared result arrives: rows with a
  // matched brand start included; unmatched rows start excluded until the
  // manager picks a brand for them. Flavor targeting defaults to "All flavors".
  useEffect(() => {
    if (prepared) {
      setSelected(new Set(prepared.candidates.filter((c) => c.brand).map((c) => c.id)));
      setBrandPicks(
        Object.fromEntries(prepared.candidates.map((c) => [c.id, c.brand ?? ""])),
      );
      setFlavorPicks({});
      setAcknowledged(false);
    } else {
      setSelected(new Set());
      setBrandPicks({});
      setFlavorPicks({});
      setAcknowledged(false);
    }
  }, [prepared]);

  if (!open) return null;

  const candidates = prepared?.candidates ?? [];
  const brands = prepared?.brands ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickBrand = (c: ShippingCandidate, brand: string) => {
    setBrandPicks((prev) => ({ ...prev, [c.id]: brand }));
    // Changing the brand resets the row's flavor targeting to "All flavors"
    // (the old picks belong to the previous brand's flavor list).
    setFlavorPicks((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
    // Picking a brand for a previously unmatched row is an implicit include;
    // clearing the pick excludes it (can't apply without a target brand).
    setSelected((prev) => {
      const next = new Set(prev);
      if (brand) next.add(c.id);
      else next.delete(c.id);
      return next;
    });
  };

  const toggleFlavor = (id: string, flavor: string) =>
    setFlavorPicks((prev) => {
      const cur = new Set(prev[id] ?? []);
      if (cur.has(flavor)) cur.delete(flavor);
      else cur.add(flavor);
      return { ...prev, [id]: cur };
    });

  const clearFlavors = (id: string) =>
    setFlavorPicks((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const flavorsByBrand = prepared?.flavorsByBrand ?? {};

  const applyRows = candidates
    .filter((c) => selected.has(c.id) && (brandPicks[c.id] ?? "").trim() && Object.keys(c.patch).length > 0)
    .map((c) => ({
      brand: brandPicks[c.id],
      flavors: Array.from(flavorPicks[c.id] ?? []),
      patch: c.patch,
    }));
  const requiresAcknowledgement = applyRows.some((row) => {
    const targets = row.flavors.length ? row.flavors : ["", ...(flavorsByBrand[row.brand] ?? [])];
    return targets.some((flavor) => {
      const profile = loadProfile(row.brand, flavor) as Record<string, unknown> | null;
      return Object.entries(row.patch).some(([key, value]) =>
        profile?.[key] != null && profile[key] !== "" && profile[key] !== value,
      );
    });
  });

  const confirm = () => {
    if (applyRows.length > 0 && (!requiresAcknowledgement || acknowledged)) onConfirm(applyRows, true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="dialog-shipping-import">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Import Shipping &amp; Palletizing Guide</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted" aria-label="Close" data-testid="button-shipping-import-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading the guide…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          {!loading && !error && prepared && (
            <>
              <p className="text-xs text-muted-foreground">
                Each row below fills that brand&apos;s packaging settings — all flavors by default, or tap specific flavors to target just those.
                Values the guide has but the app can&apos;t match for sure are <span className="font-medium text-foreground">kept as-is</span> — nothing is guessed.
                Uncheck a row to skip it; unmatched rows need a brand picked first.
              </p>
              <div className="space-y-2">
                {candidates.map((c) => {
                  const brand = brandPicks[c.id] ?? "";
                  const included = selected.has(c.id) && !!brand.trim();
                  const brandFlavors = brand ? (flavorsByBrand[brand] ?? []) : [];
                  const picked = flavorPicks[c.id] ?? new Set<string>();
                  return (
                    <div key={c.id} className={`rounded-md border p-3 space-y-1.5 ${included ? "border-border" : "border-border/50 opacity-70"}`} data-testid={`row-shipping-${c.id}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary shrink-0"
                          checked={selected.has(c.id)}
                          disabled={!brand.trim()}
                          onChange={() => toggle(c.id)}
                          data-testid={`checkbox-shipping-${c.id}`}
                        />
                        <span className="text-sm font-medium flex-1 min-w-0 truncate">{c.guideName}</span>
                        <select
                          className="text-xs border border-border rounded px-1.5 py-1 bg-background max-w-[180px]"
                          value={brand}
                          onChange={(e) => pickBrand(c, e.target.value)}
                          data-testid={`select-shipping-brand-${c.id}`}
                        >
                          <option value="">{c.brand ? "— skip —" : "Pick brand…"}</option>
                          {brands.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-6">
                        {describeShippingPatch(c.patch).map((chip) => (
                          <span key={chip} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{chip}</span>
                        ))}
                        {Object.keys(c.patch).length === 0 && (
                          <span className="text-[11px] text-muted-foreground">Nothing recognizable to apply.</span>
                        )}
                      </div>
                      {brand && brandFlavors.length > 0 && (
                        <div className="pl-6 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">Apply to:</span>
                          <button
                            type="button"
                            onClick={() => clearFlavors(c.id)}
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${picked.size === 0 ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted"}`}
                            data-testid={`chip-shipping-all-flavors-${c.id}`}
                          >
                            All flavors
                          </button>
                          {brandFlavors.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => toggleFlavor(c.id, f)}
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${picked.has(f) ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted"}`}
                              data-testid={`chip-shipping-flavor-${c.id}-${f}`}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      )}
                      {c.unmapped.length > 0 && (
                        <p className="pl-6 text-[11px] text-muted-foreground">
                          Kept as-is: {c.unmapped.join(" · ")}
                        </p>
                      )}
                      {!c.brand && !brand && (
                        <p className="pl-6 text-[11px] text-amber-600">No matching brand found — pick one to include this row.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {prepared ? `${applyRows.length} of ${candidates.length} row${candidates.length === 1 ? "" : "s"} will apply` : ""}
          </span>
          {requiresAcknowledgement && (
            <label className="flex items-center gap-2 text-xs text-amber-700">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              I reviewed the changes; existing profile settings may be replaced.
            </label>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted" data-testid="button-shipping-import-cancel">
              Cancel
            </button>
            <button
              type="button"
              disabled={applying || loading || !!error || applyRows.length === 0 || (requiresAcknowledgement && !acknowledged)}
              onClick={confirm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-shipping-import-confirm"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {applying ? "Applying…" : "Apply Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
