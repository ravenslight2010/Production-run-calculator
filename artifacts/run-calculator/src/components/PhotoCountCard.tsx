import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  applyInventoryObservation,
  cancelInventoryObservation,
  fetchOpenInventoryObservations,
  type InventoryCountDraft,
  type InventoryObservation,
} from "../inventoryShared";

export default function PhotoCountCard({ onCommitted }: {
  onCommitted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [observation, setObservation] = useState<InventoryObservation | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchOpenInventoryObservations().then((rows) => {
      if (rows[0]) {
        setObservation(rows[0]);
        setPhotoCount(rows[0].photos.length);
      }
    }).catch(() => { /* no draft is normal for a first count */ });
  }, []);

  function patch(key: keyof InventoryCountDraft, value: string | number | null) {
    setObservation((o) => o ? { ...o, draft: { ...o.draft, [key]: { ...(o.draft[key] as object), value } } } : o);
  }
  function input(key: keyof InventoryCountDraft, label: string, numeric = false) {
    if (!observation) return null;
    const f = observation.draft[key] as { value: string | number | null; confidence: number; evidence: number[] };
    return <label className="space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input type={numeric ? "number" : "text"} value={f.value ?? ""} onChange={(e) => patch(key, numeric ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} className="h-8 text-xs" />
      <span className={`text-[10px] ${f.confidence < 0.7 ? "text-amber-500" : "text-muted-foreground"}`}>{Math.round(f.confidence * 100)}% confidence · photo {f.evidence.length ? f.evidence.map((n) => n + 1).join(", ") : "—"}</span>
    </label>;
  }
  async function apply() {
    if (!observation) return;
    const d = observation.draft;
    const name = String(d.productName.value ?? "").trim();
    const unitType = String(d.unitType.value ?? "").trim();
    const quantity = Number(d.quantity.value);
    if (!name || !unitType || !(quantity > 0)) return setError("Confirm a product name, unit, and positive quantity before Apply.");
    setBusy(true);
    try {
      const result = await applyInventoryObservation(observation.id, {
        ...d, name, unitType, quantity, category: "ingredient",
        brand: String(d.brand.value ?? ""), variant: String(d.variant.value ?? ""),
        barcode: String(d.barcode.value ?? ""), packageSize: String(d.packageSize.value ?? ""),
        printedWeight: d.printedWeight.value == null ? null : Number(d.printedWeight.value),
        casePack: d.casePack.value == null ? null : Number(d.casePack.value),
      });
      setObservation(result.observation); onCommitted();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply count."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!observation) return;
    setBusy(true);
    try { await cancelInventoryObservation(observation.id); setObservation(null); setPhotoCount(0); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not cancel draft."); }
    finally { setBusy(false); }
  }
  // New photo counts are disabled, but an existing draft must remain visible so
  // a manager can review, apply, or cancel it without losing the record.
  if (!observation) return null;

  return <Card data-testid="photo-count-card" className="bg-card/50 border-primary/30 shadow-md">
    <CardHeader className="pb-2 pt-4 px-5"><div className="flex items-center justify-between gap-2">
      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5"><Camera className="w-4 h-4" /> Review photo count draft</CardTitle>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Manual review only</span>
    </div></CardHeader>
    <CardContent className="px-4 pb-4 space-y-3">
      <p className="text-xs text-muted-foreground">New photo counts are disabled. This previously opened draft is preserved for manual correction and review; nothing changes until you Apply the confirmed values.</p>
      <div data-testid="photo-count-review" className="flex justify-between text-xs"><strong>Review count #{observation.id} · {photoCount} photo{photoCount === 1 ? "" : "s"}</strong><span className="text-muted-foreground">Draft only</span></div>
      {observation.draft.reviewFlags.length > 0 && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"><strong>Review flags:</strong> {observation.draft.reviewFlags.join(" · ")}</div>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{input("productName", "Product")}{input("brand", "Brand")}{input("variant", "Flavor / variant")}{input("barcode", "Barcode")}{input("packageSize", "Package size")}{input("printedWeight", "Printed weight", true)}{input("unitType", "Unit")}{input("casePack", "Case pack", true)}{input("quantity", "Counted quantity", true)}{input("context", "Shelf / pallet context")}</div>
      <p className="text-[11px] text-muted-foreground">AI output is advisory. Correct every value; overlapping or incomplete views require manual review.</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>Cancel</Button><Button size="sm" disabled={busy} onClick={() => void apply()}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Apply confirmed count</Button></div>
    </CardContent>
  </Card>;
}