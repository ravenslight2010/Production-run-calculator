import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { specImportRecipeDisplayKind } from "@/storage";
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

type InventoryLoad =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: InventoryItem[] }
  | { status: "unavailable"; message: string };

const classifyRecipe = (recipe: ParsedSpecImport["recipes"][number]) =>
  specImportRecipeDisplayKind(recipe);

function formatQuantity(value: number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function stockSummary(
  line: RunLine,
  plannedCases: number | null,
  inventory: InventoryLoad,
): string {
  if (inventory.status === "idle" || inventory.status === "loading") return "Checking stock…";
  if (inventory.status === "unavailable") return "Stock level unavailable";
  const stock = inventory.items.find((item) => item.key === line.key);
  if (!stock) return "Not tracked in Inventory";
  if (!Number.isFinite(Number(stock.onHand))) return "Stock level unavailable";
  if (plannedCases === null) {
    return `${formatQuantity(stock.onHand)} ${line.unit} on hand · shortage not estimated without a planned case count`;
  }
  const shortage = Math.max(0, line.qty - stock.onHand);
  return shortage > 1e-6
    ? `Short by ${formatQuantity(shortage)} ${line.unit} · ${formatQuantity(stock.onHand)} on hand`
    : `${formatQuantity(stock.onHand)} ${line.unit} on hand · covers this product's projected demand`;
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
  const [inventory, setInventory] = useState<InventoryLoad>({ status: "idle" });

  useEffect(() => {
    if (!visible || !projections.some((projection) => projection.status === "ready")) return;
    let active = true;
    setInventory({ status: "loading" });
    // This is deliberately the inventory GET helper. The preview does not
    // call any adjustment, restock, transfer, or consumption operation.
    void fetchInventory()
      .then((items) => {
        if (active) setInventory({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setInventory({
          status: "unavailable",
          message: error instanceof Error ? error.message : "Inventory data could not be loaded.",
        });
      });
    return () => {
      active = false;
    };
  }, [visible, projections]);

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
        {inventory.status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading stock" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only ingredient and packaging demand for every included product. A planned case count
        is used only for the matching selected run; otherwise demand is shown per case and no
        shortage is estimated. This preview does not reserve or change stock.
      </p>

      {inventory.status === "unavailable" && projections.some((projection) => projection.status === "ready") && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700" data-testid="spec-import-stock-data-unavailable">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Stock levels are unavailable, so shortages cannot be confirmed. {inventory.message}
        </p>
      )}

      {projections.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="spec-import-stock-impact-empty">
          No included products to project.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto" data-testid="spec-import-stock-impact-products">
          {projections.map((projection, index) => {
            const lines = projection.status === "ready" ? computeRunLines(projection.values) : [];
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
                          {stockSummary(line, projection.plannedCases, inventory)}
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
