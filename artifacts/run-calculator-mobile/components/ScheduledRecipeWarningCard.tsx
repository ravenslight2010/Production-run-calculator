import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { useRun, profileKey } from "@/context/RunContext";
import {
  findScheduledRecipeIssues,
  type ScheduledRunRef,
} from "@workspace/scheduled-recipe-check";

// Advisory "Recipe Setup Needed" card for the Warehouse screen (managers only).
//
// The reorder/transfer demand projections resolve each upcoming scheduled run to
// its saved brand+flavor profile. When that profile is missing or carries no
// real recipe data, the run's material demand silently falls back to a blank
// default form — making the reorder numbers untrustworthy. This card surfaces
// those runs so a manager can set the profile up. Detection (and the dedup /
// ordering) lives in @workspace/scheduled-recipe-check so this card and the web
// one flag identically (replit.md parity). Read-only — advisory.
export default function ScheduledRecipeWarningCard({
  scheduledRuns,
  onSetup,
}: {
  scheduledRuns: ScheduledRunRef[];
  onSetup: (brand: string, flavor: string) => void;
}) {
  const colors = useColors();
  const { brandProfiles } = useRun();

  const issues = findScheduledRecipeIssues(
    scheduledRuns,
    (brand, flavor) => brandProfiles[profileKey(brand, flavor)] ?? null,
  );
  if (issues.length === 0) return null;

  return (
    <Card title="Recipe Setup Needed" icon="alert-triangle" style={{ marginBottom: 16 }}>
      <Text style={[styles.count, { color: colors.mutedForeground }]}>
        {issues.length} scheduled run{issues.length !== 1 ? "s" : ""}
      </Text>
      <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
        These scheduled runs have no saved recipe, so their reorder demand falls
        back to defaults. Set up each profile to make the projections accurate.
      </Text>
      <View style={styles.list}>
        {issues.map((it) => (
          <Pressable
            key={`${it.brand}\u0000${it.flavor}`}
            onPress={() => onSetup(it.brand, it.flavor)}
            style={[styles.row, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          >
            <View style={styles.left}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {it.brand}
                {it.flavor ? ` — ${it.flavor}` : ""}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {it.reason === "missing" ? "no profile" : "no recipe rows"} · {it.totalCases} case
                {it.totalCases !== 1 ? "s" : ""}
              </Text>
            </View>
            <View style={styles.action}>
              <Text style={[styles.actionText, { color: colors.warning }]}>Set up</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.warning} />
            </View>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 12, fontFamily: FONTS.regular, marginBottom: 4 },
  blurb: { fontSize: 11, fontFamily: FONTS.regular, lineHeight: 15, marginBottom: 8 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  left: { flex: 1, flexShrink: 1 },
  name: { fontSize: 14, fontFamily: FONTS.medium },
  meta: { fontSize: 11, fontFamily: FONTS.regular },
  action: { flexDirection: "row", alignItems: "center", gap: 3 },
  actionText: { fontSize: 13, fontFamily: FONTS.medium },
});
