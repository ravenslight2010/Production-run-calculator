import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { specImportRecipeDisplayKind } from "@/storage";
import {
  computeRunDemandImpact,
  fetchInventory,
  type InventoryItem,
} from "@/inventoryShared";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { SpecImportImpactRun } from "@/specImportInventoryImpact";
import { projectSpecImportForRun } from "@/specImportInventoryImpact";

type Props = {
  visible: boolean;
  parsed: ParsedSpecImport;
  run: SpecImportImpactRun | null;
  forceUpdateProfileKeys: ReadonlySet<string>;
};

type InventoryLoad =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: InventoryItem[] }
  | { status: "unavailable"; message: string };

const classifyRecipe = (recipe: ParsedSpecImport["recipes"][number]) =>
  specImportRecipeDisplayKind(recipe);

function formatQuantity(value: number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function SpecImportInventoryImpact({
  visible,
  parsed,
  run,
  forceUpdateProfileKeys,
}: Props) {
  const projection = useMemo(
    () => projectSpecImportForRun(run, parsed, forceUpdateProfileKeys, classifyRecipe),
    [run, parsed, forceUpdateProfileKeys],
  );
  const [inventory, setInventory] = useState<InventoryLoad>({ status: "idle" });

  useEffect(() => {
    if (!visible || projection.status !== "ready") return;
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
  }, [visible, projection.status]);

  if (!visible) return null;

  const unavailableReason =
    projection.status === "unavailable" ? projection.reason : null;
  const impact = projection.status === "ready" && run
    ? computeRunDemandImpact(
        run.values,
        projection.values,
        inventory.status === "ready" ? inventory.items : null,
      )
    : [];

  return (
    <section
      className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
      data-testid="spec-import-stock-impact"
      aria-labelledby="spec-import-stock-impact-title"
    >
      <div className="flex items-center gap-2">
        <h3 id="spec-import-stock-impact-title" className="text-sm font-semibold text-foreground">
          Projected stock impact
        </h3>
        {inventory.status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading stock" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only estimate for the selected run: demand before and after these reviewed changes.
        Other products in the workbook are not included. It does not reserve or change stock.
      </p>

      {unavailableReason ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700" data-testid="spec-import-stock-impact-unavailable">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {unavailableReason}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {projection.status === "ready"
              ? `${projection.profileLabel} · ${formatQuantity(run?.values.casesNeeded ?? 0)} planned cases`
              : ""}
          </p>
          {inventory.status === "unavailable" && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700" data-testid="spec-import-stock-data-unavailable">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Stock levels are unavailable, so shortages cannot be confirmed. {inventory.message}
            </p>
          )}
          {impact.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="spec-import-stock-impact-empty">
              No ingredient or packaging demand changes for this run.
            </p>
          ) : (
            <ul className="max-h-44 space-y-1.5 overflow-y-auto" data-testid="spec-import-stock-impact-lines">
              {impact.map((line) => (
                <li key={line.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{line.name}</span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {formatQuantity(line.beforeQty)} → {formatQuantity(line.afterQty)} {line.unit}
                    <span className={line.deltaQty > 0 ? "ml-1 text-amber-700" : "ml-1 text-emerald-700"}>
                      ({line.deltaQty > 0 ? "+" : ""}{formatQuantity(line.deltaQty)})
                    </span>
                  </span>
                  <span className="basis-full text-right text-[11px] text-muted-foreground">
                    {inventory.status === "loading" || inventory.status === "idle"
                      ? "Checking stock…"
                      : line.stockStatus === "unavailable"
                        ? "Stock level unavailable"
                        : line.stockStatus === "untracked"
                          ? "Not tracked in Inventory"
                          : line.stockStatus === "short"
                            ? `Short by ${formatQuantity(line.shortage ?? 0)} ${line.unit} · ${formatQuantity(line.onHand ?? 0)} on hand`
                            : `${formatQuantity(line.onHand ?? 0)} ${line.unit} on hand · covers projected demand`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
