import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, SectionHeader } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, runLabel } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { run, runIndex, autoTrack, setAutoTrack, resetRun } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Auto-track */}
        <SectionHeader title="Tracking" />
        <CardSection>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                Auto-track progress
              </Text>
              <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>
                Update skids &amp; cases automatically from run time.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setAutoTrack(!autoTrack);
              }}
              style={({ pressed }) => [
                styles.autoPill,
                {
                  backgroundColor: autoTrack ? colors.primary : colors.secondary,
                  borderColor: autoTrack ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name="zap"
                size={12}
                color={autoTrack ? "#000" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.autoPillText,
                  { color: autoTrack ? "#000" : colors.mutedForeground },
                ]}
              >
                Auto {autoTrack ? "On" : "Off"}
              </Text>
            </Pressable>
          </View>
        </CardSection>

        {/* Master data */}
        <SectionHeader title="Data" />
        <Pressable
          onPress={() => router.push("/master-data")}
          style={({ pressed }) => [
            styles.linkBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="database" size={16} color={colors.foreground} />
          <Text style={[styles.linkText, { color: colors.foreground }]}>
            Manage Master Data &amp; PIN
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        {/* Reset */}
        <Pressable
          onPress={() => {
            Alert.alert(
              "Reset This Run",
              `Reset "${runLabel(run, runIndex)}" to defaults? This clears its settings and progress.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset",
                  style: "destructive",
                  onPress: () => {
                    resetRun();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  },
                },
              ],
            );
          }}
          style={({ pressed }) => [
            styles.resetBtn,
            { borderColor: "#ef4444", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.resetBtnText, { color: "#ef4444" }]}>
            Reset This Run
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  rowLabel: { fontSize: 16, fontWeight: "500" as const, fontFamily: FONTS.medium },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 16, fontFamily: FONTS.regular },

  autoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  autoPillText: { fontSize: 12, fontWeight: "700" as const, fontFamily: FONTS.bold },

  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkText: { flex: 1, fontSize: 15, fontWeight: "600" as const, fontFamily: FONTS.semibold },

  resetBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
    borderWidth: 1,
  },
  resetBtnText: { fontSize: 16, fontWeight: "600" as const, fontFamily: FONTS.semibold },
});
