import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Package,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  PackagePlus,
  Pencil,
  History as HistoryIcon,
  Camera,
  Sparkles,
  Loader2,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  type CandidateItem,
  type InventoryItem,
  type InventoryLot,
  type LedgerEntry,
  fetchInventory,
  fetchLedger,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  restockInventory,
  adjustInventory,
  fetchInventorySettings,
  updateInventorySettings,
  identifyInventoryPhoto,
  rankCandidatesByName,
  inventoryClientId,
  isLowStock,
  lotExpiryStatus,
  daysUntil,
  EXPIRY_SOON_DAYS,
  type PhotoGuess,
  type InventoryCategory,
} from "../inventoryShared";

function fmtQty(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function expiryClass(status: ReturnType<typeof lotExpiryStatus>): string {
  if (status === "expired") return "text-red-500";
  if (status === "soon") return "text-amber-500";
  return "text-muted-foreground";
}

export default function InventoryTab({ candidates }: { candidates: CandidateItem[] }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expirySoonDays, setExpirySoonDays] = useState<number>(EXPIRY_SOON_DAYS);
  const [expiryInput, setExpiryInput] = useState<string>(String(EXPIRY_SOON_DAYS));
  const refetchRef = useRef<() => void>(() => {});

  async function load() {
    try {
      const [data, settings] = await Promise.all([
        fetchInventory(),
        fetchInventorySettings(),
      ]);
      setItems(data);
      setExpirySoonDays(settings.expirySoonDays);
      setExpiryInput(String(settings.expirySoonDays));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }
  refetchRef.current = load;

  async function saveExpiryLeadTime() {
    const n = Math.max(0, Math.round(Number(expiryInput)));
    if (!Number.isFinite(n) || n === expirySoonDays) {
      setExpiryInput(String(expirySoonDays));
      return;
    }
    try {
      const saved = await updateInventorySettings({ expirySoonDays: n });
      setExpirySoonDays(saved.expirySoonDays);
      setExpiryInput(String(saved.expirySoonDays));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
      setExpiryInput(String(expirySoonDays));
    }
  }

  useEffect(() => {
    load();
    const es = new EventSource("/api/inventory/events?clientId=" + inventoryClientId());
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { senderId?: string | null };
        if (msg.senderId !== inventoryClientId()) refetchRef.current();
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const alerts = useMemo(() => {
    const low: InventoryItem[] = [];
    const expiring: { item: InventoryItem; lot: InventoryLot }[] = [];
    const expired: { item: InventoryItem; lot: InventoryLot }[] = [];
    for (const it of items) {
      if (isLowStock(it)) low.push(it);
      for (const lot of it.lots) {
        if (lot.qtyRemaining <= 0) continue;
        const st = lotExpiryStatus(lot, expirySoonDays);
        if (st === "expired") expired.push({ item: it, lot });
        else if (st === "soon") expiring.push({ item: it, lot });
      }
    }
    return { low, expiring, expired };
  }, [items, expirySoonDays]);

  const grouped = useMemo(() => {
    const packaging = items.filter((i) => i.category === "packaging");
    const ingredient = items.filter((i) => i.category !== "packaging");
    return { packaging, ingredient };
  }, [items]);

  const existingKeys = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  // Merged candidate set for photo matching: existing tracked items + items the
  // current production plan would consume. Deduped by stable key.
  const matchCandidates = useMemo<CandidateItem[]>(() => {
    const map = new Map<string, CandidateItem>();
    for (const it of items) {
      map.set(it.key, {
        key: it.key,
        category: (it.category === "packaging" ? "packaging" : "ingredient") as InventoryCategory,
        name: it.name,
        unit: it.unit,
      });
    }
    for (const c of candidates) if (!map.has(c.key)) map.set(c.key, c);
    return [...map.values()];
  }, [items, candidates]);

  return (
    <div className="space-y-4 pb-4">
      {/* Alerts */}
      {(alerts.expired.length > 0 || alerts.expiring.length > 0 || alerts.low.length > 0) && (
        <Card className="bg-card/50 border-amber-500/40 shadow-md">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Inventory Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5 text-sm">
            {alerts.expired.map(({ item, lot }) => (
              <div key={`exp-${lot.id}`} className="flex items-center justify-between gap-2">
                <span className="text-red-500 truncate">{item.name}{lot.lotNumber ? ` · lot ${lot.lotNumber}` : ""}</span>
                <span className="text-red-500 font-medium whitespace-nowrap">Expired {lot.expirationDate}</span>
              </div>
            ))}
            {alerts.expiring.map(({ item, lot }) => {
              const d = daysUntil(lot.expirationDate);
              return (
                <div key={`soon-${lot.id}`} className="flex items-center justify-between gap-2">
                  <span className="text-amber-500 truncate">{item.name}{lot.lotNumber ? ` · lot ${lot.lotNumber}` : ""}</span>
                  <span className="text-amber-500 font-medium whitespace-nowrap">Expires in {d}d</span>
                </div>
              );
            })}
            {alerts.low.map((item) => (
              <div key={`low-${item.id}`} className="flex items-center justify-between gap-2">
                <span className="text-amber-500 truncate">{item.name} — low stock</span>
                <span className="text-amber-500 font-medium tabular-nums whitespace-nowrap">
                  {fmtQty(item.onHand)} / {fmtQty(item.reorderThreshold)} {item.unit}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add item */}
      <Card className="bg-card/50 border-border/50 shadow-md">
        <CardHeader className="pb-2 pt-4 px-5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <PackagePlus className="w-4 h-4" /> Add Item
            </CardTitle>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {showAdd ? <ChevronDown className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {showAdd ? "Close" : "New"}
            </button>
          </div>
        </CardHeader>
        {showAdd && (
          <CardContent className="px-4 pb-4">
            <AddItemForm
              candidates={candidates.filter((c) => !existingKeys.has(c.key))}
              onAdded={() => {
                setShowAdd(false);
                load();
              }}
            />
          </CardContent>
        )}
      </Card>

      {/* Photo stock intake */}
      <PhotoIntakeCard candidates={matchCandidates} onCommitted={load} />

      {loading && <p className="text-xs text-muted-foreground italic px-1">Loading inventory…</p>}
      {error && <p className="text-xs text-red-500 px-1">{error}</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No inventory yet. Use <span className="font-semibold">Add Item</span> to start tracking stock.
        </p>
      )}

      {grouped.packaging.length > 0 && (
        <CategorySection
          title="Packaging"
          icon={<Package className="w-4 h-4" />}
          items={grouped.packaging}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onChanged={load}
          expirySoonDays={expirySoonDays}
        />
      )}
      {grouped.ingredient.length > 0 && (
        <CategorySection
          title="Ingredients"
          icon={<Boxes className="w-4 h-4" />}
          items={grouped.ingredient}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onChanged={load}
          expirySoonDays={expirySoonDays}
        />
      )}

      {/* Settings: configurable expiry lead time */}
      <Card className="bg-card/50 border-border/50 shadow-md">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="expiry-lead" className="text-sm text-muted-foreground">
              Expiring-soon lead time (days)
            </label>
            <Input
              id="expiry-lead"
              type="number"
              min={0}
              inputMode="numeric"
              className="w-20 text-right"
              value={expiryInput}
              onChange={(e) => setExpiryInput(e.target.value)}
              onBlur={saveExpiryLeadTime}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Lots within this many days of expiring are flagged as expiring soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CategorySection({
  title,
  icon,
  items,
  expandedId,
  setExpandedId,
  onChanged,
  expirySoonDays,
}: {
  title: string;
  icon: React.ReactNode;
  items: InventoryItem[];
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  onChanged: () => void;
  expirySoonDays: number;
}) {
  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-1">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onChanged={onChanged}
            expirySoonDays={expirySoonDays}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  expanded,
  onToggle,
  onChanged,
  expirySoonDays,
}: {
  item: InventoryItem;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  expirySoonDays: number;
}) {
  const low = isLowStock(item);
  return (
    <div className="rounded-md border border-border/40 bg-muted/10">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span className="font-medium text-sm truncate">{item.name}</span>
          {low && <span className="text-[10px] font-bold uppercase text-amber-500 border border-amber-500/50 rounded px-1 shrink-0">Low</span>}
        </span>
        <span className={`font-mono font-semibold text-sm tabular-nums whitespace-nowrap ${low ? "text-amber-500" : "text-foreground"}`}>
          {fmtQty(item.onHand)} <span className="font-normal text-muted-foreground">{item.unit}</span>
        </span>
      </button>
      {expanded && <ItemDetail item={item} onChanged={onChanged} expirySoonDays={expirySoonDays} />}
    </div>
  );
}

function ItemDetail({ item, onChanged, expirySoonDays }: { item: InventoryItem; onChanged: () => void; expirySoonDays: number }) {
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<LedgerEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editThreshold, setEditThreshold] = useState(false);
  const [thresholdVal, setThresholdVal] = useState(String(item.reorderThreshold));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch {
      /* surfaced by parent reload */
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    if (!showHistory && history == null) {
      try {
        setHistory(await fetchLedger(item.id));
      } catch {
        setHistory([]);
      }
    }
    setShowHistory((v) => !v);
  }

  const lots = item.lots.filter((l) => l.qtyRemaining > 0);
  const emptyLots = item.lots.filter((l) => l.qtyRemaining <= 0);

  return (
    <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
      {/* Lots */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Lots (FIFO/FEFO order)</p>
        {lots.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No stock on hand.</p>
        ) : (
          <div className="space-y-1">
            {lots.map((lot) => {
              const st = lotExpiryStatus(lot, expirySoonDays);
              return (
                <div key={lot.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {lot.lotNumber ? `Lot ${lot.lotNumber}` : "Unlotted"}
                    {lot.expirationDate ? <span className={`ml-1 ${expiryClass(st)}`}>· exp {lot.expirationDate}</span> : ""}
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap">{fmtQty(lot.qtyRemaining)} / {fmtQty(lot.qtyReceived)}</span>
                </div>
              );
            })}
          </div>
        )}
        {emptyLots.length > 0 && (
          <p className="text-[11px] text-muted-foreground/70 mt-1">{emptyLots.length} depleted lot{emptyLots.length !== 1 ? "s" : ""}</p>
        )}
      </div>

      {/* Reorder threshold */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Reorder at</span>
        {editThreshold ? (
          <span className="flex items-center gap-1.5">
            <Input
              type="number"
              value={thresholdVal}
              onChange={(e) => setThresholdVal(e.target.value)}
              className="h-7 w-20 text-xs"
            />
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await updateInventoryItem(item.id, { reorderThreshold: Number(thresholdVal) || 0 });
                  setEditThreshold(false);
                })
              }
            >
              Save
            </Button>
          </span>
        ) : (
          <button type="button" onClick={() => setEditThreshold(true)} className="flex items-center gap-1 text-xs font-mono tabular-nums text-foreground hover:text-primary">
            {fmtQty(item.reorderThreshold)} {item.unit} <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>

      <Separator className="bg-border/40" />

      <RestockForm item={item} busy={busy} run={run} />
      <AdjustForm item={item} busy={busy} run={run} />

      <Separator className="bg-border/40" />

      {/* History */}
      <button type="button" onClick={loadHistory} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <HistoryIcon className="w-3.5 h-3.5" /> {showHistory ? "Hide" : "Show"} history
      </button>
      {showHistory && (
        <div className="space-y-1">
          {history == null ? (
            <p className="text-xs text-muted-foreground italic">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No history.</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  <span className="uppercase font-semibold">{h.type}</span>
                  <span className="ml-1.5 text-muted-foreground/70">{fmtDateTime(h.createdAt)}</span>
                  {h.note ? ` · ${h.note}` : ""}
                </span>
                <span className={`font-mono tabular-nums whitespace-nowrap ${h.qtyDelta < 0 ? "text-red-500" : "text-emerald-500"}`}>
                  {h.qtyDelta > 0 ? "+" : ""}{fmtQty(h.qtyDelta)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <Separator className="bg-border/40" />
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (confirm(`Delete "${item.name}" and all its lots? This cannot be undone.`)) {
            run(() => deleteInventoryItem(item.id));
          }
        }}
        className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-400 disabled:opacity-50"
      >
        <Trash2 className="w-3.5 h-3.5" /> Delete item
      </button>
    </div>
  );
}

function RestockForm({
  item,
  busy,
  run,
}: {
  item: InventoryItem;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [qty, setQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiration, setExpiration] = useState("");
  const n = Number(qty);
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Restock</p>
      <div className="grid grid-cols-3 gap-1.5">
        <Input type="number" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="Lot #" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className="h-8 text-xs" />
        <Input type="date" placeholder="Exp" value={expiration} onChange={(e) => setExpiration(e.target.value)} className="h-8 text-xs" />
      </div>
      <Button
        size="sm"
        className="h-8 w-full text-xs"
        disabled={busy || !(n > 0)}
        onClick={() =>
          run(async () => {
            await restockInventory({
              itemKey: item.key,
              category: item.category,
              name: item.name,
              unit: item.unit,
              qty: n,
              lotNumber: lotNumber.trim() || undefined,
              receivedDate: todayStr(),
              expirationDate: expiration || undefined,
            });
            setQty("");
            setLotNumber("");
            setExpiration("");
          })
        }
      >
        <Plus className="w-3 h-3" /> Add stock
      </Button>
    </div>
  );
}

function AdjustForm({
  item,
  busy,
  run,
}: {
  item: InventoryItem;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const n = Number(delta);
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Manual adjustment</p>
      <div className="grid grid-cols-2 gap-1.5">
        <Input type="number" placeholder="± Qty" value={delta} onChange={(e) => setDelta(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="Reason" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 w-full text-xs"
        disabled={busy || !(n !== 0) || Number.isNaN(n)}
        onClick={() =>
          run(async () => {
            await adjustInventory({ itemId: item.id, qtyDelta: n, note: note.trim() || undefined });
            setDelta("");
            setNote("");
          })
        }
      >
        Apply adjustment
      </Button>
    </div>
  );
}

function AddItemForm({
  candidates,
  onAdded,
}: {
  candidates: CandidateItem[];
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<"candidate" | "custom">(candidates.length > 0 ? "candidate" : "custom");
  const [selectedKey, setSelectedKey] = useState(candidates[0]?.key ?? "");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState<"ingredient" | "packaging">("ingredient");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (mode === "candidate") {
        const c = candidates.find((x) => x.key === selectedKey);
        if (!c) return;
        await createInventoryItem({
          key: c.key,
          category: c.category,
          name: c.name,
          unit: c.unit,
          reorderThreshold: Number(threshold) || 0,
        });
      } else {
        const trimmed = name.trim();
        if (!trimmed) return;
        const u = unit.trim() || "units";
        await createInventoryItem({
          key: `${category}:${trimmed}:${u}`,
          category,
          name: trimmed,
          unit: u,
          reorderThreshold: Number(threshold) || 0,
        });
      }
      onAdded();
    } catch {
      /* parent reloads */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode("candidate")}
          disabled={candidates.length === 0}
          className={`flex-1 h-8 rounded-md border text-xs font-semibold transition-colors disabled:opacity-40 ${mode === "candidate" ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"}`}
        >
          From production
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={`flex-1 h-8 rounded-md border text-xs font-semibold transition-colors ${mode === "custom" ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"}`}
        >
          Custom
        </button>
      </div>

      {mode === "candidate" ? (
        candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">All production items already tracked. Use Custom to add others.</p>
        ) : (
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="w-full h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
          >
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({c.unit})
              </option>
            ))}
          </select>
        )
      ) : (
        <div className="space-y-1.5">
          <Input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
          <div className="grid grid-cols-2 gap-1.5">
            <Input placeholder="Unit (e.g. lbs, cases)" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 text-sm" />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as "ingredient" | "packaging")}
              className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
            >
              <option value="ingredient">Ingredient</option>
              <option value="packaging">Packaging</option>
            </select>
          </div>
        </div>
      )}

      <Input
        type="number"
        placeholder="Reorder threshold (optional)"
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        className="h-9 text-sm"
      />
      <Button size="sm" className="h-9 w-full text-sm" disabled={busy} onClick={submit}>
        <Plus className="w-3.5 h-3.5" /> Add to inventory
      </Button>
    </div>
  );
}

// ── Photo stock intake ───────────────────────────────────────────────────────
// Downscale a chosen image to a JPEG data URL, then return its base64 payload.
async function fileToBase64Jpeg(file: File, maxEdge = 1280): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to load image"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl.split(",")[1] ?? "";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.6).split(",")[1] ?? "";
}

type ReviewRow = {
  id: string;
  guessName: string;
  name: string;
  qty: string;
  unit: string;
  category: InventoryCategory;
  matchedKey: string | null;
  confidence: number;
  lotNumber: string;
  expiration: string;
};

const NEW_ITEM = "__new__";

function PhotoIntakeCard({
  candidates,
  onCommitted,
}: {
  candidates: CandidateItem[];
  onCommitted: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [noResults, setNoResults] = useState(false);
  const [committingId, setCommittingId] = useState<string | null>(null);

  const candByKey = useMemo(() => {
    const m = new Map<string, CandidateItem>();
    for (const c of candidates) m.set(c.key, c);
    return m;
  }, [candidates]);

  function toRows(guesses: PhotoGuess[]): ReviewRow[] {
    return guesses.map((g, i) => {
      const matched = g.matchedKey ? candByKey.get(g.matchedKey) : undefined;
      return {
        id: `${Date.now()}-${i}`,
        guessName: g.name,
        name: matched?.name ?? g.name,
        qty: g.qty > 0 ? fmtQty(g.qty) : "",
        unit: matched?.unit ?? g.unit,
        category: matched?.category ?? g.category,
        matchedKey: matched?.key ?? null,
        confidence: g.confidence,
        lotNumber: "",
        expiration: "",
      };
    });
  }

  async function onPick(file: File | null) {
    if (!file) return;
    setError(null);
    setNoResults(false);
    setRows([]);
    setAnalyzing(true);
    try {
      const imageBase64 = await fileToBase64Jpeg(file);
      const { items } = await identifyInventoryPhoto({
        imageBase64,
        mimeType: "image/jpeg",
        candidates,
      });
      const next = toRows(items);
      setRows(next);
      setNoResults(next.length === 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze photo");
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function patch(id: string, p: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  // Re-map a review row to an existing inventory item, or back to a new item.
  // When matched, the row's name/unit/category lock to the chosen item so what
  // the user sees is exactly what gets committed.
  function setMatch(id: string, key: string) {
    if (key === NEW_ITEM) {
      setRows((rs) =>
        rs.map((r) => (r.id === id ? { ...r, matchedKey: null, name: r.guessName } : r)),
      );
      return;
    }
    const c = candByKey.get(key);
    if (!c) return;
    patch(id, { matchedKey: c.key, name: c.name, unit: c.unit, category: c.category });
  }

  async function confirmRow(row: ReviewRow) {
    const n = Number(row.qty);
    if (!(n > 0)) return;
    const name = row.name.trim();
    if (!name) return;
    const unit = row.unit.trim() || "units";
    // matched rows commit the matched item's stable key; new items derive one.
    const itemKey = row.matchedKey ?? `${row.category}:${name}:${unit}`;
    setCommittingId(row.id);
    try {
      await restockInventory({
        itemKey,
        category: row.category,
        name,
        unit,
        qty: n,
        lotNumber: row.lotNumber.trim() || undefined,
        receivedDate: todayStr(),
        expirationDate: row.expiration || undefined,
      });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add stock");
    } finally {
      setCommittingId(null);
    }
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" /> Photo Intake
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />} {open ? "Close" : "Scan"}
          </button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Take or upload a photo of incoming stock. We'll identify the items and pre-fill
            restock entries for you to confirm.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
          <Button
            size="sm"
            className="h-9 w-full text-sm"
            disabled={analyzing}
            onClick={() => fileRef.current?.click()}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing…
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" /> Choose photo
              </>
            )}
          </Button>

          {error && <p className="text-xs text-red-500">{error}</p>}
          {noResults && (
            <p className="text-xs text-muted-foreground">
              Couldn't identify any items. Try a clearer photo, or add stock manually above.
            </p>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Review &amp; confirm ({rows.length})
              </p>
              {rows.map((row) => {
                const lowConf = row.confidence < 0.5;
                const ranked = rankCandidatesByName(row.guessName, candidates);
                const matchedLocked = !!row.matchedKey;
                return (
                  <div key={row.id} className="rounded-md border border-border/40 bg-muted/10 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {row.matchedKey ? (
                          <span className="text-[10px] font-bold uppercase text-emerald-500 border border-emerald-500/50 rounded px-1 shrink-0">Match</span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase text-sky-500 border border-sky-500/50 rounded px-1 shrink-0">New</span>
                        )}
                        {lowConf && (
                          <span className="text-[10px] font-bold uppercase text-amber-500 border border-amber-500/50 rounded px-1 shrink-0">Low conf</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                        className="text-muted-foreground hover:text-red-500 shrink-0"
                        aria-label="Discard"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {candidates.length > 0 && (
                      <label className="block">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Match to</span>
                        <select
                          value={row.matchedKey ?? NEW_ITEM}
                          onChange={(e) => setMatch(row.id, e.target.value)}
                          className="mt-0.5 w-full h-8 rounded-md border border-border/60 bg-background px-1.5 text-xs"
                        >
                          <option value={NEW_ITEM}>+ New item "{row.guessName}"</option>
                          {ranked.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name} ({c.unit})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <Input
                      placeholder="Item name"
                      value={row.name}
                      disabled={matchedLocked}
                      onChange={(e) => patch(row.id, { name: e.target.value })}
                      className="h-8 text-xs disabled:opacity-60"
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      <Input
                        type="number"
                        placeholder="Qty"
                        value={row.qty}
                        onChange={(e) => patch(row.id, { qty: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <Input
                        placeholder="Unit"
                        value={row.unit}
                        disabled={matchedLocked}
                        onChange={(e) => patch(row.id, { unit: e.target.value })}
                        className="h-8 text-xs disabled:opacity-60"
                      />
                      <select
                        value={row.category}
                        disabled={matchedLocked}
                        onChange={(e) => patch(row.id, { category: e.target.value as InventoryCategory })}
                        className="h-8 rounded-md border border-border/60 bg-background px-1 text-xs disabled:opacity-50"
                      >
                        <option value="ingredient">Ingredient</option>
                        <option value="packaging">Packaging</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input
                        placeholder="Lot #"
                        value={row.lotNumber}
                        onChange={(e) => patch(row.id, { lotNumber: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <Input
                        type="date"
                        value={row.expiration}
                        onChange={(e) => patch(row.id, { expiration: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="h-8 w-full text-xs"
                      disabled={committingId === row.id || !(Number(row.qty) > 0) || !row.name.trim()}
                      onClick={() => confirmRow(row)}
                    >
                      {committingId === row.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> Adding…
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" /> Confirm &amp; add stock
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
