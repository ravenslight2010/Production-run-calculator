import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import type { SubstitutionLogEntry } from "@workspace/inventory-math";

// Read-only timestamped trail of today's substitution add/clear actions, for
// shift handoffs and end-of-day review. Newest first. Auto-clears at the daily
// reset alongside the substitutions themselves. Verbatim mirror of web's
// SubstitutionLog (replit.md parity).
export default function SubstitutionLog({
  entries,
}: {
  entries: SubstitutionLogEntry[];
}) {
  const colors = useColors();
  if (!entries || entries.length === 0) return null;
  const ordered = [...entries].sort((a, b) => b.ts - a.ts);
  return (
    <Card title="Today's Substitutions" icon="clock" style={{ marginBottom: 16 }}>
      <View style={{ gap: 6 }}>
        {ordered.map((e) => (
          <View
            key={e.id}
            style={[
              styles.row,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <Feather
              name={e.kind === "added" ? "plus-circle" : "minus-circle"}
              size={15}
              color={e.kind === "added" ? "#10b981" : colors.mutedForeground}
              style={{ marginTop: 1 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.desc, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {e.description}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {e.kind === "added" ? "Added" : "Cleared"} · {fmtLogTime(e.ts)}
                {e.user ? ` · ${e.user}` : ""}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function fmtLogTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  desc: { fontSize: 13, fontFamily: FONTS.medium },
  meta: { fontSize: 11, fontFamily: FONTS.regular, marginTop: 2 },
});
