import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CameraFilePicker } from "./CameraFilePicker";
import {
  applyInventoryObservation,
  cancelInventoryObservation,
  createInventoryObservation,
  fetchOpenInventoryObservations,
  type CandidateItem,
  type InventoryCountDraft,
  type InventoryObservation,
} from "../inventoryShared";

async function encode(file: File): Promise<{ imageBase64: string; mimeType: string }> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error("Could not open photo. Choose a JPEG or PNG."));
    value.src = data;
  });
  const scale = Math.min(1, 900 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  const base64 = canvas.toDataURL("image/jpeg", 0.55).split(",")[1] ?? "";
  if (base64.length > 2_500_000) throw new Error("Photo is too large. Choose a smaller image.");
  return { imageBase64: base64, mimeType: "image/jpeg" };
}

export default function PhotoCountCard({ candidates, onCommitted }: {
  candidates: CandidateItem[];
  onCommitted: () => void;
}) {
  const [open, setOpen] = useState(false);
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

  async function onFiles(files: File[]) {
    setError(null);
    if (files.length < 1 || files.length > 3) return setError("Choose one to three photos for one count.");
    setBusy(true);
    try {
      const photos = [];
      for (const file of files) photos.push(await encode(file));
      setPhotoCount(photos.length);
      setObservation(await createInventoryObservation({ photos, candidates }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyze photos.");
    } finally { setBusy(false); }
  }
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
  return <Card className="bg-card/50 border-primary/30 shadow-md">
    <CardHeader className="pb-2 pt-4 px-5"><div className="flex items-center justify-between gap-2">
      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5"><Camera className="w-4 h-4" /> Count from photos</CardTitle>
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Start count"}</Button>
    </div></CardHeader>
    {open && <CardContent className="px-4 pb-4 space-y-3">
      {!observation ? <><p className="text-xs text-muted-foreground">Attach a close-up label and optional shelf or pallet view. Nothing is added until you review and Apply.</p><CameraFilePicker multiple disabled={busy} onFiles={(files) => void onFiles(files)} /></> :
        <><div className="flex justify-between text-xs"><strong>Review count #{observation.id} · {photoCount} photo{photoCount === 1 ? "" : "s"}</strong><span className="text-muted-foreground">Draft only</span></div>
          {observation.draft.reviewFlags.length > 0 && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"><strong>Review flags:</strong> {observation.draft.reviewFlags.join(" · ")}</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{input("productName", "Product")}{input("brand", "Brand")}{input("variant", "Flavor / variant")}{input("barcode", "Barcode")}{input("packageSize", "Package size")}{input("printedWeight", "Printed weight", true)}{input("unitType", "Unit")}{input("casePack", "Case pack", true)}{input("quantity", "Counted quantity", true)}{input("context", "Shelf / pallet context")}</div>
          <p className="text-[11px] text-muted-foreground">AI output is advisory. Correct every value; overlapping or incomplete views require manual review.</p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>Cancel</Button><Button size="sm" disabled={busy} onClick={() => void apply()}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Apply confirmed count</Button></div></>}
      {busy && !observation && <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Combining photo evidence…</p>}
      {error && !observation && <p className="text-xs text-red-500">{error}</p>}
    </CardContent>}
  </Card>;
}