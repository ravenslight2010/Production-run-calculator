import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import {
  fetchInventory,
  openInventoryStream,
  computeRunReorderList,
  type InventoryItem,
  type ReorderItem,
} from "@/context/inventoryShared";
import { getOrCreateClientId } from "@/context/sync/client";
import type { RunSettings } from "@/context/RunContext";

// Advisory "Reorder Now" card for the Warehouse screen. Self-contained: it
// fetches current inventory (and refreshes on the inventory SSE stream, exactly
// like the Inventory screen) so warehouse staff don't have to open the editor.
//
// Items are flagged when their cross-location on-hand has dropped to/below their
// reorder threshold once upcoming scheduled-run demand is subtracted. All the
// matching + suggested-quantity math lives in @workspace/inventory-math via the
// shared computeRunReorderList wrapper, so this card and the web one flag
// identically (replit.md parity). Read-only — it never writes stock.
export default function ReorderCard({
  scheduledSettingsList = [],
}: {
  scheduledSettingsList?: RunSettings[];
}) {
  const colors = useColors();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const refetchRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    try {
      setItems(await fetchInventory());
    } catch {
      /* leave items as-is; card simply hides if nothing is loaded */
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

  const reorder: ReorderItem[] = computeRunReorderList(items, scheduledSettingsList);
  if (reorder.length === 0) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="cart-outline" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary }]}>REORDER NOW</Text>
        <Text style={[styles.count, { color: colors.mutedForeground }]}>
          ({reorder.length} item{reorder.length !== 1 ? "s" : ""} low)
        </Text>
      </View>
      <View style={styles.list}>
        {reorder.map((it) => (
          <View key={it.key} style={styles.row}>
            <View style={styles.left}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {it.name}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {it.onHand} on hand · reorder at {it.reorderThreshold}
              </Text>
            </View>
            <Text style={[styles.qty, { color: colors.foreground }]}>
              order {it.suggestedQty}{" "}
              <Text style={[styles.qtyUnit, { color: colors.mutedForeground }]}>{it.unit}</Text>
            </Text>
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
  list: { gap: 4 },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  left: { flex: 1, flexShrink: 1 },
  name: { fontSize: 14, fontFamily: FONTS.medium },
  meta: { fontSize: 11, fontFamily: FONTS.regular },
  qty: { fontSize: 14, fontFamily: FONTS.monoBold },
  qtyUnit: { fontSize: 14, fontFamily: FONTS.regular },
});
