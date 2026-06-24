import { useEffect, useRef, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchInventory,
  inventoryClientId,
  computeRunReorderList,
  type InventoryItem,
  type ReorderItem,
} from "../inventoryShared";
import type { FormValues } from "../types";

// Advisory "Reorder Now" card for the Warehouse tab. Self-contained: it fetches
// current inventory (and refreshes on the inventory SSE stream, exactly like
// InventoryTab) so warehouse staff don't have to open the inventory editor.
//
// Items are flagged when their cross-location on-hand has dropped to/below their
// reorder threshold once upcoming scheduled-run demand is subtracted. All the
// matching + suggested-quantity math lives in @workspace/inventory-math via the
// shared computeRunReorderList wrapper, so this card and the mobile one flag
// identically (replit.md parity). Read-only — it never writes stock.
export default function ReorderCard({
  scheduledValsList = [],
}: {
  scheduledValsList?: FormValues[];
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const refetchRef = useRef<() => void>(() => {});

  async function load() {
    try {
      setItems(await fetchInventory());
    } catch {
      /* leave items as-is; card simply hides if nothing is loaded */
    }
  }
  refetchRef.current = load;

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

  const reorder: ReorderItem[] = computeRunReorderList(items, scheduledValsList);
  if (reorder.length === 0) return null;

  return (
    <Card
      className="bg-amber-950/30 border-amber-700/40 shadow-md mb-4"
      data-testid="reorder-card"
    >
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
          <ShoppingCart className="w-4 h-4" /> Reorder Now
          <span className="ml-1 font-normal normal-case text-xs text-amber-400/80">
            ({reorder.length} item{reorder.length !== 1 ? "s" : ""} low)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {reorder.map((it) => (
          <div
            key={it.key}
            className="flex items-baseline justify-between gap-2 text-sm"
            data-testid={`reorder-${it.key}`}
          >
            <span className="text-amber-200/90 truncate">
              {it.name}
              <span className="ml-1.5 text-[11px] text-amber-400/70">
                {it.onHand} on hand · reorder at {it.reorderThreshold}
              </span>
            </span>
            <span className="font-bold tabular-nums whitespace-nowrap text-amber-50">
              order {it.suggestedQty}{" "}
              <span className="font-normal text-amber-300/80">{it.unit}</span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
