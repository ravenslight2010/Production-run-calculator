import { useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchInventory,
  fetchInventoryLocations,
  fetchInventorySettings,
  inventoryClientId,
  computeRunUseFirstList,
  EXPIRY_SOON_DAYS,
  type InventoryItem,
  type InventoryLocation,
  type UseFirstEntry,
} from "../inventoryShared";
import type { FormValues } from "../types";

// Format a "YYYY-MM-DD" lot expiration date for display (e.g. "Jun 24"). Parsed
// as a local calendar date (split, not new Date(str)) so it never shifts a day
// across time zones.
function formatExpiry(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Advisory "Use First" card for the Warehouse tab. Self-contained: it fetches
// current inventory + storage locations + the expiry settings (and refreshes on
// the inventory SSE stream, exactly like InventoryTab) so warehouse staff don't
// have to open the inventory editor.
//
// Lists the stock lots expiring within the configured "expiring soon" window
// (plus any already past), ordered first-expired-first-out, with the lots used
// by today's runs surfaced to the top. All the windowing/ordering math lives in
// @workspace/inventory-math via the shared computeRunUseFirstList wrapper, so
// this card and the mobile one list identically (replit.md parity). Read-only —
// it never writes stock. Hidden entirely when nothing is at risk.
export default function UseFirstCard({
  todayValsList = [],
}: {
  todayValsList?: FormValues[];
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [soonDays, setSoonDays] = useState<number>(EXPIRY_SOON_DAYS);
  const refetchRef = useRef<() => void>(() => {});

  async function load() {
    try {
      const [inv, locs, settings] = await Promise.all([
        fetchInventory(),
        fetchInventoryLocations(),
        fetchInventorySettings(),
      ]);
      setItems(inv);
      setLocations(locs);
      setSoonDays(settings.expirySoonDays);
    } catch {
      /* leave state as-is; card simply hides if nothing is loaded */
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

  const useFirst: UseFirstEntry[] = computeRunUseFirstList(
    items,
    locations,
    soonDays,
    todayValsList,
  );
  if (useFirst.length === 0) return null;

  return (
    <Card
      className="bg-rose-950/30 border-rose-700/40 shadow-md mb-4"
      data-testid="use-first-card"
    >
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4" /> Use First
          <span className="ml-1 font-normal normal-case text-xs text-rose-400/80">
            ({useFirst.length} lot{useFirst.length !== 1 ? "s" : ""} expiring)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {useFirst.map((it, i) => (
          <div
            key={`${it.key}-${it.locationId ?? "onsite"}-${it.expirationDate ?? "none"}-${i}`}
            className="flex items-baseline justify-between gap-2 text-sm"
            data-testid={`use-first-${it.key}`}
          >
            <span className="text-rose-200/90 truncate">
              {it.usedToday && (
                <span className="mr-1.5 align-middle rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-100">
                  Today
                </span>
              )}
              {it.name}
              <span className="ml-1.5 text-[11px] text-rose-400/70">
                {it.locationName}
              </span>
            </span>
            <span className="whitespace-nowrap text-right">
              <span className="font-bold tabular-nums text-rose-50">
                {it.qtyRemaining}{" "}
                <span className="font-normal text-rose-300/80">{it.unit}</span>
              </span>
              <span
                className={`ml-2 text-[11px] tabular-nums ${
                  it.expired ? "font-semibold text-rose-300" : "text-rose-400/80"
                }`}
              >
                {it.expirationDate ? formatExpiry(it.expirationDate) : "—"}
                {" · "}
                {it.expired
                  ? `expired ${-it.daysUntilExpiry}d ago`
                  : it.daysUntilExpiry === 0
                    ? "expires today"
                    : `${it.daysUntilExpiry}d left`}
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
