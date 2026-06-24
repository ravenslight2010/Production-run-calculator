import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import {
  fetchInventory,
  fetchInventoryLocations,
  fetchInventorySettings,
  openInventoryStream,
  computeRunUseFirstList,
  EXPIRY_SOON_DAYS,
  type InventoryItem,
  type InventoryLocation,
  type UseFirstEntry,
} from "@/context/inventoryShared";
import { getOrCreateClientId } from "@/context/sync/client";
import type { RunSettings } from "@/context/RunContext";

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

// Advisory "Use First" card for the Warehouse screen. Self-contained: it fetches
// current inventory + storage locations + the expiry settings (and refreshes on
// the inventory SSE stream, exactly like the Inventory screen) so warehouse
// staff don't have to open the editor.
//
// Lists the stock lots expiring within the configured "expiring soon" window
// (plus any already past), ordered first-expired-first-out, with the lots used
// by today's runs surfaced to the top. All the windowing/ordering math lives in
// @workspace/inventory-math via the shared computeRunUseFirstList wrapper, so
// this card and the web one list identically (replit.md parity). Read-only — it
// never writes stock. Hidden entirely when nothing is at risk.
export default function UseFirstCard({
  todaySettingsList = [],
}: {
  todaySettingsList?: RunSettings[];
}) {
  const colors = useColors();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [soonDays, setSoonDays] = useState<number>(EXPIRY_SOON_DAYS);
  const refetchRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
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
  }, []);
  refetchRef.current = load;

  useEffect(() => {
    let stream: { close: () => void } | null = null;
    let cancelled = false;
    load();
    (async () => {
      const clientId = await getOrCreateClientId();
      if (cancelled) return;
      stream = openInventoryStream(clientId, (senderId) => {
        if (senderId !== clientId) refetchRef.current();
      });
    })();
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [load]);

  const useFirst: UseFirstEntry[] = computeRunUseFirstList(
    items,
    locations,
    soonDays,
    todaySettingsList,
  );
  if (useFirst.length === 0) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="time-outline" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary }]}>USE FIRST</Text>
        <Text style={[styles.count, { color: colors.mutedForeground }]}>
          ({useFirst.length} lot{useFirst.length !== 1 ? "s" : ""} expiring)
        </Text>
      </View>
      <View style={styles.list}>
        {useFirst.map((it, i) => (
          <View
            key={`${it.key}-${it.locationId ?? "onsite"}-${it.expirationDate ?? "none"}-${i}`}
            style={styles.row}
          >
            <View style={styles.left}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {it.usedToday ? (
                  <Text style={[styles.todayTag, { color: colors.primary }]}>★ </Text>
                ) : null}
                {it.name}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {it.locationName}
              </Text>
            </View>
            <View style={styles.right}>
              <Text style={[styles.qty, { color: colors.foreground }]} numberOfLines={1}>
                {it.qtyRemaining}{" "}
                <Text style={[styles.qtyUnit, { color: colors.mutedForeground }]}>{it.unit}</Text>
              </Text>
              <Text
                style={[
                  styles.days,
                  { color: it.expired ? colors.destructive : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {(it.expirationDate ? formatExpiry(it.expirationDate) : "—") +
                  " · " +
                  (it.expired
                    ? `expired ${-it.daysUntilExpiry}d ago`
                    : it.daysUntilExpiry === 0
                      ? "expires today"
                      : `${it.daysUntilExpiry}d left`)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  title: { fontSize: 12, letterSpacing: 0.8, fontFamily: FONTS.bold },
  count: { fontSize: 12, fontFamily: FONTS.regular },
  list: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  left: { flex: 1, flexShrink: 1 },
  right: { alignItems: "flex-end" },
  name: { fontSize: 14, fontFamily: FONTS.medium },
  todayTag: { fontFamily: FONTS.bold },
  meta: { fontSize: 11, fontFamily: FONTS.regular },
  qty: { fontSize: 14, fontFamily: FONTS.monoBold },
  qtyUnit: { fontSize: 14, fontFamily: FONTS.regular },
  days: { fontSize: 11, fontFamily: FONTS.regular },
});
