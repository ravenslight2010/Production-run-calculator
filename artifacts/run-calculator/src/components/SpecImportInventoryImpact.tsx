import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { specImportRecipeDisplayKind } from "@/storage";
import {
  aggregateInventoryDemandForPlannedProducts,
  type AggregatedProductInventoryDemand,
} from "@workspace/inventory-math";
import {
  computeRunLines,
  fetchInventory,
  type InventoryItem,
  type RunLine,
} from "@/inventoryShared";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { SpecImportImpactRun } from "@/specImportInventoryImpact";
import { projectSpecImportForIncludedProducts } from "@/specImportInventoryImpact";

type Props = {
  visible: boolean;
  parsed: ParsedSpecImport;
  run: SpecImportImpactRun | null;
  forceUpdateProfileKeys: ReadonlySet<string>;
};

type InventorySnapshot = {
  items: InventoryItem[];
  loadedAt: number;
};

const INVENTORY_REQUEST_TIMEOUT_MS = 15_000;
const INVENTORY_REFRESH_INTERVAL_MS = 60_000;

const classifyRecipe = (recipe: ParsedSpecImport["recipes"][number]) =>
  specImportRecipeDisplayKind(recipe);

function formatQuantity(value: number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSnapshotTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function inventoryErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Inventory data could not be loaded.";
}

function stockSummary(
  line: RunLine,
  plannedCases: number | null,
  combinedDemand: AggregatedProductInventoryDemand | undefined,
  snapshot: InventorySnapshot | null,
  loading: boolean,
): string {
  if (!snapshot && loading) return "Checking stock…";
  if (!snapshot) return "Stock level unavailable";
  const stock = snapshot.items.find((item) => item.key === line.key);
  if (!stock) return "Not tracked in Inventory";
  if (!Number.isFinite(Number(stock.onHand))) return "Stock level unavailable";
  if (plannedCases === null) {
    return `${formatQuantity(stock.onHand)} ${line.unit} on hand · shortage not estimated without a planned case count`;
  }
  if (!combinedDemand || !Number.isFinite(combinedDemand.qty)) return "Stock level unavailable";
  const shortage = Math.max(0, combinedDemand.qty - stock.onHand);
  const productScope = combinedDemand.productCount > 1
    ? ` across ${combinedDemand.productCount} planned products`
    : " for this product";
  return shortage > 1e-6
    ? `Combined planned demand: ${formatQuantity(combinedDemand.qty)} ${line.unit}${productScope} · Short by ${formatQuantity(shortage)} ${line.unit} · ${formatQuantity(stock.onHand)} ${line.unit} on hand`
    : `Combined planned demand: ${formatQuantity(combinedDemand.qty)} ${line.unit}${productScope} · ${formatQuantity(stock.onHand)} ${line.unit} on hand covers demand`;
}

export function SpecImportInventoryImpact({
  visible,
  parsed,
  run,
  forceUpdateProfileKeys,
}: Props) {
  const projections = useMemo(
    () => projectSpecImportForIncludedProducts(run, parsed, forceUpdateProfileKeys, classifyRecipe),
    [run, parsed, forceUpdateProfileKeys],
  );
  const productLines = useMemo(
    () => projections.map((projection) =>
      projection.status === "ready" ? computeRunLines(projection.values) : [],
    ),
    [projections],
  );
  const plannedDemandByKey = useMemo(
    () => new Map(
      aggregateInventoryDemandForPlannedProducts(
        projections.map((projection, index) => ({
          lines: productLines[index] ?? [],
          plannedCases: projection.plannedCases,
        })),
      ).map((line) => [line.key, line]),
    ),
    [projections, productLines],
  );
  const hasReadyProjection = projections.some((projection) => projection.status === "ready");
  const [inventorySnapshot, setInventorySnapshot] = useState<InventorySnapshot | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const inventoryRequestRef = useRef<Promise<void> | null>(null);

  const refreshInventory = useCallback((): Promise<void> => {
    if (inventoryRequestRef.current) return inventoryRequestRef.current;

    setInventoryLoading(true);
    setInventoryError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      INVENTORY_REQUEST_TIMEOUT_MS,
    );
    const request = fetchInventory(controller.signal)
      .then((items) => {
        setInventorySnapshot({ items, loadedAt: Date.now() });
      })
      .catch((error: unknown) => {
        setInventoryError(
          controller.signal.aborted
            ? "The stock request timed out. Try refreshing again."
            : inventoryErrorMessage(error),
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        inventoryRequestRef.current = null;
        setInventoryLoading(false);
      });
    inventoryRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!visible || !hasReadyProjection) return;
    // This is deliberately the inventory GET helper. The preview does not
    // call any adjustment, restock, transfer, or consumption operation.
    void refreshInventory();
    const intervalId = window.setInterval(
      () => void refreshInventory(),
      INVENTORY_REFRESH_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(intervalId);
    };
  }, [visible, hasReadyProjection, refreshInventory]);

  if (!visible) return null;

  return (
    <section
      className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
      data-testid="spec-import-stock-impact"
      aria-labelledby="spec-import-stock-impact-title"
    >
      <div className="flex items-center gap-2">
        <h3 id="spec-import-stock-impact-title" className="text-sm font-semibold text-foreground">
          Projected stock impact by included product
        </h3>
        {inventoryLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading stock" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only ingredient and packaging demand for every included product. A planned case count
        is used only for the matching selected run; otherwise demand is shown per case and no
        shortage is estimated. This preview does not reserve or change stock.
      </p>

      {hasReadyProjection && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground" data-testid="status-stock-snapshot">
              {inventorySnapshot
                ? `Stock snapshot last loaded ${formatSnapshotTime(inventorySnapshot.loadedAt)}.`
                : "Stock snapshot has not loaded yet."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refreshInventory()}
              disabled={inventoryLoading}
              data-testid="button-refresh-stock"
              aria-label="Refresh stock levels"
            >
              {inventoryLoading
                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              {inventoryLoading ? "Refreshing…" : "Refresh stock"}
            </Button>
          </div>
          {inventoryError && (
            <p
              className="flex items-start gap-1.5 text-xs text-amber-700"
              data-testid={inventorySnapshot
                ? "spec-import-stock-refresh-error"
                : "spec-import-stock-data-unavailable"}
              role="status"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {inventorySnapshot
                ? `Stock refresh failed. Showing the last successful snapshot. ${inventoryError}`
                : `Stock levels are unavailable, so shortages cannot be confirmed. ${inventoryError}`}
            </p>
          )}
        </>
      )}

      {projections.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="spec-import-stock-impact-empty">
          No included products to project.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto" data-testid="spec-import-stock-impact-products">
          {projections.map((projection, index) => {
            const lines = productLines[index] ?? [];
            return (
              <li
                key={`${projection.profileLabel}-${index}`}
                className="rounded border border-border/70 bg-background/60 p-2"
                data-testid="spec-import-stock-impact-product"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-xs font-semibold text-foreground">{projection.profileLabel}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {projection.plannedCases === null
                      ? projection.status === "ready"
                        ? "Per case · no planned case count"
                        : "No planned case count"
                      : `${formatQuantity(projection.plannedCases)} planned case${projection.plannedCases === 1 ? "" : "s"}`}
                  </span>
                </div>
                {projection.status === "unavailable" ? (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700" data-testid="spec-import-stock-impact-unavailable">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {projection.reason}
                  </p>
                ) : lines.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="spec-import-stock-impact-empty">
                    No ingredient or packaging demand could be derived from this product's reviewed values.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {lines.map((line) => (
                      <li key={line.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{line.name}</span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {formatQuantity(line.qty)} {line.unit}
                        </span>
                        <span className="basis-full text-right text-[11px] text-muted-foreground">
                          {stockSummary(
                            line,
                            projection.plannedCases,
                            plannedDemandByKey.get(line.key),
                            inventorySnapshot,
                            inventoryLoading,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
