import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  ShieldCheck,
  CheckCircle2,
  Clock,
  Recycle,
  ArrowRightLeft,
  MapPin,
  FileText,
  Tag,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type CandidateItem,
  type InventoryItem,
  computeWarehouseCoverage,
  type WarehouseCoverage,
  type InventoryLot,
  type InventoryLocation,
  type LedgerEntry,
  type TransferNeed,
  fetchInventory,
  fetchProductionIngredients,
  linkInventoryProduct,
  type ProductionIngredient,
  fetchInventoryLocations,
  createInventoryLocation,
  updateInventoryLocation,
  deleteInventoryLocation,
  transferInventory,
  computeRunTransferNeeds,
  fetchLedger,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  restockInventory,
  adjustInventory,
  fetchInventorySettings,
  updateInventorySettings,
  identifyInventoryPhoto,
  qualityCheckPhoto,
  recordQualityCheck,
  wasteInsight,
  productionSheetPhoto,
  verifyLabelPhoto,
  type QualityCheckResult,
  type QualityProductType,
  type QualityStatus,
  type WasteInsightResult,
  type ProductionSheetPhotoResult,
  type LabelVerifyResult,
  type LabelExpected,
  type LabelVerdict,
  type LabelFieldMatch,
  MAX_IMAGE_BASE64_CHARS,
  isHeicFile,
  HEIC_UNSUPPORTED_MESSAGE,
  photoErrorMessage,
  InventoryApiError,
  rankCandidatesByName,
  fetchPhotoAliases,
  savePhotoAliases,
  applyPhotoAliases,
  type PhotoAlias,
  inventoryClientId,
  isLowStock,
  lotExpiryStatus,
  daysUntil,
  EXPIRY_SOON_DAYS,
  type PhotoGuess,
  type InventoryCategory,
} from "../inventoryShared";
import { saveFacilityKnowledge } from "../aiMemory";
import { useMe } from "../useRole";
import type { FormValues } from "../types";
import type { IngredientSubstitution, SubstitutionLogEntry } from "@workspace/inventory-math";
import SubstitutionsManager from "./SubstitutionsManager";
import SubstitutionLog from "./SubstitutionLog";
import ProactiveAlertSettingsCard from "./ProactiveAlertSettingsCard";
import { BarcodeScanner, CameraFilePicker } from "./CameraFilePicker";
import PhotoCountCard from "./PhotoCountCard";

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
    hour12: true,
  });
}

function expiryClass(status: ReturnType<typeof lotExpiryStatus>): string {
  if (status === "expired") return "text-red-500";
  if (status === "soon") return "text-amber-500";
  return "text-muted-foreground";
}

export default function InventoryTab({
  candidates,
  runValsList = [],
  substitutions = [],
  substitutionLog = [],
  substitutionOptions = [],
  onAddSubstitution = () => {},
  onRemoveSubstitution = () => {},
  onClearSubstitutions = () => {},
  coverageRunVals = [],
}: {
  candidates: CandidateItem[];
  runValsList?: FormValues[];
  substitutions?: IngredientSubstitution[];
  substitutionLog?: SubstitutionLogEntry[];
  substitutionOptions?: string[];
  onAddSubstitution?: (sub: IngredientSubstitution) => void;
  onRemoveSubstitution?: (id: string) => void;
  onClearSubstitutions?: () => void;
  coverageRunVals?: FormValues[];
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [productionIngredients, setProductionIngredients] = useState<ProductionIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [subPrefill, setSubPrefill] = useState<string | null>(null);
  const [expirySoonDays, setExpirySoonDays] = useState<number>(EXPIRY_SOON_DAYS);
  const [expiryInput, setExpiryInput] = useState<string>(String(EXPIRY_SOON_DAYS));
  const { hasCapability } = useMe();
  const canManageInventory = hasCapability("manage-inventory");
  const canUseAiTools = hasCapability("use-ai-tools");
  const refetchRef = useRef<() => void>(() => {});

  async function load() {
    try {
      const [data, settings, locs] = await Promise.all([
        fetchInventory(),
        fetchInventorySettings(),
        fetchInventoryLocations(),
      ]);
      setItems(data);
      setLocations(locs);
      // Only managers can edit product links. Avoid adding a catalog request
      // to staff/read-only inventory loads (and keep those loads resilient if
      // the catalog is temporarily unavailable).
      if (canManageInventory) {
        try {
          setProductionIngredients(await fetchProductionIngredients());
        } catch {
          setProductionIngredients([]);
        }
      } else {
        setProductionIngredients([]);
      }
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
  const coverage = useMemo(
    () => canManageInventory && coverageRunVals.length > 0
      ? computeWarehouseCoverage(coverageRunVals, items, productionIngredients)
      : [],
    [canManageInventory, coverageRunVals, items, productionIngredients],
  );

  const grouped = useMemo(() => {
    const packaging = items.filter((i) => i.category === "packaging");
    const ingredient = items.filter((i) => i.category !== "packaging");
    return { packaging, ingredient };
  }, [items]);

  // Transfer warnings: items the onsite/line location can't cover for the day's
  // run plan while another location holds transferable stock. Shared math with
  // mobile so the two raise identical warnings (replit.md parity).
  const transferNeeds = useMemo<TransferNeed[]>(
    () => computeRunTransferNeeds(runValsList, items),
    [runValsList, items],
  );

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
      {canManageInventory && coverage.length > 0 && <WarehouseCoverageCard coverage={coverage} />}

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
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-amber-500 font-medium tabular-nums">
                    {fmtQty(item.onHand)} / {fmtQty(item.reorderThreshold)} {item.unit}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubPrefill(item.name)}
                    className="shrink-0 px-2 py-0.5 rounded border border-amber-500/50 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 transition-colors"
                  >
                    Substitute
                  </button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Transfer warnings: onsite/line can't cover the day's plan but another
          location holds stock that could be moved in. */}
      {transferNeeds.length > 0 && (
        <Card className="bg-card/50 border-sky-500/40 shadow-md">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-sky-500 flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4" /> Transfer Needed
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5 text-sm">
            {transferNeeds.map((t) => (
              <div key={`xfer-${t.key}`} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-sky-600 dark:text-sky-400 font-medium truncate">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    Need {fmtQty(t.needed)} {t.unit}, onsite has {fmtQty(t.onsite)}. Move{" "}
                    {fmtQty(t.transferable)} {t.unit} from{" "}
                    {t.sources.map((s) => s.locationName).join(", ")}.
                  </span>
                </span>
                <span className="text-sky-600 dark:text-sky-400 font-medium whitespace-nowrap tabular-nums">
                  −{fmtQty(t.shortfall)} {t.unit}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Locations (named storage). Managers add/rename/set-onsite/delete. */}
      {canManageInventory && (
        <LocationsCard locations={locations} onChanged={load} />
      )}

      {/* Temporary substitutions overlay (day-state, reverts at daily reset) */}
      <SubstitutionsManager
        substitutions={substitutions}
        ingredientOptions={substitutionOptions}
        onAdd={onAddSubstitution}
        onRemove={onRemoveSubstitution}
        onClearAll={onClearSubstitutions}
        prefillIngredient={subPrefill}
        onPrefillConsumed={() => setSubPrefill(null)}
      />

      {/* Read-only activity log of today's substitution add/clear actions */}
      <SubstitutionLog entries={substitutionLog} />

      {/* Add item (manage-inventory: inventory-item master-data write) */}
      {canManageInventory && (
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
      )}

      {/* Photo stock intake (use-ai-tools: paid AI action) */}
      {canUseAiTools && <PhotoIntakeCard candidates={matchCandidates} locations={locations} onCommitted={load} />}
      {canManageInventory && <PhotoCountCard candidates={matchCandidates} onCommitted={load} />}

      {canUseAiTools && <QualityCheckCard />}

      {canUseAiTools && <ProductionSheetCard />}

      {canUseAiTools && <LabelVerifyCard />}

      {canUseAiTools && <WasteInsightCard />}

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
          locations={locations}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onChanged={load}
          expirySoonDays={expirySoonDays}
          productionIngredients={productionIngredients}
        />
      )}
      {grouped.ingredient.length > 0 && (
        <CategorySection
          title="Ingredients"
          icon={<Boxes className="w-4 h-4" />}
          items={grouped.ingredient}
          locations={locations}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onChanged={load}
          expirySoonDays={expirySoonDays}
          productionIngredients={productionIngredients}
        />
      )}

      {/* Settings: configurable expiry lead time (manage-inventory) */}
      {canManageInventory && (
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
      )}

      {/* Proactive-alert tuning (use-ai-tools: AI nudge settings) */}
      {canUseAiTools && <ProactiveAlertSettingsCard />}
    </div>
  );
}

function WarehouseCoverageCard({ coverage }: { coverage: WarehouseCoverage[] }) {
  const statusLabel: Record<WarehouseCoverage["status"], string> = {
    covered: "Covered",
    short: "Short",
    conversion: "Conversion needed",
    missing: "Missing link",
  };
  const statusClass: Record<WarehouseCoverage["status"], string> = {
    covered: "text-emerald-500 border-emerald-500/40",
    short: "text-red-500 border-red-500/40",
    conversion: "text-amber-500 border-amber-500/40",
    missing: "text-red-500 border-red-500/40",
  };
  const blocked = coverage.filter((row) => row.status !== "covered").length;
  return (
    <Card className={blocked > 0 ? "bg-card/50 border-amber-500/40 shadow-md" : "bg-card/50 border-emerald-500/40 shadow-md"} data-testid="warehouse-coverage">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          {blocked > 0 ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          Warehouse coverage before start
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {blocked > 0
            ? `${blocked} production ingredient${blocked === 1 ? "" : "s"} need attention before production.`
            : "Every planned production ingredient has confirmed onsite coverage."}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1.5 text-sm">
        {coverage.map((row) => (
          <div key={row.ingredientName} className="flex items-start justify-between gap-3 rounded-md border border-border/30 bg-muted/10 px-3 py-2">
            <div className="min-w-0">
              <span className="font-medium">{row.ingredientName}</span>
              <span className="block text-xs text-muted-foreground">
                Need {fmtQty(row.needed)} {row.unit} · linked {row.linkedProducts.length} product{row.linkedProducts.length === 1 ? "" : "s"}
              </span>
              {row.status === "conversion" && (
                <span className="block text-xs text-amber-500">Confirm the production conversion on a linked product.</span>
              )}
              {row.status === "missing" && (
                <span className="block text-xs text-red-500">Link an inventory product to this production ingredient.</span>
              )}
            </div>
            <div className="shrink-0 text-right">
              <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass[row.status]}`}>
                {statusLabel[row.status]}
              </span>
              {row.status !== "missing" && row.status !== "conversion" && (
                <span className="block mt-1 text-xs tabular-nums text-muted-foreground">
                  {fmtQty(row.covered)} / {fmtQty(row.needed)} {row.unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CategorySection({
  title,
  icon,
  items,
  locations,
  expandedId,
  setExpandedId,
  onChanged,
  expirySoonDays,
  productionIngredients,
}: {
  title: string;
  icon: React.ReactNode;
  items: InventoryItem[];
  locations: InventoryLocation[];
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  onChanged: () => void;
  expirySoonDays: number;
  productionIngredients: ProductionIngredient[];
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
            locations={locations}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onChanged={onChanged}
            expirySoonDays={expirySoonDays}
            productionIngredients={productionIngredients}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  locations,
  expanded,
  onToggle,
  onChanged,
  expirySoonDays,
  productionIngredients,
}: {
  item: InventoryItem;
  locations: InventoryLocation[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  expirySoonDays: number;
  productionIngredients: ProductionIngredient[];
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
          {item.category !== "packaging" && (
            <span className={`text-[10px] font-semibold rounded px-1 border shrink-0 ${
              item.conversionConfirmed
                ? "text-emerald-500 border-emerald-500/40"
                : "text-amber-500 border-amber-500/40"
            }`}>
              {item.conversionConfirmed ? "Linked" : "Setup needed"}
            </span>
          )}
          {low && <span className="text-[10px] font-bold uppercase text-amber-500 border border-amber-500/50 rounded px-1 shrink-0">Low</span>}
        </span>
        <span className={`font-mono font-semibold text-sm tabular-nums whitespace-nowrap ${low ? "text-amber-500" : "text-foreground"}`}>
          {fmtQty(item.onHand)} <span className="font-normal text-muted-foreground">{item.unit}</span>
        </span>
      </button>
      {expanded && <ItemDetail item={item} locations={locations} onChanged={onChanged} expirySoonDays={expirySoonDays} productionIngredients={productionIngredients} />}
    </div>
  );
}

function ItemDetail({ item, locations, onChanged, expirySoonDays, productionIngredients }: { item: InventoryItem; locations: InventoryLocation[]; onChanged: () => void; expirySoonDays: number; productionIngredients: ProductionIngredient[] }) {
  const { hasCapability } = useMe();
  const canManageInventory = hasCapability("manage-inventory");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<LedgerEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editThreshold, setEditThreshold] = useState(false);
  const [thresholdVal, setThresholdVal] = useState(String(item.reorderThreshold));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkId, setLinkId] = useState(item.productionIngredientId ?? "");
  const [conversion, setConversion] = useState(item.conversionFactor == null ? "" : String(item.conversionFactor));
  const [priority, setPriority] = useState(String(item.consumptionPriority ?? 0));

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

  async function saveProductionLink() {
    const factor = conversion.trim() === "" ? null : Number(conversion);
    if (linkId && !(factor != null && Number.isFinite(factor) && factor > 0)) {
      window.alert("Enter the confirmed production units supplied by one inventory unit.");
      return;
    }
    await run(async () => {
      await linkInventoryProduct(item.id, {
        productionIngredientId: linkId || null,
        conversionFactor: linkId ? factor : null,
        consumptionPriority: Math.max(0, Math.round(Number(priority) || 0)),
      });
      onChanged();
    });
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

      {/* Per-location on-hand. Only shown once stock lives in more than the
          single onsite location (otherwise the headline on-hand already says
          everything). */}
      {item.byLocation.length > 1 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> By location
          </p>
          <div className="space-y-1">
            {item.byLocation.map((loc) => (
              <div key={loc.locationId} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  {loc.locationName}
                  {loc.isOnsite ? <span className="ml-1 text-[10px] font-bold uppercase text-emerald-500">Onsite</span> : ""}
                </span>
                <span className="font-mono tabular-nums whitespace-nowrap">{fmtQty(loc.onHand)} {item.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reorder threshold (editing is an inventory-item write → manage-inventory) */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Reorder at</span>
        {!canManageInventory ? (
          <span className="text-xs font-mono tabular-nums text-foreground">
            {fmtQty(item.reorderThreshold)} {item.unit}
          </span>
        ) : editThreshold ? (
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

      <RestockForm item={item} locations={locations} busy={busy} run={run} />
      <AdjustForm item={item} busy={busy} run={run} />

      {/* Transfer stock between locations. Open to any signed-in user (same as
          restock). Hidden until at least two locations exist. */}
      {locations.length > 1 && (
        <TransferForm item={item} locations={locations} busy={busy} run={run} />
      )}

      <Separator className="bg-border/40" />

      {canManageInventory && item.category !== "packaging" && (
        <div className="space-y-2 rounded-md border border-border/40 bg-background/50 p-2.5">
          <div className="text-xs font-semibold">Production ingredient link</div>
          <select
            aria-label="Production ingredient"
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs"
          >
            <option value="">Not linked — never auto-deduct</option>
            {productionIngredients.filter((i) => i.enabled).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Production units per inventory unit" value={conversion} onChange={(e) => setConversion(e.target.value)} placeholder={`e.g. 20 ${item.unit} → lbs`} className="h-8 text-xs" />
            <Input aria-label="Consumption priority" value={priority} onChange={(e) => setPriority(e.target.value)} type="number" min="0" className="h-8 text-xs" />
          </div>
          <div className="text-[11px] text-muted-foreground">
            {item.conversionConfirmed ? `Confirmed: ${item.conversionFactor} production units per ${item.unit}.` : "A confirmed conversion is required before production can deduct this product."}
          </div>
          <Button type="button" size="sm" className="h-7 text-xs" disabled={busy} onClick={saveProductionLink}>Save production link</Button>
        </div>
      )}

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

      {canManageInventory && (
        <>
          <Separator className="bg-border/40" />
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete item
          </button>
          <AlertDialog
            open={confirmDelete}
            onOpenChange={(open) => {
              if (!open) setConfirmDelete(false);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete item?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes{" "}
                  <span className="font-medium text-foreground">{item.name}</span> and all
                  its lots. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                  onClick={(e) => {
                    e.preventDefault();
                    setConfirmDelete(false);
                    run(() => deleteInventoryItem(item.id));
                  }}
                  disabled={busy}
                >
                  Delete item
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function RestockForm({
  item,
  busy,
  locations,
  run,
}: {
  item: InventoryItem;
  busy: boolean;
  locations: InventoryLocation[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [qty, setQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiration, setExpiration] = useState("");
  // Default the restock destination to the onsite location (empty === server's
  // default onsite). Only shown when more than one location exists.
  const [locationId, setLocationId] = useState<string>("");
  const n = Number(qty);
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Restock</p>
      <div className="grid grid-cols-3 gap-1.5">
        <Input type="number" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="Lot #" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className="h-8 text-xs" />
        <Input type="date" placeholder="Exp" value={expiration} onChange={(e) => setExpiration(e.target.value)} className="h-8 text-xs" />
      </div>
      {locations.length > 1 && (
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="h-8 w-full text-xs rounded-md border border-border/60 bg-background px-2"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={String(loc.id)}>
              {loc.name}{loc.isOnsite ? " (onsite)" : ""}
            </option>
          ))}
        </select>
      )}
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
              locationId: locationId ? Number(locationId) : undefined,
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

function TransferForm({
  item,
  locations,
  busy,
  run,
}: {
  item: InventoryItem;
  locations: InventoryLocation[];
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const onsite = locations.find((l) => l.isOnsite);
  const offsite = locations.filter((l) => !l.isOnsite);
  // Default: move from the first offsite location into onsite (the common case
  // that resolves a transfer warning).
  const [fromId, setFromId] = useState<string>(String(offsite[0]?.id ?? ""));
  const [toId, setToId] = useState<string>(String(onsite?.id ?? ""));
  const [qty, setQty] = useState("");
  const n = Number(qty);
  // On-hand at the chosen source, so the user can't move more than is there.
  const sourceOnHand =
    item.byLocation.find((b) => String(b.locationId) === fromId)?.onHand ?? 0;
  const valid =
    n > 0 && fromId !== "" && toId !== "" && fromId !== toId && n <= sourceOnHand + 1e-6;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <ArrowRightLeft className="w-3 h-3" /> Transfer
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="h-8 w-full text-xs rounded-md border border-border/60 bg-background px-2"
        >
          <option value="">From…</option>
          {locations.map((loc) => (
            <option key={loc.id} value={String(loc.id)}>
              {loc.name}{loc.isOnsite ? " (onsite)" : ""}
            </option>
          ))}
        </select>
        <select
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          className="h-8 w-full text-xs rounded-md border border-border/60 bg-background px-2"
        >
          <option value="">To…</option>
          {locations.map((loc) => (
            <option key={loc.id} value={String(loc.id)}>
              {loc.name}{loc.isOnsite ? " (onsite)" : ""}
            </option>
          ))}
        </select>
      </div>
      <Input
        type="number"
        placeholder={`Qty (max ${fmtQty(sourceOnHand)})`}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="h-8 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 w-full text-xs"
        disabled={busy || !valid}
        onClick={() =>
          run(async () => {
            await transferInventory({
              itemId: item.id,
              fromLocationId: Number(fromId),
              toLocationId: Number(toId),
              qty: n,
            });
            setQty("");
          })
        }
      >
        <ArrowRightLeft className="w-3 h-3" /> Move stock
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

function LocationsCard({
  locations,
  onChanged,
}: {
  locations: InventoryLocation[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<InventoryLocation | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(
        e instanceof InventoryApiError && e.serverMessage
          ? e.serverMessage
          : e instanceof Error
            ? e.message
            : "Action failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-4 h-4" /> Locations
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} {open ? "Close" : "Manage"}
          </button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 space-y-2">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="space-y-1">
            {locations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2">
                {editId === loc.id ? (
                  <span className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 text-xs"
                    />
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={busy || !editName.trim()}
                      onClick={() =>
                        run(async () => {
                          await updateInventoryLocation(loc.id, { name: editName.trim() });
                          setEditId(null);
                        })
                      }
                    >
                      Save
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{loc.name}</span>
                    {loc.isOnsite && (
                      <span className="text-[10px] font-bold uppercase text-emerald-500 border border-emerald-500/50 rounded px-1 shrink-0">Onsite</span>
                    )}
                  </span>
                )}
                {editId !== loc.id && (
                  <span className="flex items-center gap-2 shrink-0">
                    {!loc.isOnsite && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => updateInventoryLocation(loc.id, { isOnsite: true }))}
                        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50"
                      >
                        Set onsite
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(loc.id);
                        setEditName(loc.name);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {!loc.isOnsite && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDeleteTarget(loc)}
                        className="text-red-500 hover:text-red-400 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              placeholder="New location name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8 px-3 text-xs shrink-0"
              disabled={busy || !newName.trim()}
              onClick={() =>
                run(async () => {
                  await createInventoryLocation({ name: newName.trim() });
                  setNewName("");
                })
              }
            >
              <Plus className="w-3 h-3" /> Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Production deducts only from the onsite location. Stock in other locations is warned about when it could be transferred in to cover the day's plan.
          </p>
        </CardContent>
      )}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={(e) => {
                e.preventDefault();
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) run(() => deleteInventoryLocation(target.id));
              }}
              disabled={busy}
            >
              Delete location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
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
// Render the image onto a canvas at the given max edge + JPEG quality and return
// the base64 payload (no data-URL prefix).
function encodeJpeg(img: HTMLImageElement, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
}

// Downscale/compress a chosen image to a JPEG and return its base64 payload,
// guaranteed (best-effort) to stay under the server's size cap. Starts at a
// sensible edge/quality and progressively shrinks dimensions and quality until
// the payload fits, so oversized originals are handled gracefully instead of
// being rejected with a 413 after the upload.
async function fileToBase64Jpeg(file: File, maxEdge = 1280): Promise<string> {
  // iPhones often hand the picker a HEIC/HEIF photo that most desktop browsers
  // can't decode via <img>/canvas. Transparently convert it to a JPEG Blob
  // first so intake just works; if conversion fails we fall through to the
  // <img> decode below, which surfaces the actionable HEIC guidance.
  let source: Blob = file;
  if (isHeicFile(file)) {
    try {
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      source = Array.isArray(converted) ? converted[0] : converted;
    } catch {
      // Conversion failed — leave `source` as the original so the <img> decode
      // below rejects with the clear HEIC_UNSUPPORTED_MESSAGE fallback.
      source = file;
    }
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(source);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    // HEIC/HEIF from iPhones can't be decoded by <img> in most desktop
    // browsers; if we get here the conversion above didn't succeed, so surface
    // actionable guidance instead of a cryptic failure.
    i.onerror = () =>
      reject(new Error(isHeicFile(file) ? HEIC_UNSUPPORTED_MESSAGE : "Failed to load image"));
    i.src = dataUrl;
  });

  // Each step reduces the max edge and/or quality. The last step is small
  // enough that essentially any image will fit under the cap.
  const steps: Array<{ edge: number; quality: number }> = [
    { edge: maxEdge, quality: 0.6 },
    { edge: maxEdge, quality: 0.45 },
    { edge: 1024, quality: 0.45 },
    { edge: 800, quality: 0.4 },
    { edge: 640, quality: 0.4 },
  ];

  let last = "";
  for (const { edge, quality } of steps) {
    last = encodeJpeg(img, edge, quality);
    if (!last) return dataUrl.split(",")[1] ?? "";
    if (last.length <= MAX_IMAGE_BASE64_CHARS) return last;
  }
  // Even the smallest step exceeded the cap (extremely unlikely): return it
  // anyway so the server can surface its own clear 413 message.
  return last;
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

// ── AI quality/defect photo check (read-only) ────────────────────────────────
// Photograph a finished pizza/crust and get a plain-language assessment to
// review. Nothing is ever auto-recorded; the user explicitly confirms an outcome
// which is written to shared facility memory so future checks are grounded in it.
const QUALITY_STATUS_META: Record<
  QualityStatus,
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  pass: { label: "Looks good", cls: "text-emerald-500 border-emerald-500/50", icon: CheckCircle2 },
  warn: { label: "Minor issues", cls: "text-amber-500 border-amber-500/50", icon: AlertTriangle },
  fail: { label: "Defects found", cls: "text-red-500 border-red-500/50", icon: AlertTriangle },
};

function QualityCheckCard() {
  const qc = useQueryClient();
  const lastImageRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [productType, setProductType] = useState<QualityProductType>("pizza");
  const [notes, setNotes] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [result, setResult] = useState<QualityCheckResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  async function analyze(imageBase64: string) {
    lastImageRef.current = imageBase64;
    setError(null);
    setResult(null);
    setConfirmed(false);
    setRetryIn(0);
    setAnalyzing(true);
    try {
      const res = await qualityCheckPhoto({
        imageBase64,
        mimeType: "image/jpeg",
        productType,
        notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (
        e instanceof InventoryApiError &&
        e.status === 429 &&
        e.retryAfterSec &&
        e.retryAfterSec > 0
      ) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function onPick(file: File | null) {
    if (!file) return;
    let imageBase64: string;
    setError(null);
    setPreparing(true);
    try {
      imageBase64 = await fileToBase64Jpeg(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read photo");
      return;
    } finally {
      setPreparing(false);
    }
    await analyze(imageBase64);
  }

  function retry() {
    if (lastImageRef.current) void analyze(lastImageRef.current);
  }

  // Record the reviewed outcome. This is the ONLY write — the assessment itself
  // is never auto-saved. Two things happen on confirm:
  //   1. A structured row is persisted into the browsable manager Quality
  //      History (date, product, verdict, confidence, issues, optional photo).
  //   2. A free-text fact is recorded into shared facility memory so future AI
  //      checks are grounded in it.
  async function confirmOutcome() {
    if (!result) return;
    const a = result.assessment;
    setConfirming(true);
    setError(null);
    try {
      const thumbnail = lastImageRef.current
        ? `data:image/jpeg;base64,${lastImageRef.current}`
        : undefined;
      await recordQualityCheck({
        productType,
        status: a.status,
        confidence: a.confidence,
        summary: a.summary,
        issues: a.issues,
        notes: notes.trim() || undefined,
        thumbnail,
      });
      qc.invalidateQueries({ queryKey: ["qualityChecks"] });

      // Best-effort: the structured record above is the source of truth, so a
      // facility-memory write failure must not undo a successful save.
      // Server-enforced closed-vocabulary template — no free text (e.g. the
      // AI summary/issue notes) may appear here. See CLIENT_WRITABLE_KNOWLEDGE
      // in artifacts/api-server/src/routes/aiMemory.ts.
      try {
        await saveFacilityKnowledge([
          {
            domain: "quality",
            key: `check:${productType}:${todayStr()}`,
            fact:
              `On ${todayStr()}, a ${productType} quality check was reviewed and confirmed as ` +
              `"${a.status}" (${Math.round(a.confidence * 100)}% confidence).`,
          },
        ]);
      } catch {
        // ignore — the history record persisted
      }
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save outcome");
    } finally {
      setConfirming(false);
    }
  }

  const meta = result ? QUALITY_STATUS_META[result.assessment.status] : null;

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> Quality Check
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}{" "}
            {open ? "Close" : "Check"}
          </button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Photograph a finished pizza or crust for an AI quality assessment. This is advisory
            only — nothing is recorded unless you review and confirm the outcome.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(["pizza", "crust", "other"] as QualityProductType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setProductType(t)}
                className={`h-8 rounded-md border text-xs font-semibold capitalize transition-colors ${
                  productType === t
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <Input
            placeholder="Optional context (e.g. expected 16in, light topping)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-8 text-xs"
          />
          <CameraFilePicker disabled={preparing || analyzing} onFiles={(files) => void onPick(files[0] ?? null)} />
          {(preparing || analyzing) && <p className="text-xs text-muted-foreground" role="status"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{preparing ? "Preparing photo…" : "Assessing…"}</p>}

          {error && (
            <div className="space-y-1.5">
              <p className="text-xs text-red-500">{error}</p>
              {lastImageRef.current && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full text-xs"
                  disabled={analyzing || retryIn > 0}
                  onClick={retry}
                >
                  <Loader2 className={`w-3.5 h-3.5 ${analyzing ? "animate-spin" : "hidden"}`} />
                  {retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                </Button>
              )}
            </div>
          )}

          {result && meta && (
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`flex items-center gap-1.5 text-[11px] font-bold uppercase border rounded px-1.5 py-0.5 ${meta.cls}`}
                >
                  <meta.icon className="w-3.5 h-3.5" /> {meta.label}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  {Math.round(result.assessment.confidence * 100)}% confidence
                </span>
              </div>
              {result.assessment.summary && (
                <p className="text-xs text-foreground/90">{result.assessment.summary}</p>
              )}
              {result.note && <p className="text-[11px] text-amber-500">{result.note}</p>}
              {result.assessment.issues.length > 0 && (
                <ul className="space-y-1">
                  {result.assessment.issues.map((iss, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                      <span
                        className={`font-bold uppercase shrink-0 ${
                          iss.severity === "critical"
                            ? "text-red-500"
                            : iss.severity === "major"
                              ? "text-amber-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {iss.type}
                      </span>
                      <span>{iss.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              {confirmed ? (
                <p className="text-xs text-emerald-500 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Outcome saved to facility memory.
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full text-xs"
                  disabled={confirming}
                  onClick={confirmOutcome}
                >
                  {confirming ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3 h-3" /> Confirm &amp; remember outcome
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── AI production-sheet photo → run transcription (read-only, advisory) ──────
// Photograph a paper run sheet; the AI transcribes the run rows it can read so
// staff can review them and re-enter the ones they want into the schedule.
// Nothing is written — this is purely a reading aid.
function ProductionSheetCard() {
  const lastImageRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [result, setResult] = useState<ProductionSheetPhotoResult | null>(null);

  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  async function analyze(imageBase64: string) {
    lastImageRef.current = imageBase64;
    setError(null);
    setResult(null);
    setRetryIn(0);
    setAnalyzing(true);
    try {
      const res = await productionSheetPhoto({
        imageBase64,
        mimeType: "image/jpeg",
        notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (
        e instanceof InventoryApiError &&
        e.status === 429 &&
        e.retryAfterSec &&
        e.retryAfterSec > 0
      ) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function onPick(file: File | null) {
    if (!file) return;
    let imageBase64: string;
    setError(null);
    setPreparing(true);
    try {
      imageBase64 = await fileToBase64Jpeg(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read photo");
      return;
    } finally {
      setPreparing(false);
    }
    await analyze(imageBase64);
  }

  function retry() {
    if (lastImageRef.current) void analyze(lastImageRef.current);
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> Read Run Sheet
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}{" "}
            {open ? "Close" : "Scan"}
          </button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Photograph a paper run sheet to transcribe its rows. This is advisory only — review the
            results and add the runs you want through the schedule yourself. Nothing is saved.
          </p>
          <Input
            placeholder="Optional context (e.g. Line 2 sheet, covers tomorrow)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-8 text-xs"
          />
          <CameraFilePicker disabled={preparing || analyzing} onFiles={(files) => void onPick(files[0] ?? null)} />
          {(preparing || analyzing) && <p className="text-xs text-muted-foreground" role="status"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{preparing ? "Preparing photo…" : "Reading sheet…"}</p>}

          {error && (
            <div className="space-y-1.5">
              <p className="text-xs text-red-500">{error}</p>
              {lastImageRef.current && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full text-xs"
                  disabled={analyzing || retryIn > 0}
                  onClick={retry}
                >
                  <Loader2 className={`w-3.5 h-3.5 ${analyzing ? "animate-spin" : "hidden"}`} />
                  {retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                </Button>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
              {result.note && <p className="text-[11px] text-amber-500">{result.note}</p>}
              {result.rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No run rows could be read.</p>
              ) : (
                <ul className="space-y-1.5">
                  {result.rows.map((r, i) => (
                    <li
                      key={i}
                      className="text-xs flex items-start justify-between gap-2 border-b border-border/30 last:border-0 pb-1.5 last:pb-0"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground/90">
                          {[r.brand, r.flavor].filter(Boolean).join(" ") || "—"}
                        </span>
                        <span className="text-muted-foreground">
                          {r.dieType ? ` · ${r.dieType}` : ""}
                          {r.casesNeeded ? ` · ${r.casesNeeded} cases` : ""}
                          {r.date ? ` · ${r.date}` : ""}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {Math.round(r.confidence * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── AI label / pallet verification (read-only, advisory) ─────────────────────
// Photograph a finished-product label or pallet placard and compare it against
// the expected brand/flavor/die/date/lot/case-count. The server recomputes the
// overall verdict from the per-field results; nothing is written.
const LABEL_VERDICT_META: Record<
  LabelVerdict,
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  pass: { label: "Pass", cls: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10", icon: CheckCircle2 },
  warn: { label: "Check", cls: "text-amber-500 border-amber-500/40 bg-amber-500/10", icon: AlertTriangle },
  fail: { label: "Mismatch", cls: "text-red-500 border-red-500/40 bg-red-500/10", icon: XCircle },
};
const LABEL_MATCH_META: Record<LabelFieldMatch, { cls: string; icon: typeof CheckCircle2 }> = {
  match: { cls: "text-emerald-500", icon: CheckCircle2 },
  mismatch: { cls: "text-red-500", icon: XCircle },
  unreadable: { cls: "text-muted-foreground", icon: AlertTriangle },
};
const LABEL_FIELD_LABELS: Record<string, string> = {
  brand: "Brand",
  flavor: "Flavor",
  dieType: "Die size",
  date: "Date",
  lotCode: "Lot code",
  caseCount: "Case count",
};

function LabelVerifyCard() {
  const lastImageRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [flavor, setFlavor] = useState("");
  const [dieType, setDieType] = useState("");
  const [date, setDate] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [caseCount, setCaseCount] = useState("");
  const [notes, setNotes] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [result, setResult] = useState<LabelVerifyResult | null>(null);

  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  function buildExpected(): LabelExpected {
    const exp: LabelExpected = {};
    if (brand.trim()) exp.brand = brand.trim();
    if (flavor.trim()) exp.flavor = flavor.trim();
    if (dieType.trim()) exp.dieType = dieType.trim();
    if (date.trim()) exp.date = date.trim();
    if (lotCode.trim()) exp.lotCode = lotCode.trim();
    const cc = Number(caseCount);
    if (caseCount.trim() && Number.isFinite(cc)) exp.caseCount = cc;
    return exp;
  }

  async function analyze(imageBase64: string) {
    lastImageRef.current = imageBase64;
    setError(null);
    setResult(null);
    setRetryIn(0);
    setAnalyzing(true);
    try {
      const res = await verifyLabelPhoto({
        imageBase64,
        mimeType: "image/jpeg",
        expected: buildExpected(),
        notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (
        e instanceof InventoryApiError &&
        e.status === 429 &&
        e.retryAfterSec &&
        e.retryAfterSec > 0
      ) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function onPick(file: File | null) {
    if (!file) return;
    let imageBase64: string;
    setError(null);
    setPreparing(true);
    try {
      imageBase64 = await fileToBase64Jpeg(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read photo");
      return;
    } finally {
      setPreparing(false);
    }
    await analyze(imageBase64);
  }

  function retry() {
    if (lastImageRef.current) void analyze(lastImageRef.current);
  }

  const meta = result ? LABEL_VERDICT_META[result.verdict] : null;

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Tag className="w-4 h-4" /> Verify Label
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}{" "}
            {open ? "Close" : "Verify"}
          </button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter what the label should say, then photograph it. The AI reads the label and flags
            any mismatch. Advisory only — nothing is recorded; you decide what to do.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Input placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="h-8 text-xs" />
            <Input placeholder="Flavor" value={flavor} onChange={(e) => setFlavor(e.target.value)} className="h-8 text-xs" />
            <Input placeholder="Die size" value={dieType} onChange={(e) => setDieType(e.target.value)} className="h-8 text-xs" />
            <Input placeholder="Date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
            <Input placeholder="Lot code" value={lotCode} onChange={(e) => setLotCode(e.target.value)} className="h-8 text-xs" />
            <Input placeholder="Case count" inputMode="numeric" value={caseCount} onChange={(e) => setCaseCount(e.target.value)} className="h-8 text-xs" />
          </div>
          <Input
            placeholder="Optional context"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-8 text-xs"
          />
          <CameraFilePicker disabled={preparing || analyzing} onFiles={(files) => void onPick(files[0] ?? null)} />
          {(preparing || analyzing) && <p className="text-xs text-muted-foreground" role="status"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{preparing ? "Preparing photo…" : "Verifying…"}</p>}

          {error && (
            <div className="space-y-1.5">
              <p className="text-xs text-red-500">{error}</p>
              {lastImageRef.current && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full text-xs"
                  disabled={analyzing || retryIn > 0}
                  onClick={retry}
                >
                  <Loader2 className={`w-3.5 h-3.5 ${analyzing ? "animate-spin" : "hidden"}`} />
                  {retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                </Button>
              )}
            </div>
          )}

          {result && meta && (
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`flex items-center gap-1.5 text-[11px] font-bold uppercase border rounded px-1.5 py-0.5 ${meta.cls}`}
                >
                  <meta.icon className="w-3.5 h-3.5" /> {meta.label}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  {Math.round(result.confidence * 100)}% confidence
                </span>
              </div>
              {result.summary && <p className="text-xs text-foreground/90">{result.summary}</p>}
              {result.note && <p className="text-[11px] text-amber-500">{result.note}</p>}
              <ul className="space-y-1">
                {result.fields
                  .filter((f) => f.expected != null)
                  .map((f) => {
                    const fm = LABEL_MATCH_META[f.match];
                    return (
                      <li key={f.field} className="text-[11px] flex items-center gap-1.5">
                        <fm.icon className={`w-3.5 h-3.5 shrink-0 ${fm.cls}`} />
                        <span className="font-semibold text-muted-foreground w-16 shrink-0">
                          {LABEL_FIELD_LABELS[f.field] ?? f.field}
                        </span>
                        <span className="text-foreground/80 truncate">
                          {f.expected}
                          {f.match === "mismatch" && f.observed ? (
                            <span className="text-red-500"> → saw “{f.observed}”</span>
                          ) : f.match === "unreadable" ? (
                            <span className="text-muted-foreground"> → not readable</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── AI expiry & waste insight ────────────────────────────────────────────────
// The server flags expired/expiring-soon stock and (when anything is at risk)
// suggests a run order to consume it first. Advisory only — nothing is changed.
function WasteInsightCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [result, setResult] = useState<WasteInsightResult | null>(null);

  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  async function run() {
    setError(null);
    setRetryIn(0);
    setLoading(true);
    try {
      const res = await wasteInsight({});
      setResult(res);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (
        e instanceof InventoryApiError &&
        e.status === 429 &&
        e.retryAfterSec &&
        e.retryAfterSec > 0
      ) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Recycle className="w-4 h-4" /> Waste Insight
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}{" "}
            {open ? "Close" : "Open"}
          </button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Flag stock that's expired or expiring soon and get an AI suggestion for which runs to
            prioritize so it gets used first. Advisory only — nothing is rescheduled.
          </p>
          <Button
            size="sm"
            className="h-9 w-full text-sm"
            disabled={loading || retryIn > 0}
            onClick={run}
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
              </>
            ) : retryIn > 0 ? (
              `Try again in ${retryIn}s`
            ) : (
              <>
                <Recycle className="w-3.5 h-3.5" /> Check expiring stock
              </>
            )}
          </Button>

          {error && <p className="text-xs text-red-500">{error}</p>}

          {result && (
            <div className="space-y-2">
              {result.flagged.length === 0 ? (
                <p className="text-xs text-emerald-500 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Nothing is expired or expiring soon.
                </p>
              ) : (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    At risk ({result.flagged.length})
                  </p>
                  <div className="space-y-1">
                    {result.flagged.map((f) => (
                      <div
                        key={f.key}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-[10px] font-bold uppercase border rounded px-1 shrink-0 ${
                              f.status === "expired"
                                ? "text-red-500 border-red-500/50"
                                : "text-amber-500 border-amber-500/50"
                            }`}
                          >
                            {f.status}
                          </span>
                          <span className="text-xs truncate">{f.name}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {f.daysUntilExpiry == null
                            ? "—"
                            : f.daysUntilExpiry < 0
                              ? `${Math.abs(f.daysUntilExpiry)}d ago`
                              : `${f.daysUntilExpiry}d`}
                          {" · "}
                          {fmtQty(f.qtyAtRisk)} {f.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                  {result.suggestion && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Suggested run order
                      </p>
                      <p className="text-xs text-foreground/90 whitespace-pre-wrap">
                        {result.suggestion}
                      </p>
                    </div>
                  )}
                  {result.note && <p className="text-[11px] text-amber-500">{result.note}</p>}
                </>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PhotoIntakeCard({
  candidates,
  locations,
  onCommitted,
}: {
  candidates: CandidateItem[];
  locations: InventoryLocation[];
  onCommitted: () => void;
}) {
  // Destination location for all confirmed rows (empty === server default
  // onsite). Only shown when more than one location exists, mirroring the
  // manual RestockForm picker.
  const [locationId, setLocationId] = useState<string>("");
  const lastImageRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [noResults, setNoResults] = useState(false);
  const [committingId, setCommittingId] = useState<string | null>(null);
  // Server-persisted learned photo aliases (guessName -> itemKey), factory-wide.
  // Fetched once on mount; best-effort, so any failure leaves the list empty.
  const [photoAliases, setPhotoAliases] = useState<PhotoAlias[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPhotoAliases()
      .then((a) => {
        if (!cancelled) setPhotoAliases(a);
      })
      .catch(() => {
        /* best-effort: proceed without learned aliases */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Count down the rate-limit (429) cooldown so the retry button re-enables
  // exactly when the server will accept another request.
  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const candByKey = useMemo(() => {
    const m = new Map<string, CandidateItem>();
    for (const c of candidates) m.set(c.key, c);
    return m;
  }, [candidates]);

  function toRows(guesses: PhotoGuess[]): ReviewRow[] {
    return guesses.map((g, i) => {
      // Prefer the server's match; otherwise fall back to a learned alias for
      // this guess name (only if that item still exists among candidates).
      const learnedKey = g.matchedKey
        ? null
        : applyPhotoAliases(g.name, photoAliases, candidates);
      const effectiveKey = g.matchedKey ?? learnedKey;
      const matched = effectiveKey ? candByKey.get(effectiveKey) : undefined;
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

  async function analyze(imageBase64: string) {
    lastImageRef.current = imageBase64;
    setError(null);
    setNoResults(false);
    setRetryIn(0);
    setAnalyzing(true);
    try {
      const { items } = await identifyInventoryPhoto({
        imageBase64,
        mimeType: "image/jpeg",
        candidates,
      });
      const next = toRows(items);
      setRows(next);
      setNoResults(next.length === 0);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (e instanceof InventoryApiError && e.status === 429 && e.retryAfterSec && e.retryAfterSec > 0) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  // Analyze several photos in ONE intake: each image is its own AI call (run
  // sequentially to respect the endpoint's cost/rate guards) and the identified
  // rows are ACCUMULATED into the review list rather than clobbering it, so the
  // user confirms one combined list. Mirrors the mobile multi-image picker.
  async function analyzeMany(images: string[]) {
    lastImageRef.current = images[images.length - 1] ?? null;
    setError(null);
    setNoResults(false);
    setRetryIn(0);
    setAnalyzing(true);
    setAnalyzeProgress({ done: 0, total: images.length });
    let any = false;
    try {
      for (let i = 0; i < images.length; i++) {
        try {
          const { items } = await identifyInventoryPhoto({
            imageBase64: images[i],
            mimeType: "image/jpeg",
            candidates,
          });
          const next = toRows(items);
          if (next.length) {
            any = true;
            setRows((rs) => [...rs, ...next]);
          }
        } catch (e) {
          // Surface the error but keep going so one bad photo doesn't sink the batch.
          setError(photoErrorMessage(e));
          if (e instanceof InventoryApiError && e.status === 429 && e.retryAfterSec && e.retryAfterSec > 0) {
            setRetryIn(e.retryAfterSec);
            break; // rate-limited: stop hammering the endpoint
          }
        } finally {
          setAnalyzeProgress({ done: i + 1, total: images.length });
        }
      }
      setNoResults(!any);
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  async function onPick(files: File[]) {
    if (files.length === 0) return;
    let images: string[];
    setError(null);
    setPreparing(true);
    try {
      // Convert each file independently so one unreadable photo doesn't sink the
      // whole batch — keep the ones that succeed.
      const settled = await Promise.all(
        files.map((f) => fileToBase64Jpeg(f).catch(() => null)),
      );
      images = settled.filter((b): b is string => !!b);
    } finally {
      setPreparing(false);
    }
    if (images.length === 0) {
      setError("Failed to read photo");
      return;
    }
    if (images.length === 1) await analyze(images[0]);
    else await analyzeMany(images);
  }

  // Re-run analysis on the last picked image without re-opening the picker.
  function retry() {
    if (lastImageRef.current) void analyze(lastImageRef.current);
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
        locationId: locationId ? Number(locationId) : undefined,
      });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      // Remember the guessName -> matched item link so future scans auto-apply
      // it. Only when matched to an existing item and the guess differs from the
      // item name (skip trivial self-references, like the import-alias path).
      if (
        row.matchedKey &&
        row.guessName.trim() &&
        row.guessName.trim().toLowerCase() !== name.toLowerCase()
      ) {
        const alias: PhotoAlias = { guessName: row.guessName.trim(), itemKey: row.matchedKey };
        setPhotoAliases((prev) => {
          const others = prev.filter(
            (a) => a.guessName.trim().toLowerCase() !== alias.guessName.toLowerCase(),
          );
          return [...others, alias];
        });
        void savePhotoAliases([alias]).catch(() => {
          /* best-effort */
        });
      }
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
          <CameraFilePicker multiple disabled={preparing || analyzing} onFiles={(files) => void onPick(files)} />
          <BarcodeScanner
            disabled={preparing || analyzing}
            onDetected={(value) => {
              setRows((rs) => [...rs, {
                id: `${Date.now()}-barcode`,
                guessName: value,
                name: value,
                qty: "1",
                unit: "units",
                category: "packaging",
                matchedKey: null,
                confidence: 1,
                lotNumber: "",
                expiration: "",
              }]);
              setError(null);
            }}
          />
          {(preparing || analyzing) && <p className="text-xs text-muted-foreground" role="status"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{preparing ? "Preparing photos…" : analyzeProgress && analyzeProgress.total > 1 ? `Analyzing photo ${Math.min(analyzeProgress.done + 1, analyzeProgress.total)} of ${analyzeProgress.total}…` : "Analyzing…"}</p>}

          {error && (
            <div className="space-y-1.5">
              <p className="text-xs text-red-500">{error}</p>
              {lastImageRef.current && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full text-xs"
                  disabled={analyzing || retryIn > 0}
                  onClick={retry}
                >
                  <Loader2 className={`w-3.5 h-3.5 ${analyzing ? "animate-spin" : "hidden"}`} />
                  {retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                </Button>
              )}
            </div>
          )}
          {noResults && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Couldn't identify any items. Try a clearer photo, or add stock manually above.
              </p>
              <p className="text-xs text-muted-foreground">Use Take photo above to retake it, or upload a clearer image.</p>
            </div>
          )}

          {rows.length > 0 && locations.length > 1 && (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Destination location</span>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-0.5 w-full h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={String(loc.id)}>
                    {loc.name}{loc.isOnsite ? " (onsite)" : ""}
                  </option>
                ))}
              </select>
            </label>
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
